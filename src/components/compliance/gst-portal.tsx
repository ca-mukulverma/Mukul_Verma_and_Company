"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, CircleDashed, Clock, Download, ExternalLink, FileSpreadsheet, KeyRound, LogIn, Loader2, Puzzle, RefreshCw, UserCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fileKey, PORTAL_RETURNS, PortalFile, PortalFileRow, PortalFileState, PortalReturn, RETURN_LABELS, RETURN_OF, STATE_LABELS } from "@/lib/gst-portal";
import type { ClientPortalFiles, RoundPortalFiles } from "@/lib/gst-portal-files";
import type { FileDoc } from "@/lib/gst-read/working";
import { canFetch, ENDED, PortalRun } from "./gst-extension";
import { ExtensionVersion, InstallDialog } from "./gst-extension-ui";
import { jobActive, KIND_LABELS, monthText, useGstDownloads, useOnGstSaved } from "./gst-download-queue";
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

// One file: a tick box unless it is saved already. A saved one opens its
// file (owner given): a click downloads it, or offers its parts and, for
// GSTR-1 / GSTR-2B JSON, an Excel of it.
export function FileChip({ file, ticked, onTick, owner }: { file: PortalFileRow; ticked?: boolean; onTick?: (on: boolean) => void; owner?: Owner }) {
  const title = `${file.label}: ${STATE_LABELS[file.state]}`;
  if (file.state === "saved" && owner && file.docs?.length) return <SavedChip file={file} owner={owner} />;
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

// Whose files: for Excel headings and file names
export interface Owner {
  party: string;
  gstin: string;
}

const EXCEL_KINDS: PortalFile[] = ["GSTR1_JSON", "GSTR2B_JSON"];
const documentUrl = (id: string) => `/api/compliance/documents/${id}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

// "Summary", "Part 2", "File" (saved 08 Nov)
function docLabel(d: FileDoc, all: FileDoc[]) {
  const name = d.part === "summary" ? "Summary" : d.part === "part" ? `Part ${d.partNo ?? "?"}` : d.part === "whole" ? "File" : `File ${all.indexOf(d) + 1}`;
  return `${name} (saved ${shortDate(d.createdAt)})`;
}

// Every file of a saved chip in one ZIP, so the browser asks nothing
async function downloadAll(file: PortalFileRow, owner: Owner) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const used = new Set<string>();
  for (const d of file.docs) {
    const response = await fetch(documentUrl(d.id));
    if (!response.ok) throw new Error(`${d.fileName} couldn't be downloaded`);
    let name = d.fileName;
    for (let n = 2; used.has(name); n++) name = d.fileName.replace(/(\.[a-z0-9]+)?$/i, ` (${n})$1`);
    used.add(name);
    zip.file(name, await response.arrayBuffer());
  }
  const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${owner.party} - ${file.label} - ${monthText(file.month)}.zip`.replace(/[\\/:*?"<>|]+/g, " ");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// An Excel of GSTR-1 / GSTR-2B JSON: one month, or the year's saved months
async function makeExcel(kind: PortalFile, owner: Owner, months: { month: string; docs: FileDoc[] }[], year: string | undefined, onProgress: (t: string | null) => void) {
  try {
    const { downloadGstExcel } = await import("./gst-excel-file");
    const done = await downloadGstExcel({ kind: kind as "GSTR1_JSON" | "GSTR2B_JSON", party: owner.party, gstin: owner.gstin, months, year, onProgress });
    toast.success(`Excel saved to Downloads${year ? ` (${done.months} month${done.months === 1 ? "" : "s"})` : ""}${done.skipped.length ? `. Not included: ${done.skipped.join(" · ")}` : ""}`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The Excel couldn't be made");
  } finally {
    onProgress(null);
  }
}

function SavedChip({ file, owner }: { file: PortalFileRow; owner: Owner }) {
  const [busy, setBusy] = useState<string | null>(null);
  const excel = EXCEL_KINDS.includes(file.kind);
  const chip = cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:underline", STATE_STYLES.saved);
  const icon = busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <StateIcon state="saved" />;
  // One file and nothing else to offer: the click downloads it
  if (!excel && file.docs.length === 1) {
    return (
      <a className={chip} href={documentUrl(file.docs[0].id)} target="_blank" rel="noreferrer" title={`${file.label}: saved – click to download`}>
        {icon}
        {file.label}
      </a>
    );
  }
  const all = async () => {
    setBusy("Downloading…");
    try {
      await downloadAll(file, owner);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't download them");
    } finally {
      setBusy(null);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chip} disabled={!!busy} title={busy ?? `${file.label}: saved – click to download${excel ? " or open as Excel" : ""}`}>
          {icon}
          {file.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-xs">
          {file.label} · {monthText(file.month)}
        </DropdownMenuLabel>
        {file.docs.length === 1 ? (
          <DropdownMenuItem asChild>
            <a href={documentUrl(file.docs[0].id)} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" /> Download
            </a>
          </DropdownMenuItem>
        ) : (
          <>
            {file.docs.map((d) => (
              <DropdownMenuItem key={d.id} asChild>
                <a href={documentUrl(d.id)} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" /> {docLabel(d, file.docs)}
                </a>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={all}>
              <Download className="h-4 w-4" /> Download all ({file.docs.length}, as a ZIP)
            </DropdownMenuItem>
          </>
        )}
        {excel && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => makeExcel(file.kind, owner, [{ month: file.month, docs: file.docs }], undefined, setBusy)}>
              <FileSpreadsheet className="h-4 w-4" /> Excel (a sheet per section)
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Legend() {
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

export function ClientGstPortal({ clientId, refresh }: { clientId: string; refresh: number }) {
  const [fy, setFy] = useState(fyOf(previousMonth()));
  const [data, setData] = useState<ClientPortalFiles | null>(null);
  const [loading, setLoading] = useState(false);
  // Files to fetch: the missing ones, unless staff untick them
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // A year's Excel being made ("Reading Sep 2026…")
  const [yearBusy, setYearBusy] = useState<string | null>(null);

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
  // Files saved from the GST download queue
  useOnGstSaved((saved) => {
    if (saved === clientId) load();
  });

  if (!data) return <Loader2 className="mx-auto my-4 h-5 w-5 animate-spin" />;
  if (!data.client.gstin?.trim()) {
    return <p className="text-sm text-muted-foreground">Save this client&apos;s GSTIN to see which GST files are missing.</p>;
  }

  const all = data.periods.flatMap((p) => p.files);
  const missing = all.filter((f) => f.state === "missing").length;
  const tick = (f: PortalFileRow, on: boolean) => tickMany([f], on);
  // Every file not saved yet can be ticked (as each chip's own box)
  const tickable = (files: PortalFileRow[]) => files.filter((f) => f.state !== "saved");
  function tickMany(files: PortalFileRow[], on: boolean) {
    setTicked((t) => {
      const next = new Set(t);
      for (const f of files) {
        if (on) next.add(fileKey(f));
        else next.delete(fileKey(f));
      }
      return next;
    });
  }
  // A month's or a column's box: ticked, partly, or not; null: nothing to tick
  const boxState = (files: PortalFileRow[]): boolean | "indeterminate" | null => {
    const can = tickable(files);
    if (!can.length) return null;
    const on = can.filter((f) => ticked.has(fileKey(f))).length;
    return on === 0 ? false : on === can.length ? true : "indeterminate";
  };
  const owner: Owner = { party: data.client.name, gstin: data.client.gstin.trim().toUpperCase() };
  const columns = COLUMN_ORDER.filter((kind) => all.some((f) => f.kind === kind && f.state !== "saved"));
  const yearLabel = `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
  // The year's saved GSTR-1 / GSTR-2B JSON, oldest month first
  const savedMonths = (kind: PortalFile) =>
    all
      .filter((f) => f.kind === kind && f.state === "saved" && f.docs?.length)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((f) => ({ month: f.month, docs: f.docs }));

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

      {(columns.length > 0 || EXCEL_KINDS.some((k) => savedMonths(k).length)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          {columns.length > 0 && (
            <>
              <span className="text-muted-foreground">Tick for the year:</span>
              {columns.map((kind) => {
                const files = all.filter((f) => f.kind === kind);
                const state = boxState(files);
                return (
                  <label key={kind} className="inline-flex cursor-pointer items-center gap-1.5">
                    <Checkbox className="h-3.5 w-3.5" checked={state ?? false} onCheckedChange={() => tickMany(tickable(files), state !== true)} />
                    {KIND_LABELS[kind]}
                  </label>
                );
              })}
            </>
          )}
          {EXCEL_KINDS.filter((k) => savedMonths(k).length).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={!!yearBusy}
              title={`Every saved ${KIND_LABELS[kind]} of ${yearLabel} in one workbook, a sheet per section, the month first on each row`}
              onClick={() => {
                setYearBusy("Starting…");
                makeExcel(kind, owner, savedMonths(kind), yearLabel, setYearBusy);
              }}
            >
              <FileSpreadsheet className="mr-1 h-3.5 w-3.5" /> {KIND_LABELS[kind].replace(" JSON", "")} Excel for {yearLabel}
            </Button>
          ))}
          {yearBusy && (
            <span className="text-muted-foreground">
              <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
              {yearBusy}
            </span>
          )}
        </div>
      )}

      {data.periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No months of this year are over yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {[...data.periods].reverse().map((p) => (
            <li key={p.start} className="flex flex-col gap-1.5 p-2 sm:flex-row sm:items-start">
              <span className="flex w-40 shrink-0 items-center gap-1.5 text-sm font-medium">
                {(() => {
                  const state = boxState(p.files);
                  return state === null ? (
                    <span className="inline-block w-3.5" />
                  ) : (
                    <Checkbox className="h-3.5 w-3.5" checked={state} aria-label={`Tick every file of ${p.title}`} onCheckedChange={() => tickMany(tickable(p.files), state !== true)} />
                  );
                })()}
                {p.title}
                {p.quarterly && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">Qtr</span>}
              </span>
              <span className="flex flex-wrap gap-1.5">
                {p.files.map((f) => (
                  <FileChip key={fileKey(f)} file={f} ticked={ticked.has(fileKey(f))} onTick={(on) => tick(f, on)} owner={owner} />
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
      />
    </div>
  );
}

// ─── The GST portal, through the extension and the download queue ───────────

// The year's tick boxes, in the order the chips show
const COLUMN_ORDER: PortalFile[] = ["GSTR1_JSON", "GSTR1_PDF", "GSTR1A_PDF", "GSTR3B_PDF", "GSTR2B_JSON"];

// The extension's state and the button that puts a client's files in the GST
// download queue (the bar at the bottom of the page shows the progress)
export function PortalLogin({ clientId, clientName, gstin, files, onQueued }: { clientId: string; clientName: string; gstin: string; files: Pick<PortalFileRow, "kind" | "month">[]; onQueued?: () => void }) {
  const queue = useGstDownloads();
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  if (!queue) return <p className="text-xs text-muted-foreground">Open Compliance to download from the GST portal.</p>;
  const { version, latest, mixed, run, jobs } = queue;

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
  const toFetch = fetching ? files : [];
  // This client's job in the queue, waiting or running
  const job = jobs.find((j) => j.clientId === clientId && jobActive(j));
  const started = !!job && job.state !== "queued";
  const ended = run && run.clientId === clientId && ENDED.includes(run.status) ? ENDED_TEXT[run.status] : null;

  const start = async () => {
    setBusy(true);
    try {
      if (await queue.enqueue({ clientId, clientName, gstin, files: toFetch.map((f) => ({ kind: f.kind, month: f.month })) })) onQueued?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || started || (!toFetch.length && !!job)} onClick={start}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : toFetch.length ? <Download className="mr-1 h-4 w-4" /> : <LogIn className="mr-1 h-4 w-4" />}
          {toFetch.length
            ? `${job && !started ? "Add" : "Download"} ${toFetch.length} file${toFetch.length === 1 ? "" : "s"} ${job && !started ? "to the queue" : "from the GST portal"}`
            : "Log in to the GST portal"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {started
            ? "Downloading for this client now: see GST downloads at the bottom of the page."
            : job
              ? "Waiting in the GST download queue at the bottom of the page."
              : ended && !toFetch.length
                ? ended
                : toFetch.length
                  ? "Opens the portal with the login filled in; you type the captcha and OTP. The files are then fetched and saved, and the portal logs out by itself. You can close this and keep working: progress shows at the bottom of the page."
                  : "Opens the portal in a new tab with the login filled in; you type the captcha and OTP."}
        </span>
      </div>
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
      <ExtensionVersion installed={version} latest={latest} needed={!fetching} busy={jobs.some(jobActive)} onUpdate={() => setInstalling(true)} />
      {installing && <InstallDialog update={version} latest={latest} onClose={() => setInstalling(false)} />}
    </div>
  );
}

const ENDED_TEXT: Partial<Record<PortalRun["status"], string>> = {
  "logged-out": "Logged out of the GST portal.",
  closed: "The GST portal tab was closed. If you were logged in, the portal logs out on its own after a while.",
  "timed-out": "Nobody completed the login in time, so the portal tab was closed.",
  failed: "The GST portal couldn't be opened.",
};

// ─── All clients in a month (Compliance → GST downloads) ────────────────────

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

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
                  <FileChip key={fileKey(f)} file={f} owner={r.gstin ? { party: r.name, gstin: r.gstin } : undefined} />
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
