import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CancelledError, type ClaimedJob, type FileFormat, type OfficeApi, type ReturnType } from "./api";
import { sleep, type Config } from "./config";
import { unpack, uploadFile } from "./files";
import { GstPortal, hasRecipe, LoginTimeoutError, NotAvailableError, SessionExpiredError, type Captured } from "./portal/gst-portal";

// One job = one client, one login:
//   1. WAITING_LOGIN: the portal opens with the login filled in; staff type
//      the captcha and OTP on this PC.
//   2. GSTR-1 JSON first: the portal takes about 20 minutes to prepare it, so
//      it is asked for before anything else (an earlier request of the
//      client is reused, never asked for twice).
//   3. Meanwhile every PDF, GSTR-2B JSON and Excel is downloaded.
//   4. The JSON is collected; whatever isn't ready stays for the next job.
//   5. Log out, and report DONE / PARTLY_DONE / FAILED.

export type JobOutcome = "DONE" | "PARTLY_DONE" | "FAILED" | "CANCELLED";

export interface RunOptions {
  api: OfficeApi;
  config: Config;
  // Rings the PC's bell when staff are needed
  beep?: () => void;
}

const LABELS: Record<ReturnType, string> = { GSTR1: "GSTR-1", GSTR3B: "GSTR-3B", GSTR2B: "GSTR-2B" };
const FORMATS: Record<FileFormat, string> = { PDF: "PDF", JSON: "JSON", EXCEL: "Excel" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

const PROGRESS_EVERY_MS = 15_000;

// Sends progress and log lines to the app; also the job's heartbeat
class Reporter {
  private lines: string[] = [];
  private progressText = "";
  private lastSent = 0;

  constructor(
    private readonly api: OfficeApi,
    private readonly job: ClaimedJob
  ) {}

  log(text: string) {
    console.log(`[${new Date().toLocaleTimeString("en-IN")}] ${this.job.client.name}: ${text}`);
    this.lines.push(text);
  }

  async flush(status?: "WAITING_LOGIN" | "RUNNING") {
    do {
      const log = this.lines.splice(0, 20);
      await this.api.status(this.job.id, { ...(status && { status }), progress: this.progressText.slice(0, 200), log });
    } while (this.lines.length);
    this.lastSent = Date.now();
  }

  async progress(text: string) {
    this.progressText = text;
    if (this.lines.length || Date.now() - this.lastSent >= PROGRESS_EVERY_MS) await this.flush();
  }

  // Lines not sent yet, for the finish call
  takeLines() {
    return this.lines.splice(0);
  }
}

interface JsonWait {
  id: string;
  month: string;
  nextCheck: number;
  deadline: number;
  // Asked for again after the earlier request expired
  renewed: boolean;
}

export async function runJob(job: ClaimedJob, { api, config, beep = () => process.stdout.write("\u0007") }: RunOptions): Promise<JobOutcome> {
  const report = new Reporter(api, job);
  const months = [...job.months].sort();
  const notAvailable: string[] = [];
  const errors: string[] = [];
  const stillWaiting: string[] = [];
  let saved = 0;
  let portal: GstPortal | null = null;

  // An item that couldn't be downloaded: not available, or a real error.
  // A cancel or an expired session stops the whole job.
  const problem = (what: string, error: unknown) => {
    if (error instanceof CancelledError || error instanceof SessionExpiredError) throw error;
    if (error instanceof NotAvailableError) {
      notAvailable.push(`${what} (${error.reason})`);
      report.log(`Not available: ${what} (${error.reason})`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${what}: ${message}`);
      report.log(`Could not download ${what}: ${message}`);
    }
  };

  const save = async (file: Captured, returnType: ReturnType, format: FileFormat, month: string, readFigures = true) => {
    const folder = path.join(config.downloadDir, job.client.gstin || job.client.id, month);
    const local = path.join(folder, path.basename(file.name));
    await mkdir(folder, { recursive: true });
    await writeFile(local, file.data);
    try {
      for (const piece of await unpack(file)) {
        const result = await uploadFile(api, job.id, piece, { returnType, month, format, readFigures });
        saved++;
        console.log(`  saved ${piece.name}${result.filed ? ` – ${result.filed}` : ""}`);
      }
    } finally {
      if (!config.keepLocalCopies) await unlink(local).catch(() => undefined);
    }
  };

  const finish = async (fatal?: string) => {
    if (fatal) errors.push(fatal);
    const status = errors.length === 0 ? "DONE" : saved > 0 ? "PARTLY_DONE" : "FAILED";
    const lines = report.takeLines();
    if (notAvailable.length) lines.push(`Not available: ${notAvailable.join("; ")}`);
    if (stillWaiting.length) lines.push(`GSTR-1 JSON not ready yet for ${stillWaiting.map(monthLabel).join(", ")}: the client's next download collects it`);
    lines.push(`${saved} file${saved === 1 ? "" : "s"} saved`);
    console.log(lines.map((l) => `  ${l}`).join("\n"));
    await api.finish(job.id, { status, error: errors.length ? errors.join("\n").slice(0, 2000) : null, log: lines.slice(-40) });
    return status;
  };

  try {
    // ─── 1. Login: staff type the captcha and OTP ──────────────────────────
    report.log(`Opening the GST portal for ${job.client.name}${job.login ? "" : " (no GST login saved: type the username and password too)"}`);
    await report.progress(`Waiting for the captcha and OTP on ${config.helperName}`);
    await report.flush("WAITING_LOGIN");
    beep();
    portal = await GstPortal.open(config);
    try {
      await portal.login(job.login, { waitMinutes: config.loginWaitMinutes, onTick: () => report.flush() });
    } catch (error) {
      if (error instanceof LoginTimeoutError) return await finish(error.message);
      throw error;
    }
    report.log("Logged in");
    await report.progress("Logged in");
    await report.flush("RUNNING");

    // ─── 2. GSTR-1 JSON first ──────────────────────────────────────────────
    const waits: JsonWait[] = [];
    const startedAt = Date.now();
    const addWait = (id: string, month: string, requestedAt: number, renewed = false) =>
      waits.push({
        id,
        month,
        nextCheck: requestedAt + config.jsonReadyMinutes * 60_000,
        // An older request is checked at least once
        deadline: Math.max(requestedAt + config.jsonMaxWaitMinutes * 60_000, startedAt),
        renewed,
      });
    const askForJson = async (month: string, renewed = false) => {
      await report.progress(`Asking for GSTR-1 JSON of ${monthLabel(month)}`);
      try {
        await portal!.requestJson(month);
        const { request } = await api.createJsonRequest(job.id, "GSTR1", month);
        addWait(request.id, month, Date.now(), renewed);
        report.log(`Asked for GSTR-1 JSON of ${monthLabel(month)}`);
      } catch (error) {
        problem(`GSTR-1 JSON ${monthLabel(month)}`, error);
      }
    };

    if (job.returns.includes("GSTR1") && job.formats.includes("JSON")) {
      const earlier = job.pendingJson.filter((p) => p.returnType === "GSTR1");
      for (const p of earlier) {
        addWait(p.id, p.month, Date.parse(p.requestedAt));
        report.log(`Using the GSTR-1 JSON of ${monthLabel(p.month)} asked for on ${new Date(p.requestedAt).toLocaleString("en-IN")}`);
      }
      for (const month of months) {
        if (!earlier.some((p) => p.month === month)) await askForJson(month);
      }
    }

    // ─── 3. PDFs, GSTR-2B JSON and Excel while the portal prepares the JSON ─
    for (const month of months) {
      for (const returnType of job.returns) {
        for (const format of job.formats) {
          if (returnType === "GSTR1" && format === "JSON") continue;
          if (!hasRecipe(returnType, format)) continue;
          const what = `${LABELS[returnType]} ${monthLabel(month)} ${FORMATS[format]}`;
          await report.progress(`Downloading ${what}`);
          try {
            await save(await portal.downloadReturn(returnType, format, month), returnType, format, month);
          } catch (error) {
            problem(what, error);
          }
        }
      }
    }

    // ─── 4. Collect the JSON ───────────────────────────────────────────────
    while (waits.length) {
      const due = waits.filter((w) => w.nextCheck <= Date.now());
      for (const wait of due) {
        const what = `GSTR-1 JSON ${monthLabel(wait.month)}`;
        await report.progress(`Checking ${what}`);
        waits.splice(waits.indexOf(wait), 1);
        try {
          const result = await portal.collectJson(wait.month);
          if (result.kind === "files") {
            // One part is not the whole return: parts are kept without figures
            const parts = result.files.length;
            for (const file of result.files) await save(file, "GSTR1", "JSON", wait.month, parts === 1);
            await api.updateJsonRequest(job.id, wait.id, "DOWNLOADED", parts);
            report.log(`Downloaded ${what}${parts > 1 ? ` (${parts} parts)` : ""}`);
          } else if (result.kind === "pending") {
            if (Date.now() >= wait.deadline) stillWaiting.push(wait.month);
            else waits.push({ ...wait, nextCheck: Date.now() + config.jsonCheckEveryMinutes * 60_000 });
          } else {
            // The portal has no request for it any more (expired): ask again once
            await api.updateJsonRequest(job.id, wait.id, "EXPIRED");
            report.log(`The earlier request for ${what} has expired`);
            if (months.includes(wait.month) && !wait.renewed) await askForJson(wait.month, true);
          }
        } catch (error) {
          problem(what, error);
        }
      }
      if (!waits.length) break;

      // Wait for the next check, keeping the session alive in between
      const wake = Math.min(...waits.map((w) => w.nextCheck));
      await report.progress(`Waiting for GSTR-1 JSON (${waits.map((w) => monthLabel(w.month)).join(", ")}); next check at ${clock(wake)}`);
      while (Date.now() < wake) {
        await sleep(Math.min(wake - Date.now(), Math.max(config.jsonCheckEveryMinutes, 0.05) * 60_000));
        if (Date.now() < wake) {
          await portal.keepAlive();
          await report.flush();
        }
      }
    }

    // ─── 5. Log out ────────────────────────────────────────────────────────
    await portal.logout();
    report.log("Logged out");
    return await finish();
  } catch (error) {
    if (error instanceof CancelledError) {
      console.log(`${job.client.name}: cancelled by staff, stopping`);
      await portal?.logout();
      return "CANCELLED";
    }
    await portal?.logout();
    const message = error instanceof Error ? error.message : String(error);
    try {
      return await finish(message);
    } catch (finishError) {
      if (finishError instanceof CancelledError) return "CANCELLED";
      throw finishError;
    }
  } finally {
    await portal?.close();
  }
}
