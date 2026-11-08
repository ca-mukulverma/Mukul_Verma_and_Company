"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, CircleDashed, Clock, Download, ExternalLink, FileText, KeyRound, LogIn, LogOut, Loader2, PanelTop, Puzzle, RefreshCw, UserCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fileKey, PORTAL_RETURNS, PortalFile, PortalFileRow, PortalFileState, PortalReturn, RETURN_LABELS, RETURN_OF, STATE_LABELS } from "@/lib/gst-portal";
import type { ClientPortalFiles, RoundPortalFiles } from "@/lib/gst-portal-files";
import type { PortalSettings } from "@/lib/gst-portal-settings";
import { canFetch, compareVersions, DIAG_VERSION, downloadGstExtension, ENDED, mixedExtensionFiles, FetchedFile, gstExtensionVersion, isOpen, latestGstExtension, onPortalStatus, PortalRun, portalFetch, portalDiagnostics, portalLogin, portalLogout, portalStatus, showPortal } from "./gst-extension";
import { sendPortalFiles } from "./portal-files";
import { GstGuideButton } from "./gst-guide";
import { FyStepper, fyOf, previousMonth } from "./gst-working";
import { apiError, currentMonthKey } from "./types";

// GST portal downloads (docs/GST_PORTAL_EXTENSION_PLAN.md). Which GST
// return files are saved in the app and which are missing, on the client's
// page (below the GST working) and for all clients in a month (the download
// round). One click opens the GST portal through the browser extension with
// the client's login filled in; staff type the captcha and OTP; the
// extension then fetches each ticked file, which goes to Upload documents
// to be saved as if dropped there, and the portal logs out by itself. A
// return not filed on the portal is reported as such, never filed.
// Nothing here polls: it loads when opened and after uploads, and the
// extension reports what happens in the portal tab.

const STATE_STYLES: Record<PortalFileState, string> = {
  saved: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  missing: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  not_yet: "border-border bg-muted/40 text-muted-foreground",
  if_filed: "border-dashed border-border text-muted-foreground",
};

function StateIcon({ state }: { state: PortalFileState }) {
  if (state === "saved") return <Check className="h-3.5 w-3.5 shrink-0" />;
  if (state === "not_yet") return <Clock className="h-3.5 w-3.5 shrink-0" />;
  if (state === "if_filed") return <CircleDashed className="h-3.5 w-3.5 shrink-0" />;
  return null;
}

// One file: a tick box unless it is saved already
function FileChip({ file, ticked, onTick }: { file: PortalFileRow; ticked?: boolean; onTick?: (on: boolean) => void }) {
  const title = `${file.label}: ${STATE_LABELS[file.state]}`;
  if (!onTick || file.state === "saved") {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs", STATE_STYLES[file.state])} title={title}>
        <StateIcon state={file.state} />
        {file.label}
      </span>
    );
  }
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs", STATE_STYLES[file.state])} title={title}>
      <Checkbox className="h-3.5 w-3.5" checked={!!ticked} onCheckedChange={(on) => onTick(on === true)} />
      <StateIcon state={file.state} />
      {file.label}
    </label>
  );
}

function Legend() {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {(Object.keys(STATE_LABELS) as PortalFileState[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={cn("inline-block h-3 w-3 rounded-sm border", STATE_STYLES[s])} />
          {STATE_LABELS[s]}
        </span>
      ))}
    </p>
  );
}

// ─── One client (Compliance → Clients → the client) ─────────────────────────

export function ClientGstPortal({ clientId, refresh, onSaved }: { clientId: string; refresh: number; onSaved?: () => void }) {
  const [fy, setFy] = useState(fyOf(previousMonth()));
  const [data, setData] = useState<ClientPortalFiles | null>(null);
  const [loading, setLoading] = useState(false);
  // Files to fetch: the missing ones, unless staff untick them
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    axios
      .get<ClientPortalFiles>("/api/compliance/gst-portal", { params: { clientId, fy } })
      .then(({ data }) => {
        setData(data);
        setTicked(new Set(data.periods.flatMap((p) => p.files.filter((f) => f.state === "missing").map(fileKey))));
      })
      .catch((e) => toast.error(apiError(e, "Could not load the GST files")))
      .finally(() => setLoading(false));
  }, [clientId, fy]);
  useEffect(() => {
    load();
  }, [load, refresh]);

  if (!data) return <Loader2 className="mx-auto my-4 h-5 w-5 animate-spin" />;
  if (!data.client.gstin?.trim()) {
    return <p className="text-sm text-muted-foreground">Save this client&apos;s GSTIN to see which GST files are missing.</p>;
  }

  const all = data.periods.flatMap((p) => p.files);
  const missing = all.filter((f) => f.state === "missing").length;
  const tick = (f: PortalFileRow, on: boolean) =>
    setTicked((t) => {
      const next = new Set(t);
      if (on) next.add(fileKey(f));
      else next.delete(fileKey(f));
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {missing === 0 ? (
            <span className="text-emerald-700 dark:text-emerald-400">No GST files missing for the months that are due.</span>
          ) : (
            <>
              <span className="font-semibold text-amber-800 dark:text-amber-300">
                {missing} file{missing === 1 ? "" : "s"} missing
              </span>{" "}
              <span className="text-muted-foreground">({all.filter((f) => f.state === "saved").length} saved)</span>
            </>
          )}
          {loading && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
        </p>
        <FyStepper fy={fy} setFy={setFy} />
      </div>

      {data.periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No months of this year are over yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {[...data.periods].reverse().map((p) => (
            <li key={p.start} className="flex flex-col gap-1.5 p-2 sm:flex-row sm:items-start">
              <span className="w-40 shrink-0 text-sm font-medium">
                {p.title}
                {p.quarterly && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">Qtr</span>}
              </span>
              <span className="flex flex-wrap gap-1.5">
                {p.files.map((f) => (
                  <FileChip key={fileKey(f)} file={f} ticked={ticked.has(fileKey(f))} onTick={(on) => tick(f, on)} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Legend />
      {!data.client.hasLogin && (
        <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <KeyRound className="h-3.5 w-3.5" /> No GST login saved (Clients → Credentials, with “GST” in the title): staff type the username and password on the portal.
        </p>
      )}
      <PortalLogin
        clientId={data.client.id}
        clientName={data.client.name}
        gstin={data.client.gstin.trim().toUpperCase()}
        files={all.filter((f) => f.state !== "saved" && ticked.has(fileKey(f)))}
        onSaved={onSaved ?? load}
      />
    </div>
  );
}

// ─── The GST portal tab, through the extension ──────────────────────────────

const ENDED_TEXT: Partial<Record<PortalRun["status"], string>> = {
  "logged-out": "Logged out of the GST portal.",
  closed: "The GST portal tab was closed. If you were logged in, the portal logs out on its own after a while.",
  "timed-out": "Nobody completed the login in time, so the portal tab was closed.",
  failed: "The GST portal couldn't be opened.",
};

const KIND_LABELS: Record<PortalFile, string> = {
  GSTR1_JSON: "GSTR-1 JSON",
  GSTR1_PDF: "GSTR-1 PDF",
  GSTR1A_PDF: "GSTR-1A PDF",
  GSTR3B_PDF: "GSTR-3B PDF",
  GSTR2B_JSON: "GSTR-2B JSON",
};

// One ticked file in a download run
type FetchState = "waiting" | "fetching" | "saving" | "saved" | "check" | "downloaded" | "not-filed" | "not-available" | "requested" | "pending" | "not-taught" | "skipped" | "error";

interface FetchRow {
  kind: PortalFile;
  month: string;
  label: string;
  state: FetchState;
  message: string | null;
}

const FETCH_TEXT: Record<FetchState, string> = {
  waiting: "Waiting",
  fetching: "Fetching…",
  saving: "Saving…",
  saved: "Saved",
  check: "Got it; needs a look",
  downloaded: "In Downloads",
  "not-filed": "Not filed on the portal",
  "not-available": "Not on the portal",
  requested: "JSON asked for",
  pending: "JSON not ready yet",
  "not-taught": "Download by hand",
  skipped: "Not fetched",
  error: "Error",
};

const FETCH_STYLE: Partial<Record<FetchState, string>> = {
  saved: "text-emerald-700 dark:text-emerald-400",
  check: "text-amber-800 dark:text-amber-300",
  downloaded: "text-amber-800 dark:text-amber-300",
  "not-filed": "text-amber-800 dark:text-amber-300",
  requested: "text-sky-700 dark:text-sky-400",
  pending: "text-sky-700 dark:text-sky-400",
  error: "text-red-700 dark:text-red-400",
};

// When GSTR-1 JSON was asked for on the portal, per client and month, in
// this browser, to tell staff on the next run (the portal itself decides
// whether it is ready: each Generate click answers with its links if so)
const ASKED_KEY = "gst-json-asked";
const ASKED_FOR_MS = 3 * 60 * 60_000;

function askedAt(clientId: string, month: string): number | null {
  try {
    const all = JSON.parse(localStorage.getItem(ASKED_KEY) ?? "{}") as Record<string, number>;
    const at = all[`${clientId}:${month}`];
    return at && Date.now() - at < ASKED_FOR_MS ? at : null;
  } catch {
    return null;
  }
}

function setAsked(clientId: string, month: string, at: number | null) {
  try {
    const all = JSON.parse(localStorage.getItem(ASKED_KEY) ?? "{}") as Record<string, number>;
    for (const [k, v] of Object.entries(all)) if (Date.now() - v > ASKED_FOR_MS) delete all[k];
    if (at) all[`${clientId}:${month}`] = at;
    else delete all[`${clientId}:${month}`];
    localStorage.setItem(ASKED_KEY, JSON.stringify(all));
  } catch {
    // Not remembered: the portal is asked again next time
  }
}

const EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "application/json": "json", "application/zip": "zip", "application/x-zip-compressed": "zip" };

// The bytes from the extension as a file the upload can keep
function toFile(f: FetchedFile, fallback: string) {
  const raw = atob(f.base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const type = f.type.split(";")[0].trim();
  let name = (f.name || fallback).replace(/[\\/:*?"<>|]+/g, "_");
  if (!/\.(pdf|json|zip)$/i.test(name)) {
    const ext = EXTENSIONS[type] ?? (bytes[0] === 0x25 && bytes[1] === 0x50 ? "pdf" : bytes[0] === 0x50 && bytes[1] === 0x4b ? "zip" : bytes[0] === 0x7b ? "json" : null);
    if (ext) name = `${name.replace(/\.[a-z0-9]{1,4}$/i, "")}.${ext}`;
  }
  return new File([bytes], name, { type: type || undefined });
}

// GSTR-1 JSON first (it is asked for and collected later), then the files
// that stay on the Returns Dashboard (GSTR-3B PDF), then those that open
// another page (GSTR-1 PDF, GSTR-2B): fewer page changes. Oldest first.
const PORTAL_FILE_ORDER: PortalFile[] = ["GSTR1_JSON", "GSTR3B_PDF", "GSTR1_PDF", "GSTR1A_PDF", "GSTR2B_JSON"];
const fetchOrder = (f: Pick<FetchRow, "kind" | "month">) => `${PORTAL_FILE_ORDER.indexOf(f.kind)}|${f.month}`;

function PortalLogin({ clientId, clientName, gstin, files, onSaved }: { clientId: string; clientName: string; gstin: string; files: PortalFileRow[]; onSaved: () => void }) {
  // undefined: not checked yet (the page has just loaded)
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [run, setRun] = useState<PortalRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [rows, setRows] = useState<FetchRow[] | null>(null);
  // The run that should fetch the ticked files once logged in
  const job = useRef<{ runId: string; rows: FetchRow[]; started: boolean } | null>(null);

  // The version this app ships, to offer an update
  const [latest, setLatest] = useState<string | null>(null);
  // The extension's files on this computer are of different versions
  const [mixed, setMixed] = useState<string | null>(null);

  useEffect(() => {
    const installed = gstExtensionVersion();
    setVersion(installed);
    latestGstExtension().then(setLatest);
    if (!installed) return;
    portalStatus().then((a) => {
      if (!a.ok) return;
      setRun(a.run ?? null);
      setMixed(mixedExtensionFiles(a.version ?? installed, a.stamps));
    });
    return onPortalStatus(setRun);
  }, []);

  const setRow = (key: string, patch: Partial<FetchRow>) => setRows((rs) => rs?.map((r) => (fileKey(r) === key ? { ...r, ...patch } : r)) ?? rs);

  // Logged in: fetch the files one by one, hand each to Upload documents,
  // then log out by itself
  const fetchAll = useCallback(
    async (runId: string, list: FetchRow[]) => {
      const saves: Promise<void>[] = [];
      let stop: string | null = null;
      for (const f of list) {
        const key = fileKey(f);
        if (stop) {
          setRow(key, { state: "skipped", message: stop });
          continue;
        }
        setRow(key, { state: "fetching", message: null });
        const asked = f.kind === "GSTR1_JSON" ? askedAt(clientId, f.month) : null;
        const answer = await portalFetch(runId, { kind: f.kind, month: f.month, label: f.label });
        if (!answer.ok) {
          setRow(key, { state: "error", message: answer.error ?? "The GST extension couldn't fetch it" });
          if (/log in|not open|didn't answer/i.test(answer.error ?? "")) stop = "The portal login ended";
          continue;
        }
        const message = answer.message ?? null;
        switch (answer.result) {
          case "file":
          case "downloaded": {
            if (f.kind === "GSTR1_JSON") setAsked(clientId, f.month, null);
            if (answer.result === "downloaded" && !answer.files?.length) {
              setRow(key, { state: "downloaded", message });
              break;
            }
            const period = `${f.month.slice(5, 7)}${f.month.slice(0, 4)}`;
            const fetched = (answer.files ?? []).map((x, i) => toFile(x, `${f.kind}_${gstin}_${period}${(answer.files?.length ?? 0) > 1 ? `_${i + 1}` : ""}`));
            setRow(key, { state: "saving", message: null });
            saves.push(
              sendPortalFiles(fetched).then(
                (placed) => {
                  const held = placed?.filter((p) => !p.ok) ?? [];
                  setRow(
                    key,
                    !placed
                      ? { state: "error", message: "Upload documents isn't on this page" }
                      : !placed.length
                        ? { state: "error", message: "Upload documents couldn't read the file from the portal" }
                        : held.length
                          ? { state: "check", message: held.map((p) => `${p.name}: ${p.message}`).join(" · ") }
                          : answer.result === "downloaded"
                            ? { state: "downloaded", message }
                            : { state: "saved", message: placed.map((p) => [p.name, p.message].filter(Boolean).join(" – ")).join(", ") }
                  );
                },
                (e) => setRow(key, { state: "error", message: apiError(e, "Couldn't save it") })
              )
            );
            break;
          }
          case "requested":
            if (!asked) setAsked(clientId, f.month, Date.now());
            setRow(key, {
              state: asked ? "pending" : "requested",
              message: [
                message && `Portal: ${message}`,
                asked
                  ? `First asked at ${new Date(asked).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}; download again in a few minutes.`
                  : "The portal prepares it in about 20 minutes: download again after that to collect it.",
              ]
                .filter(Boolean)
                .join(" "),
            });
            break;
          case "pending":
            setRow(key, {
              state: "pending",
              message: asked ? `Asked for at ${new Date(asked).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}; try again in a few minutes.` : message,
            });
            break;
          case "session-expired":
            setRow(key, { state: "error", message: "The portal session ended" });
            stop = "The portal session ended: log in again";
            break;
          case "access-denied":
            // Asking again would only be refused again
            setRow(key, { state: "error", message });
            stop = "Stopped: the GST portal refused access";
            break;
          case "not-filed":
          case "not-available":
          case "not-taught":
            setRow(key, { state: answer.result, message });
            break;
          default:
            setRow(key, { state: "error", message: message ?? "The portal didn't give the file" });
        }
      }
      // Done with the portal: log out without anybody clicking
      const now = await portalStatus();
      if (now.ok && now.run?.runId === runId && isOpen(now.run)) {
        const out = await portalLogout(runId);
        if (out.run !== undefined) setRun(out.run ?? null);
      }
      await Promise.all(saves);
      if (saves.length) onSaved();
    },
    [clientId, gstin, onSaved]
  );

  useEffect(() => {
    const j = job.current;
    if (!j || j.started || !run || run.runId !== j.runId) return;
    if (run.status === "logged-in") {
      j.started = true;
      fetchAll(j.runId, j.rows);
    } else if (ENDED.includes(run.status)) {
      job.current = null;
      setRows((rs) => rs?.map((r) => (r.state === "waiting" ? { ...r, state: "skipped", message: "Not logged in" } : r)) ?? rs);
    }
  }, [run, fetchAll]);

  if (version === undefined) return null;
  if (!version) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-2 text-sm">
        <span className="text-muted-foreground">Install the GST extension (Chrome or Edge) to download from the GST portal from here.</span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setInstalling(true)}>
            <Puzzle className="mr-1 h-4 w-4" /> Install the GST extension
          </Button>
          <GstGuideButton />
        </span>
        {installing && <InstallDialog onClose={() => setInstalling(false)} />}
      </div>
    );
  }
  const fetching = canFetch(version);

  const act = async (work: () => Promise<{ ok: boolean; error?: string; run?: PortalRun | null }>) => {
    setBusy(true);
    try {
      const answer = await work();
      if (answer.run !== undefined) setRun(answer.run ?? null);
      if (!answer.ok) toast.error(answer.error ?? "The GST extension couldn't do that");
      return answer;
    } finally {
      setBusy(false);
    }
  };

  const toFetch = fetching ? [...files].sort((a, b) => fetchOrder(a).localeCompare(fetchOrder(b))) : [];
  const start = () =>
    act(async () => {
      // Checked when clicked, not when this page loaded: the extension asked for
      // the version it is running now, the app server for the newest one (a page
      // left open from before an update still catches an old extension)
      if (toFetch.length) {
        const [status, newest] = await Promise.all([portalStatus(), latestGstExtension()]);
        const running = status.version ?? gstExtensionVersion();
        if (newest) setLatest(newest);
        if (running) setVersion(running);
        const odd = status.ok ? mixedExtensionFiles(running, status.stamps) : null;
        setMixed(odd);
        if (odd) {
          setInstalling(true);
          return { ok: false, error: `The GST extension on this computer mixes files of different versions (${odd}): reinstall it as the guide says, then reload this page.` };
        }
        if (running && newest && compareVersions(running, newest) < 0) {
          setInstalling(true);
          return { ok: false, error: `This computer runs GST extension ${running}; update it to ${newest} first (Update the GST extension), then reload this page.` };
        }
      }
      let answer: { settings: PortalSettings; login: { username: string; password: string } | null };
      try {
        answer = (await axios.post("/api/compliance/gst-portal/login", { clientId })).data;
      } catch (e) {
        return { ok: false, error: apiError(e, "Could not get the GST login") };
      }
      const runId = crypto.randomUUID();
      const list: FetchRow[] = toFetch.map((f) => ({ kind: f.kind, month: f.month, label: `${KIND_LABELS[f.kind]} ${monthText(f.month)}`, state: "waiting", message: null }));
      job.current = list.length ? { runId, rows: list, started: false } : null;
      setRows(list.length ? list : null);
      const opened = await portalLogin({ runId, clientId, clientName, settings: answer.settings, login: answer.login, autoLogout: list.length > 0 });
      if (!opened.ok) {
        job.current = null;
        setRows(null);
      }
      return opened;
    });

  // The portal tab open now (for this client or another)
  const live = isOpen(run) ? run : null;
  const mine = live?.clientId === clientId ? live : null;
  const working = !!rows?.some((r) => r.state === "waiting" || r.state === "fetching" || r.state === "saving");

  return (
    <div className="space-y-2 rounded-md border p-2 text-sm">
      {live && !mine && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            The GST portal is open for <span className="font-medium">{live.clientName}</span> (one client at a time in this browser).
          </span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => showPortal(live.runId))}>
            <PanelTop className="mr-1 h-4 w-4" /> Show
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => portalLogout(live.runId))}>
            <LogOut className="mr-1 h-4 w-4" /> Log out there
          </Button>
        </div>
      )}
      {mine && (
        <div className="space-y-2">
          <p className="font-medium">
            {mine.status === "waiting-login" && (
              <span className="text-amber-800 dark:text-amber-300">
                <KeyRound className="mr-1 inline h-4 w-4" />
                Type the captcha (and the OTP, if asked) in the GST portal tab.
                {rows?.length ? " The ticked files are fetched after that and the portal logs out by itself." : ""}
              </span>
            )}
            {mine.status === "logged-in" && (
              <span className="text-emerald-700 dark:text-emerald-400">
                {mine.doing ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Check className="mr-1 inline h-4 w-4" />}
                {mine.doing ? `Fetching ${mine.doing} from the GST portal…` : "Logged in to the GST portal."}
              </span>
            )}
            {mine.status === "logging-out" && (
              <span>
                <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
                Logging out…
              </span>
            )}
          </p>
          {mine.ask && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border-2 border-amber-400 bg-amber-50 p-2 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <span>
                Your turn: click <span className="font-semibold">“{mine.ask}”</span> in the GST portal tab (it is highlighted in orange).
              </span>
              <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => act(() => showPortal(mine.runId))}>
                <PanelTop className="mr-1 h-3.5 w-3.5" /> Show the portal tab
              </Button>
            </div>
          )}
          {mine.note && <p className="text-xs text-amber-700 dark:text-amber-400">{mine.note}</p>}
          {mine.status === "logged-in" && mine.clicks !== "assisted" && working && (
            <p className="text-xs text-muted-foreground">
              Chrome shows a bar “MV Company GST portal started debugging this browser” while it clicks the portal&apos;s buttons for you. Don&apos;t press Cancel on it: it goes when the
              portal logs out.
            </p>
          )}
          {mine.status === "logged-in" && !rows?.length && (
            <p className="text-xs text-muted-foreground">Nothing was ticked: work in the portal tab, upload the files with Upload documents above, then log out.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => showPortal(mine.runId))}>
              <PanelTop className="mr-1 h-4 w-4" /> Show the portal tab
            </Button>
            <Button size="sm" variant="outline" disabled={busy || mine.status === "logging-out"} onClick={() => act(() => portalLogout(mine.runId))}>
              <LogOut className="mr-1 h-4 w-4" /> {mine.status === "logged-in" ? (working ? "Stop and log out" : "Log out and close") : "Cancel"}
            </Button>
          </div>
        </div>
      )}
      {rows && rows.length > 0 && (
        <ul className="space-y-1 text-xs">
          {rows.map((r) => (
            <li key={fileKey(r)} className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-36 shrink-0 font-medium">{r.label}</span>
              <span className={cn("shrink-0", FETCH_STYLE[r.state])}>
                {(r.state === "fetching" || r.state === "saving") && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                {r.state === "saved" && <Check className="mr-1 inline h-3 w-3" />}
                {FETCH_TEXT[r.state]}
              </span>
              {r.message && <span className="text-muted-foreground">{r.message}</span>}
            </li>
          ))}
        </ul>
      )}
      {!live && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || working} onClick={start}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : toFetch.length ? <Download className="mr-1 h-4 w-4" /> : <LogIn className="mr-1 h-4 w-4" />}
            {toFetch.length ? `Download ${toFetch.length} file${toFetch.length === 1 ? "" : "s"} from the GST portal` : "Log in to the GST portal"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {run && run.clientId === clientId && ENDED_TEXT[run.status] && !rows
              ? ENDED_TEXT[run.status]
              : toFetch.length
                ? "Opens the portal with the login filled in; you type the captcha and OTP. The ticked files are then fetched and saved, and the portal logs out by itself."
                : "Opens the portal in a new tab with the login filled in; you type the captcha and OTP."}
          </span>
        </div>
      )}
      {mixed && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span>
            The GST extension on this computer mixes files of different versions ({mixed}). Delete everything in its mvc-gst folder, download it again, extract it into the folder that holds
            mvc-gst (so the five files sit directly in mvc-gst), click reload on chrome://extensions, then reload this page.
          </span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setInstalling(true)}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reinstall the GST extension
          </Button>
        </div>
      )}
      <ExtensionVersion installed={version} latest={latest} needed={!fetching} busy={working || !!mine} onUpdate={() => setInstalling(true)} />
      {installing && <InstallDialog update={version} latest={latest} onClose={() => setInstalling(false)} />}
    </div>
  );
}

// The installed extension's version, with an update button when the app
// ships a newer one (or the installed one can't fetch files at all)
function ExtensionVersion({ installed, latest, needed, busy, onUpdate }: { installed: string; latest: string | null; needed: boolean; busy: boolean; onUpdate: () => void }) {
  const outdated = needed || (!!latest && compareVersions(installed, latest) < 0);
  if (!outdated) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          GST extension {installed}
          {latest && " (latest)"} ·{" "}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onUpdate}>
            reinstall
          </button>
        </span>
        <GstGuideButton variant="ghost" className="h-7 px-2 text-xs" label="Step-by-step guide · English / हिंदी / Hinglish" />
        <DiagnosticsButton installed={installed} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <span>
        {needed
          ? `This computer has GST extension ${installed}, which can't fetch the ticked files.`
          : `This computer has GST extension ${installed}; ${latest} is out, with fixes.`}{" "}
        Update it once on this computer{busy ? " (after this login ends)" : ""}.
      </span>
      <Button size="sm" variant="outline" className="h-7" onClick={onUpdate}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" /> Update the GST extension{latest ? ` to ${latest}` : ""}
      </Button>
      <GstGuideButton variant="ghost" className="h-7 px-2 text-xs" label="Step-by-step guide · English / हिंदी / Hinglish" />
      <DiagnosticsButton installed={installed} />
    </div>
  );
}

// Saves the extension's record of the last GST portal login as a text file
// (and copies it), to send to the admin when the portal refuses a page
function DiagnosticsButton({ installed }: { installed: string }) {
  const [saving, setSaving] = useState(false);
  if (compareVersions(installed, DIAG_VERSION) < 0) return null;
  const save = async () => {
    setSaving(true);
    try {
      const answer = await portalDiagnostics();
      if (!answer.ok || !answer.text) {
        // An old background.js next to a newer manifest doesn't know the request
        const old = answer.error === "Unknown request" ? "The GST extension on this computer has old files in its folder: reinstall it (delete the mvc-gst folder's files first), then reload this page" : null;
        toast.error(old ?? answer.error ?? "The GST extension gave no diagnostics: update it and reload this page");
        return;
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const url = URL.createObjectURL(new Blob([answer.text], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `gst-diagnostics-${stamp}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const copied = await navigator.clipboard?.writeText(answer.text).then(
        () => true,
        () => false
      );
      toast.success(`Diagnostics saved to Downloads${copied ? " and copied" : ""}: send the file to the admin`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={save} title="The extension's record of the last GST portal login, for the admin">
      {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1 h-3.5 w-3.5" />} Save diagnostics
    </Button>
  );
}

function InstallDialog({ onClose, update = null, latest = null }: { onClose: () => void; update?: string | null; latest?: string | null }) {
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await downloadGstExtension();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download the extension");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{update ? "Update the GST extension" : "Install the GST extension"}</DialogTitle>
          <DialogDescription>
            {update
              ? `This computer has ${update}${latest ? `; the new one is ${latest}` : ""}. Nothing is lost: the extension keeps no data.`
              : "Once on each computer, in Chrome or Edge. It only works on the GST portal and on this app."}
          </DialogDescription>
        </DialogHeader>
        {update ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              <Button size="sm" variant="outline" onClick={download} disabled={downloading}>
                {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />} Download the new extension
              </Button>
            </li>
            <li>
              Open your <span className="font-mono">mvc-gst</span> folder and delete everything inside it (keep the empty folder).
            </li>
            <li>
              Right-click the ZIP → <span className="font-medium">Extract all</span>, and as the folder choose the one that <span className="font-medium">holds</span>{" "}
              <span className="font-mono">mvc-gst</span> (for example Documents), not <span className="font-mono">mvc-gst</span> itself. Choose{" "}
              <span className="font-medium">Replace the files</span> if asked. The five files must sit directly in <span className="font-mono">mvc-gst</span>.
            </li>
            <li>
              Open <span className="font-mono">chrome://extensions</span> (Edge: <span className="font-mono">edge://extensions</span>) and click the{" "}
              <span className="font-medium">reload arrow</span> on <span className="font-medium">MV Company GST portal</span>. Allow any new permission it asks for.
            </li>
            <li>Check it shows version {latest ?? "the new number"}, then reload this page.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              <Button size="sm" variant="outline" onClick={download} disabled={downloading}>
                {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />} Download the extension
              </Button>{" "}
              and unzip it (right-click → Extract all). Keep the <span className="font-mono">mvc-gst</span> folder where it won&apos;t be deleted.
            </li>
            <li>
              Open <span className="font-mono">chrome://extensions</span> (Edge: <span className="font-mono">edge://extensions</span>) in the address bar.
            </li>
            <li>Turn on <span className="font-medium">Developer mode</span>.</li>
            <li>
              Click <span className="font-medium">Load unpacked</span> and choose the <span className="font-mono">mvc-gst</span> folder.
            </li>
            <li>Reload this page.</li>
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          {update ? (
            <>
              Can&apos;t find the old <span className="font-mono">mvc-gst</span> folder? Click <span className="font-medium">Remove</span> on the extension in the extensions page, unzip
              the new one anywhere permanent, then <span className="font-medium">Load unpacked</span> that folder (Developer mode on).
            </>
          ) : (
            <>To update it later, use Update the GST extension in this box.</>
          )}
        </p>
        <DialogFooter className="gap-2 sm:justify-between">
          <GstGuideButton label="Full guide · English / हिंदी / Hinglish" />
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── All clients in a month (Compliance → GST downloads) ────────────────────

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthText = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const MINE_KEY = "gst-round-mine";

function savedMine() {
  try {
    return localStorage.getItem(MINE_KEY) === "1";
  } catch {
    return false;
  }
}

export function GstPortalRound() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [month, setMonth] = useState(previousMonth());
  const [data, setData] = useState<RoundPortalFiles | null>(null);
  const [loading, setLoading] = useState(false);
  const [mine, setMine] = useState(false);
  const [returns, setReturns] = useState<Set<PortalReturn>>(new Set(PORTAL_RETURNS));
  const [quarterlyOnly, setQuarterlyOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => setMine(savedMine()), []);
  const toggleMine = () => {
    setMine(!mine);
    try {
      localStorage.setItem(MINE_KEY, mine ? "0" : "1");
    } catch {
      // Not remembered
    }
  };

  useEffect(() => {
    setLoading(true);
    axios
      .get<RoundPortalFiles>("/api/compliance/gst-portal/round", { params: { month } })
      .then(({ data }) => setData(data))
      .catch((e) => toast.error(apiError(e, "Could not load the GST files")))
      .finally(() => setLoading(false));
  }, [month]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((r) => (!mine || r.managerId === userId) && (!quarterlyOnly || r.period.quarterly))
      .map((r) => {
        const files = r.period.files.filter((f) => returns.has(RETURN_OF[f.kind]));
        return { ...r, files, missing: files.filter((f) => f.state === "missing") };
      })
      .filter((r) => showAll || r.missing.length > 0);
  }, [data, mine, userId, quarterlyOnly, returns, showAll]);

  const toggleReturn = (r: PortalReturn) =>
    setReturns((set) => {
      const next = new Set(set);
      if (next.has(r) && next.size > 1) next.delete(r);
      else next.add(r);
      return next;
    });
  const missingCount = rows.reduce((n, r) => n + r.missing.length, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Clients whose GST return files for a month are not all saved in the app. Open a client to see the whole year and download its files.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-20 text-center text-sm font-semibold">{monthText(month)}</span>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9"
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={month >= currentMonthKey()}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button size="sm" variant={mine ? "default" : "outline"} onClick={toggleMine}>
          <UserCheck className="mr-1 h-3.5 w-3.5" />
          My clients
        </Button>
        {PORTAL_RETURNS.map((r) => (
          <Button key={r} size="sm" variant={returns.has(r) ? "default" : "outline"} onClick={() => toggleReturn(r)}>
            {RETURN_LABELS[r]}
          </Button>
        ))}
        <Button size="sm" variant={quarterlyOnly ? "default" : "outline"} onClick={() => setQuarterlyOnly(!quarterlyOnly)}>
          Quarterly
        </Button>
        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={showAll} onCheckedChange={(on) => setShowAll(on === true)} />
          Also clients with nothing missing
        </label>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>

      {data && (
        <p className="text-sm font-medium">
          {rows.length} client{rows.length === 1 ? "" : "s"}
          {missingCount > 0 && ` · ${missingCount} file${missingCount === 1 ? "" : "s"} missing`}
        </p>
      )}

      {data && rows.length > 0 && (
        <ul className="divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.clientId} className="flex flex-col gap-1.5 p-2 md:flex-row md:items-start">
              <div className="min-w-0 md:w-64 md:shrink-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[r.gstin, r.period.quarterly && r.period.title].filter(Boolean).join(" · ")}
                  {!r.hasLogin && <span className="ml-1 text-amber-700 dark:text-amber-400">· no GST login saved</span>}
                </p>
              </div>
              <span className="flex flex-1 flex-wrap gap-1.5">
                {r.files.map((f) => (
                  <FileChip key={fileKey(f)} file={f} />
                ))}
              </span>
              <Button size="sm" variant="ghost" className="self-start" asChild>
                <a href={`/dashboard/compliance?tab=clients&client=${r.clientId}`}>
                  Open <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data && rows.length === 0 && <p className="text-sm text-emerald-700 dark:text-emerald-400">Nothing missing for {monthText(month)}.</p>}
      <Legend />
    </div>
  );
}
