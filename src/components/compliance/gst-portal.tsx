"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, CircleDashed, Clock, ExternalLink, KeyRound, Loader2, UserCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { fileKey, PORTAL_RETURNS, PortalFileRow, PortalFileState, PortalReturn, RETURN_LABELS, RETURN_OF, STATE_LABELS } from "@/lib/gst-portal";
import type { ClientPortalFiles, RoundPortalFiles } from "@/lib/gst-portal-files";
import { FyStepper, fyOf, previousMonth } from "./gst-working";
import { apiError, currentMonthKey } from "./types";

// GST portal downloads (docs/GST_PORTAL_EXTENSION_PLAN.md). Stage 1: which
// GST return files are saved in the app and which are missing, on the
// client's page (below the GST working) and for all clients in a month (the
// download round). Nothing here polls: it loads when opened and after uploads.

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
      <p className="text-xs text-muted-foreground">
        {ticked.size} file{ticked.size === 1 ? "" : "s"} ticked. Until downloading from the portal is ready, download the ticked files by hand and use
        Upload documents above.
      </p>
    </div>
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
