import axios from "axios";
import { BillTypeValue } from "@/lib/billing-constants";
import { downloadExtensionZip } from "@/components/compliance/extension-zip";

// The Tally browser extension (public/tally-extension) on the Tally PC, and
// sending bills straight into TallyPrime with it (docs/TALLY_DIRECT_IMPORT.md)

export const tallyExtensionVersion = () => document.documentElement.getAttribute("data-mvc-tally");

interface Answer {
  ok: boolean;
  error?: string;
  version?: string;
  companies?: string[];
  companyMissing?: boolean;
  missingVoucherTypes?: string[];
  missingLedgers?: string[];
  imported?: boolean;
}

let counter = 0;

function ask(message: Record<string, unknown>, timeoutMs: number): Promise<Answer> {
  const id = `${Date.now()}-${++counter}`;
  return new Promise((resolve) => {
    const done = (answer: Answer) => {
      window.removeEventListener("message", listener);
      clearTimeout(timer);
      resolve(answer);
    };
    const listener = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.origin === window.location.origin &&
        event.data?.source === "mvc-tally-ext" &&
        event.data.type === "answer" &&
        event.data.id === id
      ) {
        done(event.data.answer ?? { ok: false, error: "No answer from the Tally extension" });
      }
    };
    const timer = setTimeout(
      () => done({ ok: false, error: "The Tally extension didn't answer. Reload this page; if it still fails, reinstall the extension." }),
      timeoutMs
    );
    window.addEventListener("message", listener);
    window.postMessage({ source: "mvc-app-tally", id, message: { ...message, port: tallyPort() } }, window.location.origin);
  });
}

// Tally's port on this computer (TallyPrime: F1 → Settings → Connectivity)
const PORT_KEY = "tally-port";
export function tallyPort(): number {
  try {
    const saved = Number(localStorage.getItem(PORT_KEY));
    if (Number.isInteger(saved) && saved > 0 && saved < 65536) return saved;
  } catch {
    // Storage blocked: the default
  }
  return 9000;
}
export function saveTallyPort(port: number) {
  try {
    localStorage.setItem(PORT_KEY, String(port));
  } catch {
    // Not remembered
  }
}

export const tallyStatus = () => ask({ type: "tally-status" }, 20_000);

// ─── Debtors sync (docs/TALLY_DEBTORS.md) ───────────────────────────────────

// The extension sends debtors for MVC and B Edge from version 1.2.0
export const SYNC_EXTENSION_VERSION = "1.2.0";
export function extensionCanSync(version: string | null) {
  if (!version) return false;
  const [a = 0, b = 0] = version.split(".").map(Number);
  const [x, y] = SYNC_EXTENSION_VERSION.split(".").map(Number);
  return a > x || (a === x && b >= y);
}

export interface SyncFirmInfo {
  company: string;
  port: number;
  running: boolean;
  last: { ok: boolean; at: string; message?: string; ledgers?: number; changed?: number; trigger?: string } | null;
}

// The firms this PC sends for, by "MVC" / "BEDGE"
export interface SyncInfo extends Answer {
  firms?: Partial<Record<"MVC" | "BEDGE", SyncFirmInfo>>;
}

export const syncInfo = () => ask({ type: "tally-sync-info" }, 10_000) as Promise<SyncInfo>;
// Port: Tally's port saved on this computer (saveTallyPort)
export const syncConnect = (entity: "MVC" | "BEDGE", key: string, company: string) => ask({ type: "tally-sync-connect", entity, key, company }, 10_000);
export const syncDisconnect = (entity: "MVC" | "BEDGE") => ask({ type: "tally-sync-disconnect", entity }, 10_000);
// Reads Tally and sends that firm's debtors now; can take a few minutes
export const syncNow = (entity: "MVC" | "BEDGE") => ask({ type: "tally-sync-now", entity }, 600_000) as Promise<Answer & { ledgers?: number; changed?: number; readAt?: string }>;

// The extension as a ZIP to load unpacked, set up for this app's address
export async function downloadTallyExtension() {
  const { origin, protocol, hostname } = window.location;
  await downloadExtensionZip(
    "tally-extension",
    ["manifest.json", "background.js", "bridge.js"],
    { root: "mvc-tally", fileName: "mvc-tally-extension.zip" },
    (name, text) => {
      // Match patterns can't hold a port; the worker checks the full origin
      if (name === "manifest.json") return text.replaceAll("__APP_MATCH__", `${protocol}//${hostname}/*`);
      if (name === "background.js") return text.replace("__APP_ORIGIN__", origin);
      return text;
    }
  );
}

// ─── Sending ────────────────────────────────────────────────────────────────

interface Prepared {
  company: string;
  voucherTypes: string[];
  ledgers: string[];
  bills: {
    id: string;
    billNumber: string;
    client: string | null;
    amount: number | null;
    action: "Create" | "Alter" | "Cancel";
    version: string;
    xml: string;
  }[];
  skipped: number;
}

export type SendStep =
  | { kind: "preparing" }
  | { kind: "checking"; company: string }
  | { kind: "sending"; done: number; total: number; current: string }
  | { kind: "stopped"; reason: string; missingVoucherTypes?: string[]; missingLedgers?: string[]; company?: string }
  | { kind: "finished"; results: BillResult[]; skipped: number; unsaved: string[] };

export interface BillResult {
  billId: string;
  billNumber: string;
  client: string | null;
  action: "Create" | "Alter" | "Cancel";
  ok: boolean;
  error?: string;
}

// Prepares the chosen bills, checks Tally has the company open and every
// voucher type and ledger they need (else stops and lists what is missing,
// sending nothing), then sends them one at a time. Each answer is saved in
// the app before the next bill goes, so a closed page can't lose one.
export async function sendBillsToTally(
  type: BillTypeValue,
  billIds: string[],
  onStep: (step: SendStep) => void,
  shouldStop: () => boolean
) {
  onStep({ kind: "preparing" });
  let prepared: Prepared;
  try {
    prepared = (await axios.post<Prepared>("/api/billing/tally/send", { type, billIds })).data;
  } catch (error) {
    const message = axios.isAxiosError(error) && typeof error.response?.data?.error === "string" ? error.response.data.error : "The bills could not be prepared";
    return onStep({ kind: "stopped", reason: message });
  }
  if (prepared.bills.length === 0) {
    return onStep({ kind: "stopped", reason: "None of these bills can go to Tally now (already sent, or no income ledger)." });
  }

  onStep({ kind: "checking", company: prepared.company });
  const checked = await ask(
    { type: "tally-check", company: prepared.company, voucherTypes: prepared.voucherTypes, ledgers: prepared.ledgers },
    120_000
  );
  if (!checked.ok) return onStep({ kind: "stopped", reason: checked.error ?? "Tally could not be checked", company: prepared.company });
  const missingVoucherTypes = checked.missingVoucherTypes ?? [];
  const missingLedgers = checked.missingLedgers ?? [];
  if (missingVoucherTypes.length || missingLedgers.length) {
    return onStep({
      kind: "stopped",
      reason: `Nothing was sent. Create these in ${prepared.company} in Tally, then try again.`,
      missingVoucherTypes,
      missingLedgers,
      company: prepared.company,
    });
  }

  const results: BillResult[] = [];
  // Bills that may be in Tally without the app knowing (no answer in time,
  // or the answer couldn't be saved): to be checked in Tally
  const unsaved: string[] = [];
  for (const [index, bill] of prepared.bills.entries()) {
    if (shouldStop()) break;
    onStep({ kind: "sending", done: index, total: prepared.bills.length, current: bill.billNumber });
    const answer = await ask({ type: "tally-import", company: prepared.company, xml: bill.xml }, 150_000);
    // The extension or Tally itself failed: stop, since the rest would too
    if (!answer.ok) {
      results.push({ billId: bill.id, billNumber: bill.billNumber, client: bill.client, action: bill.action, ok: false, error: answer.error });
      await saveResults(type, [{ billId: bill.id, version: bill.version, ok: false, error: answer.error }]).catch(() => undefined);
      // No answer in time: Tally may still have taken it
      if (/didn't answer/i.test(answer.error ?? "")) unsaved.push(bill.billNumber);
      break;
    }
    const result = { billId: bill.id, billNumber: bill.billNumber, client: bill.client, action: bill.action, ok: !!answer.imported, error: answer.error };
    results.push(result);
    try {
      await saveResults(type, [{ billId: bill.id, version: bill.version, ok: result.ok, error: result.error }]);
    } catch {
      // Tally has it but the app couldn't record it: stop rather than risk
      // sending it again later as a new bill
      unsaved.push(bill.billNumber);
      break;
    }
  }
  onStep({ kind: "finished", results, skipped: prepared.skipped, unsaved });
}

async function saveResults(type: BillTypeValue, results: { billId: string; version: string; ok: boolean; error?: string }[]) {
  await axios.post("/api/billing/tally/send/results", { type, results });
}
