"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, CircleDashed, Clock, Download, ExternalLink, KeyRound, LogIn, LogOut, Loader2, PanelTop, Puzzle, UserCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fileKey, PORTAL_RETURNS, PortalFileRow, PortalFileState, PortalReturn, RETURN_LABELS, RETURN_OF, STATE_LABELS } from "@/lib/gst-portal";
import type { ClientPortalFiles, RoundPortalFiles } from "@/lib/gst-portal-files";
import type { PortalSettings } from "@/lib/gst-portal-settings";
import { downloadGstExtension, gstExtensionVersion, isOpen, onPortalStatus, PortalRun, portalLogin, portalLogout, portalStatus, showPortal } from "./gst-extension";
import { FyStepper, fyOf, previousMonth } from "./gst-working";
import { apiError, currentMonthKey } from "./types";

// GST portal downloads (docs/GST_PORTAL_EXTENSION_PLAN.md). Stage 1: which
// GST return files are saved in the app and which are missing, on the
// client's page (below the GST working) and for all clients in a month (the
// download round). Stage 2: open the GST portal with the client's login
// filled in through the browser extension; staff type the captcha and OTP.
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

export function ClientGstPortal({ clientId, refresh }: { clientId: string; refresh: number }) {
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
      <PortalLogin clientId={data.client.id} clientName={data.client.name} ticked={ticked.size} />
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

function PortalLogin({ clientId, clientName, ticked }: { clientId: string; clientName: string; ticked: number }) {
  // undefined: not checked yet (the page has just loaded)
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [run, setRun] = useState<PortalRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const installed = gstExtensionVersion();
    setVersion(installed);
    if (!installed) return;
    portalStatus().then((a) => a.ok && setRun(a.run ?? null));
    return onPortalStatus(setRun);
  }, []);

  if (version === undefined) return null;
  if (!version) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-2 text-sm">
        <span className="text-muted-foreground">Install the GST extension (Chrome or Edge) to log in to the GST portal from here.</span>
        <Button size="sm" variant="outline" onClick={() => setInstalling(true)}>
          <Puzzle className="mr-1 h-4 w-4" /> Install the GST extension
        </Button>
        {installing && <InstallDialog onClose={() => setInstalling(false)} />}
      </div>
    );
  }

  const act = async (work: () => Promise<{ ok: boolean; error?: string; run?: PortalRun | null }>) => {
    setBusy(true);
    try {
      const answer = await work();
      if (answer.run !== undefined) setRun(answer.run ?? null);
      if (!answer.ok) toast.error(answer.error ?? "The GST extension couldn't do that");
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    act(async () => {
      let answer: { settings: PortalSettings; login: { username: string; password: string } | null };
      try {
        answer = (await axios.post("/api/compliance/gst-portal/login", { clientId })).data;
      } catch (e) {
        return { ok: false, error: apiError(e, "Could not get the GST login") };
      }
      return portalLogin({ runId: crypto.randomUUID(), clientId, clientName, settings: answer.settings, login: answer.login });
    });

  // The portal tab open now (for this client or another)
  const live = isOpen(run) ? run : null;
  const mine = live?.clientId === clientId ? live : null;

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
              </span>
            )}
            {mine.status === "logged-in" && (
              <span className="text-emerald-700 dark:text-emerald-400">
                <Check className="mr-1 inline h-4 w-4" />
                Logged in to the GST portal.
              </span>
            )}
            {mine.status === "logging-out" && (
              <span>
                <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
                Logging out…
              </span>
            )}
          </p>
          {mine.note && <p className="text-xs text-amber-700 dark:text-amber-400">{mine.note}</p>}
          {mine.status === "logged-in" && (
            <p className="text-xs text-muted-foreground">
              Fetching the ticked files from here comes in the next update. For now, download them in the portal tab, upload them with Upload
              documents above, then log out.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => showPortal(mine.runId))}>
              <PanelTop className="mr-1 h-4 w-4" /> Show the portal tab
            </Button>
            <Button size="sm" variant="outline" disabled={busy || mine.status === "logging-out"} onClick={() => act(() => portalLogout(mine.runId))}>
              <LogOut className="mr-1 h-4 w-4" /> {mine.status === "logged-in" ? "Log out and close" : "Cancel"}
            </Button>
          </div>
        </div>
      )}
      {!live && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={start}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <LogIn className="mr-1 h-4 w-4" />}
            Log in to the GST portal
          </Button>
          <span className="text-xs text-muted-foreground">
            {run && run.clientId === clientId && ENDED_TEXT[run.status]
              ? ENDED_TEXT[run.status]
              : `Opens the portal in a new tab with the login filled in; you type the captcha and OTP.${ticked ? ` ${ticked} file${ticked === 1 ? "" : "s"} ticked.` : ""}`}
          </span>
        </div>
      )}
    </div>
  );
}

function InstallDialog({ onClose }: { onClose: () => void }) {
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
          <DialogTitle>Install the GST extension</DialogTitle>
          <DialogDescription>Once on each computer, in Chrome or Edge. It only works on the GST portal and on this app.</DialogDescription>
        </DialogHeader>
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
        <p className="text-xs text-muted-foreground">
          To update it later, download it again, replace the folder&apos;s files and click the reload arrow on the extension in the extensions page.
        </p>
        <DialogFooter>
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
