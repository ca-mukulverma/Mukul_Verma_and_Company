"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiError } from "@/components/compliance/types";
import { cn } from "@/lib/utils";
import { agoText, asOfText, ENTITY_LABELS, freshness, nextSlot, type DebtorEntity } from "@/lib/tally-debtors-shared";
import type { SyncStatus } from "@/lib/tally-debtors";

// Debtors (docs/TALLY_DEBTORS.md): when a firm's (MVC, B Edge) Tally data was
// read, shown large on every Debtors screen with Refresh now, so an old
// ledger isn't sent. Each firm has its own Tally PC, time and Refresh now.

const POLL_MS = 5000;
const GIVE_UP_MS = 6 * 60_000;
// The Tally PC checks in every 30 seconds while it is on
const PC_AWAY_MS = 3 * 60_000;

export function useSyncStatus(entity: DebtorEntity, initial: SyncStatus | null, onUpdated: () => void) {
  const [status, setStatus] = useState<SyncStatus | null>(initial);
  const [waiting, setWaiting] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updated = useRef(onUpdated);
  updated.current = onUpdated;

  useEffect(() => setStatus(initial), [initial]);

  // The "x min ago" and the missed-update check move on by themselves
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const watch = useCallback((sinceReadAt: string | null, askedAt: number) => {
    const check = async () => {
      try {
        const { data } = await axios.get<SyncStatus>("/api/debtors/status", { params: { entity } });
        setStatus(data);
        setNow(new Date());
        if (data.readAt && data.readAt !== sinceReadAt) {
          setWaiting(false);
          toast.success(`${ENTITY_LABELS[entity]} updated from Tally: data as of ${asOfText(data.readAt)}`);
          updated.current();
          return;
        }
        if (data.error && new Date(data.error.at).getTime() >= askedAt - 1000) {
          setWaiting(false);
          toast.error(`${ENTITY_LABELS[entity]}: Tally could not be read: ${data.error.message}`, { duration: 10_000 });
          return;
        }
      } catch {
        // Try again at the next check
      }
      if (Date.now() - askedAt > GIVE_UP_MS) {
        setWaiting(false);
        toast.error(`${ENTITY_LABELS[entity]}'s Tally PC didn't answer. It may be off, or Chrome isn't open on it.`, { duration: 10_000 });
        return;
      }
      timer.current = setTimeout(check, POLL_MS);
    };
    timer.current = setTimeout(check, POLL_MS);
  }, [entity]);

  const refresh = useCallback(async () => {
    if (waiting) return;
    const askedAt = Date.now();
    setWaiting(true);
    try {
      const { data } = await axios.post<SyncStatus>("/api/debtors/refresh", { entity });
      setStatus(data);
      watch(status?.readAt ?? null, askedAt);
    } catch (error) {
      setWaiting(false);
      toast.error(apiError(error, "Could not ask the Tally PC"));
    }
  }, [entity, waiting, watch, status?.readAt]);

  return { entity, status, waiting, refresh, now };
}

export type SyncStatusState = ReturnType<typeof useSyncStatus>;

// The large "Tally data as of …" box with Refresh now
export function UpdateBanner({ sync, className, compact = false }: { sync: SyncStatusState; className?: string; compact?: boolean }) {
  const { entity, status, waiting, refresh, now } = sync;
  if (!status) return null;
  const fresh = freshness(status.readAt, now);
  const pcAway = status.connected && (!status.seenAt || now.getTime() - new Date(status.seenAt).getTime() > PC_AWAY_MS);
  const next = nextSlot(now);
  const tone =
    fresh.level === "fresh"
      ? "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50"
      : fresh.level === "stale"
        ? "border-red-500 bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-50"
        : "border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50";

  return (
    <div className={cn("rounded-lg border-2 p-4", tone, className)} role="status" aria-live="polite" data-showme={entity === "MVC" ? "debtors-refresh" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          {fresh.level === "fresh" ? (
            <CheckCircle2 className="mt-1 h-7 w-7 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className={cn("mt-1 h-7 w-7 shrink-0", fresh.level === "stale" ? "text-red-600" : "text-amber-600")} />
          )}
          <div>
            {status.readAt ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wide opacity-80">
                  {ENTITY_LABELS[entity]}
                  {status.company ? ` (${status.company})` : ""} · Tally data as of
                </p>
                <p className={cn("font-bold leading-tight", compact ? "text-xl" : "text-2xl")}>{asOfText(status.readAt)}</p>
                <p className="text-sm">
                  Updated {agoText(status.readAt, now)}
                  {status.trigger === "refresh" ? " (Refresh now)" : status.trigger === "scheduled" ? " (scheduled update)" : ""}
                </p>
              </>
            ) : (
              <p className="text-xl font-bold">{ENTITY_LABELS[entity]}: no data from Tally yet</p>
            )}
            {fresh.level === "stale" && (
              <p className="mt-1 text-sm font-semibold">
                The update due at {asOfText(fresh.missedSince).split(", ")[1]} on {asOfText(fresh.missedSince).split(", ")[0]} did not come.
                Entries made in Tally since then are not here: press Refresh now before sending a ledger.
              </p>
            )}
            {!status.connected && (
              <p className="mt-1 text-sm font-semibold">
                No Tally PC is connected for {ENTITY_LABELS[entity]}. Admin connects it from this page, on the PC where its Tally runs.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button size={compact ? "default" : "lg"} onClick={refresh} disabled={waiting || !status.connected} className="min-w-44">
            {waiting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <RefreshCw className="mr-2 h-5 w-5" />}
            {waiting ? "Updating from Tally…" : compact ? `Refresh ${ENTITY_LABELS[entity]}` : "Refresh now"}
          </Button>
          {next && !waiting && (
            <span className="flex items-center gap-1 text-xs opacity-80">
              <Clock className="h-3 w-3" /> Next scheduled update {asOfText(next)}
            </span>
          )}
        </div>
      </div>
      {waiting && (
        <p className="mt-3 text-sm">
          Asking the Tally PC. It checks every 30 seconds, then reads Tally; this usually takes 1–3 minutes. You can keep working.
        </p>
      )}
      {status.connected && pcAway && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium">
          <WifiOff className="h-4 w-4" />
          {status.seenAt
            ? `${ENTITY_LABELS[entity]}'s Tally PC last checked in ${agoText(status.seenAt, now)}.`
            : `${ENTITY_LABELS[entity]}'s Tally PC hasn't checked in yet.`}{" "}
          It may be off, or Chrome isn&apos;t open on it.
        </p>
      )}
      {status.error && (
        <p className="mt-2 text-sm font-medium">
          Last try {agoText(status.error.at, now)} failed: {status.error.message} Press Refresh now once it is fixed.
        </p>
      )}
    </div>
  );
}
