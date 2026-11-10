"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronUp, Clock, Download, KeyRound, Loader2, LogOut, PanelTop, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fileKey, type PortalFile } from "@/lib/gst-portal";
import type { PortalSettings } from "@/lib/gst-portal-settings";
import {
  canFetch,
  compareVersions,
  ENDED,
  FetchedFile,
  gstExtensionVersion,
  isOpen,
  latestGstExtension,
  mixedExtensionFiles,
  onPortalStatus,
  PortalRun,
  portalFetch,
  portalLogin,
  portalLogout,
  portalStatus,
  showPortal,
} from "./gst-extension";
import { InstallDialog } from "./gst-extension-ui";
import { sendPortalFiles, type PortalSaved } from "./portal-files";
import { saveFilesHeadless, type ClientRef } from "./return-save";
import type { WorkType } from "./setup";
import { apiError } from "./types";

// The GST download queue (docs/GST_PORTAL_EXTENSION_PLAN.md): one for the
// whole Compliance page, so a download keeps going when the item popup or the
// client's page is closed. Each job is one client: log in once (staff type
// the captcha and OTP), fetch its files one by one, save each, log out, then
// the next client. The extension runs one portal login at a time. Progress
// shows in a bar at the bottom of the page; leaving the page stops it, so the
// browser asks first while it runs. GSTR-1 JSON is only asked for on a first
// pass; the bar then offers to collect it once the portal has made it.

export const KIND_LABELS: Record<PortalFile, string> = {
  GSTR1_JSON: "GSTR-1 JSON",
  GSTR1_PDF: "GSTR-1 PDF",
  GSTR1A_PDF: "GSTR-1A PDF",
  GSTR3B_PDF: "GSTR-3B PDF",
  GSTR2B_JSON: "GSTR-2B JSON",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthText = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const timeText = (at: number) => new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

// One file in a job
type FetchState = "waiting" | "fetching" | "saving" | "saved" | "check" | "downloaded" | "not-filed" | "not-available" | "requested" | "pending" | "not-taught" | "skipped" | "error";

export interface FetchRow {
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

const BUSY_ROW: FetchState[] = ["waiting", "fetching", "saving"];

// GSTR-1 JSON first (it is asked for and collected later), then the files
// that stay on the Returns Dashboard (GSTR-3B PDF), then those that open
// another page (GSTR-1 PDF, GSTR-2B): fewer page changes. Oldest first.
const PORTAL_FILE_ORDER: PortalFile[] = ["GSTR1_JSON", "GSTR3B_PDF", "GSTR1_PDF", "GSTR1A_PDF", "GSTR2B_JSON"];
const fetchOrder = (f: Pick<FetchRow, "kind" | "month">) => `${PORTAL_FILE_ORDER.indexOf(f.kind)}|${f.month}`;

// ─── GSTR-1 JSON asked for on the portal, to collect later ──────────────────

// Per client and month, in this browser: the portal makes the JSON in about
// 20 minutes after it is asked for; after 3 hours it is asked again
const COLLECT_KEY = "gst-json-collect";
const ASKED_FOR_MS = 3 * 60 * 60_000;
const READY_AFTER_MS = 20 * 60_000;

export interface ToCollect {
  clientId: string;
  clientName: string;
  gstin: string;
  month: string;
  at: number;
}

function readCollect(): ToCollect[] {
  try {
    const all = JSON.parse(localStorage.getItem(COLLECT_KEY) ?? "[]") as ToCollect[];
    return Array.isArray(all) ? all.filter((c) => c && Date.now() - c.at < ASKED_FOR_MS) : [];
  } catch {
    return [];
  }
}

function writeCollect(list: ToCollect[]) {
  try {
    localStorage.setItem(COLLECT_KEY, JSON.stringify(list));
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

// ─── The queue ──────────────────────────────────────────────────────────────

type JobState = "queued" | "opening" | "login" | "fetching" | "done" | "failed";

export interface DownloadJob {
  // Also the extension's run id
  id: string;
  clientId: string;
  clientName: string;
  gstin: string;
  rows: FetchRow[];
  state: JobState;
  note: string | null;
}

export const jobActive = (j: DownloadJob) => j.state !== "done" && j.state !== "failed";

interface Enqueue {
  clientId: string;
  clientName: string;
  gstin: string;
  // None: only log in, to work in the portal by hand
  files: { kind: PortalFile; month: string }[];
}

interface Queue {
  // undefined: not checked yet; null: not installed
  version: string | null | undefined;
  latest: string | null;
  mixed: string | null;
  run: PortalRun | null;
  jobs: DownloadJob[];
  // GSTR-1 JSON asked for on the portal, to collect
  collect: ToCollect[];
  enqueue: (job: Enqueue) => Promise<boolean>;
  openInstall: () => void;
  // Called with the client whose files were saved
  onSaved: (handler: (clientId: string) => void) => () => void;
}

const QueueContext = createContext<Queue | null>(null);

// null outside the Compliance page
export const useGstDownloads = () => useContext(QueueContext);

// Saved files refresh whatever shows them (the client's GST portal box,
// the sheet, an open item)
export function useOnGstSaved(handler: (clientId: string) => void) {
  const queue = useGstDownloads();
  const ref = useRef(handler);
  ref.current = handler;
  const subscribe = queue?.onSaved;
  useEffect(() => subscribe?.((clientId) => ref.current(clientId)), [subscribe]);
}

export function GstDownloadProvider({ workTypes, children }: { workTypes: WorkType[]; children: React.ReactNode }) {
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [latest, setLatest] = useState<string | null>(null);
  const [mixed, setMixed] = useState<string | null>(null);
  const [run, setRunState] = useState<PortalRun | null>(null);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [collect, setCollect] = useState<ToCollect[]>([]);
  const [installing, setInstalling] = useState(false);

  const workTypesRef = useRef(workTypes);
  workTypesRef.current = workTypes;
  const jobsRef = useRef<DownloadJob[]>([]);
  const runRef = useRef<PortalRun | null>(null);
  const waiters = useRef(new Set<() => void>());
  const stopped = useRef(new Set<string>());
  const pumping = useRef(false);
  const savedHandlers = useRef(new Set<(clientId: string) => void>());

  const setRun = useCallback((next: PortalRun | null) => {
    runRef.current = next;
    setRunState(next);
    for (const w of [...waiters.current]) w();
  }, []);

  // Resolves once the portal run matches
  const waitFor = (test: (r: PortalRun | null) => boolean) =>
    new Promise<void>((resolve) => {
      if (test(runRef.current)) return resolve();
      const w = () => {
        if (!test(runRef.current)) return;
        waiters.current.delete(w);
        resolve();
      };
      waiters.current.add(w);
    });

  const updateJobs = (change: (list: DownloadJob[]) => DownloadJob[]) => {
    jobsRef.current = change(jobsRef.current);
    setJobs(jobsRef.current);
  };
  const patchJob = (id: string, patch: Partial<DownloadJob>) => updateJobs((list) => list.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  const patchRow = (id: string, key: string, patch: Partial<FetchRow>) =>
    updateJobs((list) => list.map((j) => (j.id === id ? { ...j, rows: j.rows.map((r) => (fileKey(r) === key ? { ...r, ...patch } : r)) } : j)));

  const notifySaved = (clientId: string) => {
    for (const h of savedHandlers.current) h(clientId);
  };

  const updateCollect = (change: (list: ToCollect[]) => ToCollect[]) => {
    const next = change(readCollect());
    writeCollect(next);
    setCollect(next);
  };

  useEffect(() => {
    const installed = gstExtensionVersion();
    setVersion(installed);
    setCollect(readCollect());
    latestGstExtension().then(setLatest);
    if (!installed) return;
    portalStatus().then((a) => {
      if (!a.ok) return;
      setRun(a.run ?? null);
      setMixed(mixedExtensionFiles(a.version ?? installed, a.stamps));
    });
    return onPortalStatus(setRun);
  }, [setRun]);

  // Leaving the page stops the downloads: the browser asks first
  const working = jobs.some(jobActive);
  useEffect(() => {
    if (!working) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [working]);

  // Saved to Upload documents if it is on the page for this party (files
  // that need a look stay in its table), else saved here
  const save = async (clientId: string, files: File[], party: ClientRef[] | null): Promise<PortalSaved[] | null> => {
    const placed = await sendPortalFiles(clientId, files);
    if (placed) return placed;
    return party?.length ? saveFilesHeadless(files, party, workTypesRef.current) : null;
  };

  const process = async (job: DownloadJob) => {
    const runId = job.id;
    // Started: files asked for this client now go in a new job
    patchJob(runId, { state: "opening" });
    // One portal login at a time in this browser
    const other = runRef.current;
    if (isOpen(other) && other.runId !== runId) {
      patchJob(runId, { note: `Waiting: the GST portal is open for ${other.clientName}` });
      await waitFor((r) => !isOpen(r) || stopped.current.has(runId));
      patchJob(runId, { note: null });
    }
    if (stopped.current.has(runId)) {
      patchJob(runId, { state: "failed", note: "Stopped", rows: job.rows.map((r) => ({ ...r, state: "skipped", message: "Stopped" })) });
      return;
    }

    let answer: { settings: PortalSettings; login: { username: string; password: string } | null; party?: ClientRef[] };
    try {
      answer = (await axios.post("/api/compliance/gst-portal/login", { clientId: job.clientId })).data;
    } catch (e) {
      patchJob(runId, { state: "failed", note: apiError(e, "Could not get the GST login") });
      return;
    }
    const opened = await portalLogin({ runId, clientId: job.clientId, clientName: job.clientName, settings: answer.settings, login: answer.login, autoLogout: job.rows.length > 0 });
    if (opened.run !== undefined) setRun(opened.run ?? null);
    if (!opened.ok) {
      patchJob(runId, { state: "failed", note: opened.error ?? "The GST portal couldn't be opened" });
      return;
    }
    patchJob(runId, { state: "login" });
    await waitFor((r) => !!r && r.runId === runId && (r.status === "logged-in" || ENDED.includes(r.status)));
    if (runRef.current?.status !== "logged-in") {
      patchJob(runId, {
        state: "done",
        note: "Not logged in",
        rows: job.rows.map((r) => ({ ...r, state: "skipped", message: "Not logged in" })),
      });
      return;
    }
    // Only a login: done when staff log out
    if (!job.rows.length) {
      await waitFor((r) => !r || r.runId !== runId || ENDED.includes(r.status));
      patchJob(runId, { state: "done" });
      return;
    }

    patchJob(runId, { state: "fetching" });
    const party = answer.party ?? null;
    const saves: Promise<void>[] = [];
    let stop: string | null = null;
    for (const f of job.rows) {
      const key = fileKey(f);
      if (!stop && stopped.current.has(runId)) stop = "Stopped";
      if (stop) {
        patchRow(runId, key, { state: "skipped", message: stop });
        continue;
      }
      patchRow(runId, key, { state: "fetching", message: null });
      const asked = f.kind === "GSTR1_JSON" ? readCollect().find((c) => c.clientId === job.clientId && c.month === f.month)?.at ?? null : null;
      const got = await portalFetch(runId, { kind: f.kind, month: f.month, label: f.label });
      if (!got.ok) {
        patchRow(runId, key, { state: "error", message: got.error ?? "The GST extension couldn't fetch it" });
        if (/log in|not open|didn't answer/i.test(got.error ?? "")) stop = "The portal login ended";
        continue;
      }
      const message = got.message ?? null;
      switch (got.result) {
        case "file":
        case "downloaded": {
          if (f.kind === "GSTR1_JSON") updateCollect((list) => list.filter((c) => !(c.clientId === job.clientId && c.month === f.month)));
          if (got.result === "downloaded" && !got.files?.length) {
            patchRow(runId, key, { state: "downloaded", message });
            break;
          }
          const period = `${f.month.slice(5, 7)}${f.month.slice(0, 4)}`;
          const fetched = (got.files ?? []).map((x, i) => toFile(x, `${f.kind}_${job.gstin}_${period}${(got.files?.length ?? 0) > 1 ? `_${i + 1}` : ""}`));
          patchRow(runId, key, { state: "saving", message: null });
          saves.push(
            save(job.clientId, fetched, party).then(
              (placed) => {
                const held = placed?.filter((p) => !p.ok) ?? [];
                patchRow(
                  runId,
                  key,
                  !placed
                    ? { state: "error", message: "Couldn't save it: open the client's page and try again" }
                    : !placed.length
                      ? { state: "error", message: "The file from the portal couldn't be read" }
                      : held.length
                        ? { state: "check", message: held.map((p) => `${p.name}: ${p.message}`).join(" · ") }
                        : got.result === "downloaded"
                          ? { state: "downloaded", message }
                          : { state: "saved", message: placed.map((p) => [p.name, p.message].filter(Boolean).join(" – ")).join(", ") }
                );
                if (placed?.some((p) => p.ok)) notifySaved(job.clientId);
              },
              (e) => patchRow(runId, key, { state: "error", message: apiError(e, "Couldn't save it") })
            )
          );
          break;
        }
        case "requested":
          if (!asked) updateCollect((list) => [...list, { clientId: job.clientId, clientName: job.clientName, gstin: job.gstin, month: f.month, at: Date.now() }]);
          patchRow(runId, key, {
            state: asked ? "pending" : "requested",
            message: [
              message && `Portal: ${message}`,
              asked ? `First asked at ${timeText(asked)}; collect it in a few minutes.` : "The portal prepares it in about 20 minutes: collect it from the bar after that.",
            ]
              .filter(Boolean)
              .join(" "),
          });
          break;
        case "pending":
          if (!asked) updateCollect((list) => [...list, { clientId: job.clientId, clientName: job.clientName, gstin: job.gstin, month: f.month, at: Date.now() }]);
          patchRow(runId, key, { state: "pending", message: asked ? `Asked for at ${timeText(asked)}; try again in a few minutes.` : message });
          break;
        case "session-expired":
          patchRow(runId, key, { state: "error", message: "The portal session ended" });
          stop = "The portal session ended: log in again";
          break;
        case "access-denied":
          // Asking again would only be refused again
          patchRow(runId, key, { state: "error", message });
          stop = "Stopped: the GST portal refused access";
          break;
        case "not-filed":
        case "not-available":
        case "not-taught":
          patchRow(runId, key, { state: got.result, message });
          break;
        default:
          patchRow(runId, key, { state: "error", message: message ?? "The portal didn't give the file" });
      }
    }
    // Done with the portal: log out without anybody clicking
    const now = await portalStatus();
    if (now.ok && now.run?.runId === runId && isOpen(now.run)) {
      const out = await portalLogout(runId);
      if (out.run !== undefined) setRun(out.run ?? null);
    }
    await Promise.all(saves);
    patchJob(runId, { state: "done" });
  };

  // One job after another
  const pump = async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const next = jobsRef.current.find((j) => j.state === "queued");
        if (!next) break;
        try {
          await process(next);
        } catch (e) {
          patchJob(next.id, { state: "failed", note: apiError(e, "The download stopped") });
        }
      }
    } finally {
      pumping.current = false;
    }
  };

  const enqueue = async ({ clientId, clientName, gstin, files }: Enqueue) => {
    const installed = gstExtensionVersion();
    if (!installed) {
      setInstalling(true);
      return false;
    }
    if (files.length) {
      // Checked when clicked, not when this page loaded: the extension asked
      // for the version it is running now, the app server for the newest one
      const [status, newest] = await Promise.all([portalStatus(), latestGstExtension()]);
      const running = status.version ?? installed;
      if (newest) setLatest(newest);
      setVersion(running);
      const odd = status.ok ? mixedExtensionFiles(running, status.stamps) : null;
      setMixed(odd);
      if (odd) {
        setInstalling(true);
        toast.error(`The GST extension on this computer mixes files of different versions (${odd}): reinstall it as the guide says, then reload this page.`);
        return false;
      }
      if (!canFetch(running) || (newest && compareVersions(running, newest) < 0)) {
        setInstalling(true);
        toast.error(`This computer runs GST extension ${running}; update it${newest ? ` to ${newest}` : ""} first, then reload this page.`);
        return false;
      }
    }
    const rows: FetchRow[] = files
      .map((f) => ({ kind: f.kind, month: f.month, label: `${KIND_LABELS[f.kind]} ${monthText(f.month)}`, state: "waiting" as const, message: null }))
      .sort((a, b) => fetchOrder(a).localeCompare(fetchOrder(b)));
    // Added to this client's job that hasn't started yet
    const waiting = jobsRef.current.find((j) => j.state === "queued" && j.clientId === clientId);
    if (waiting && rows.length) {
      const have = new Set(waiting.rows.map(fileKey));
      const merged = [...waiting.rows, ...rows.filter((r) => !have.has(fileKey(r)))].sort((a, b) => fetchOrder(a).localeCompare(fetchOrder(b)));
      patchJob(waiting.id, { rows: merged });
    } else {
      updateJobs((list) => [...list, { id: crypto.randomUUID(), clientId, clientName, gstin, rows, state: "queued", note: null }]);
    }
    const ahead = jobsRef.current.filter((j) => jobActive(j) && j.clientId !== clientId).length;
    if (ahead) toast.info(`${clientName} is in the GST download queue (${ahead} ahead)`);
    pump();
    return true;
  };

  const stopJob = async (job: DownloadJob) => {
    stopped.current.add(job.id);
    for (const w of [...waiters.current]) w();
    if (job.state === "queued") {
      updateJobs((list) => list.filter((j) => j.id !== job.id));
      return;
    }
    const live = runRef.current;
    if (live && live.runId === job.id && isOpen(live)) {
      const out = await portalLogout(job.id);
      if (out.run !== undefined) setRun(out.run ?? null);
    }
  };

  const onSaved = useCallback((handler: (clientId: string) => void) => {
    savedHandlers.current.add(handler);
    return () => {
      savedHandlers.current.delete(handler);
    };
  }, []);

  const value = useMemo<Queue>(
    () => ({ version, latest, mixed, run, jobs, collect, enqueue, openInstall: () => setInstalling(true), onSaved }),
    // enqueue only reads refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, latest, mixed, run, jobs, collect, onSaved]
  );

  return (
    <QueueContext.Provider value={value}>
      {children}
      <DownloadBar
        jobs={jobs}
        run={run}
        collect={collect}
        onStop={stopJob}
        onClear={() => updateJobs((list) => list.filter(jobActive))}
        onCollect={(items) => {
          const first = items[0];
          enqueue({ clientId: first.clientId, clientName: first.clientName, gstin: first.gstin, files: items.map((c) => ({ kind: "GSTR1_JSON", month: c.month })) });
        }}
        onDismissCollect={(item) => updateCollect((list) => list.filter((c) => !(c.clientId === item.clientId && c.month === item.month)))}
      />
      {installing && <InstallDialog update={version ?? null} latest={latest} onClose={() => setInstalling(false)} />}
    </QueueContext.Provider>
  );
}

// ─── The bar at the bottom of the page ──────────────────────────────────────

function DownloadBar({
  jobs,
  run,
  collect,
  onStop,
  onClear,
  onCollect,
  onDismissCollect,
}: {
  jobs: DownloadJob[];
  run: PortalRun | null;
  collect: ToCollect[];
  onStop: (job: DownloadJob) => void;
  onClear: () => void;
  onCollect: (items: ToCollect[]) => void;
  onDismissCollect: (item: ToCollect) => void;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  // Ticks so "ready about" turns into "ready now"
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!collect.length) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [collect.length]);

  const current = jobs.find((j) => j.state === "opening" || j.state === "login" || j.state === "fetching") ?? null;
  const queued = jobs.filter((j) => j.state === "queued");
  const finished = jobs.filter((j) => !jobActive(j));
  // A login started elsewhere (before this page loaded) that isn't in the queue
  const foreign = isOpen(run) && !jobs.some((j) => j.id === run.runId) ? run : null;
  const mine = current && run?.runId === current.id && isOpen(run) ? run : null;
  // JSON already being collected isn't offered again
  const collecting = new Set(jobs.filter(jobActive).flatMap((j) => j.rows.filter((r) => r.kind === "GSTR1_JSON").map((r) => `${j.clientId}:${r.month}`)));
  const toCollect = collect.filter((c) => !collecting.has(`${c.clientId}:${c.month}`));
  if (!jobs.length && !toCollect.length && !foreign) return null;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const done = current ? current.rows.filter((r) => !BUSY_ROW.includes(r.state)).length : 0;
  const summary = current
    ? `${current.clientName}${current.rows.length ? ` · ${done} of ${current.rows.length}` : ""}`
    : queued.length
      ? `${queued.length} client${queued.length === 1 ? "" : "s"} waiting`
      : toCollect.length
        ? `${toCollect.length} GSTR-1 JSON to collect`
        : foreign
          ? `GST portal open for ${foreign.clientName}`
          : "GST downloads finished";

  // Grouped by client, oldest asked first
  const collectGroups = [...new Set(toCollect.map((c) => c.clientId))].map((id) => toCollect.filter((c) => c.clientId === id).sort((a, b) => a.at - b.at));

  return (
    <div className="fixed bottom-3 right-3 z-50 w-[min(30rem,calc(100vw-1.5rem))] rounded-lg border bg-background text-sm shadow-xl">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {current ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate font-medium">GST downloads · {summary}</span>
        {!current && !queued.length && finished.length > 0 && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClear}>
            Clear
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(!open)} aria-label={open ? "Hide details" : "Show details"}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
      </div>
      {mine?.ask && (
        // Shown even when folded: nothing moves until staff click it
        <div className="m-2 flex flex-wrap items-center gap-2 rounded-md border-2 border-amber-400 bg-amber-50 p-2 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>
            Your turn: click <span className="font-semibold">“{mine.ask}”</span> in the GST portal tab (highlighted in orange).
          </span>
          <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => act(() => showPortal(mine.runId))}>
            <PanelTop className="mr-1 h-3.5 w-3.5" /> Show the portal tab
          </Button>
        </div>
      )}
      {!open && mine?.status === "waiting-login" && (
        <p className="px-3 py-2 text-amber-800 dark:text-amber-300">
          <KeyRound className="mr-1 inline h-4 w-4" />
          Type the captcha (and OTP) in the GST portal tab.
        </p>
      )}
      {open && (
        <div className="max-h-[50vh] space-y-3 overflow-y-auto p-3">
          {foreign && (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                The GST portal is open for <span className="font-medium">{foreign.clientName}</span> (one client at a time in this browser).
              </span>
              <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => act(() => showPortal(foreign.runId))}>
                <PanelTop className="mr-1 h-3.5 w-3.5" /> Show
              </Button>
              <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => act(() => portalLogout(foreign.runId))}>
                <LogOut className="mr-1 h-3.5 w-3.5" /> Log out there
              </Button>
            </div>
          )}

          {current && (
            <div className="space-y-2">
              <p className="font-medium">{current.clientName}</p>
              {current.note && <p className="text-xs text-muted-foreground">{current.note}</p>}
              {current.state === "opening" && !current.note && (
                <p>
                  <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
                  Opening the GST portal…
                </p>
              )}
              {mine?.status === "waiting-login" && (
                <p className="text-amber-800 dark:text-amber-300">
                  <KeyRound className="mr-1 inline h-4 w-4" />
                  Type the captcha (and the OTP, if asked) in the GST portal tab.
                  {current.rows.length ? " The files are then fetched and the portal logs out by itself." : ""}
                </p>
              )}
              {mine?.status === "logged-in" && (
                <p className="text-emerald-700 dark:text-emerald-400">
                  {mine.doing ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Check className="mr-1 inline h-4 w-4" />}
                  {mine.doing ? `Fetching ${mine.doing}…` : current.rows.length ? "Logged in." : "Logged in: work in the portal tab, then log out here."}
                </p>
              )}
              {mine?.status === "logging-out" && (
                <p>
                  <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
                  Logging out…
                </p>
              )}
              {mine?.note && <p className="text-xs text-amber-700 dark:text-amber-400">{mine.note}</p>}
              {mine?.status === "logged-in" && mine.clicks !== "assisted" && current.state === "fetching" && (
                <p className="text-xs text-muted-foreground">
                  Chrome shows a bar “MV Company GST portal started debugging this browser” while it clicks the portal&apos;s buttons. Don&apos;t press Cancel on it: it goes when the
                  portal logs out.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {mine && (
                  <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => act(() => showPortal(mine.runId))}>
                    <PanelTop className="mr-1 h-3.5 w-3.5" /> Show the portal tab
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7" disabled={busy || mine?.status === "logging-out"} onClick={() => act(async () => onStop(current))}>
                  <LogOut className="mr-1 h-3.5 w-3.5" /> {current.rows.length ? "Stop and log out" : mine?.status === "logged-in" ? "Log out" : "Cancel"}
                </Button>
              </div>
              <FileRows rows={current.rows} />
            </div>
          )}

          {queued.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Waiting (one client at a time)</p>
              {queued.map((j) => (
                <div key={j.id} className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {j.clientName} · {j.rows.length ? `${j.rows.length} file${j.rows.length === 1 ? "" : "s"}` : "log in only"}
                    {j.note && <span className="text-muted-foreground"> · {j.note}</span>}
                  </span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onStop(j)} aria-label={`Remove ${j.clientName} from the queue`}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {collectGroups.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">GSTR-1 JSON asked for on the portal</p>
              {collectGroups.map((items) => {
                const readyAt = Math.max(...items.map((c) => c.at)) + READY_AFTER_MS;
                const ready = now >= readyAt;
                return (
                  <div key={items[0].clientId} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{items[0].clientName}</span> · {items.map((c) => monthText(c.month)).join(", ")}
                      <span className={cn("ml-1 text-xs", ready ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                        {ready ? "should be ready now" : `asked ${timeText(items[0].at)}, ready about ${timeText(readyAt)}`}
                      </span>
                    </span>
                    <Button size="sm" variant={ready ? "default" : "outline"} className="h-7" onClick={() => onCollect(items)}>
                      <Download className="mr-1 h-3.5 w-3.5" /> Collect
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => items.forEach(onDismissCollect)} aria-label="Forget">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {finished.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Finished</p>
              {[...finished].reverse().map((j) => (
                <FinishedJob key={j.id} job={j} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FinishedJob({ job }: { job: DownloadJob }) {
  const [open, setOpen] = useState(false);
  const saved = job.rows.filter((r) => r.state === "saved").length;
  const other = job.rows.length - saved;
  const text = job.state === "failed" ? job.note ?? "Failed" : !job.rows.length ? "Logged out" : `${saved} saved${other ? ` · ${other} not saved` : ""}`;
  return (
    <div>
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)} disabled={!job.rows.length}>
        {job.state === "failed" || other ? <X className="h-3.5 w-3.5 shrink-0 text-amber-700" /> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
        <span className="min-w-0 flex-1 truncate">
          {job.clientName} · <span className={cn(job.state === "failed" || other ? "text-amber-800 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400")}>{text}</span>
        </span>
        {job.rows.length > 0 && (open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />)}
      </button>
      {open && <FileRows rows={job.rows} />}
    </div>
  );
}

function FileRows({ rows }: { rows: FetchRow[] }) {
  if (!rows.length) return null;
  return (
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
  );
}
