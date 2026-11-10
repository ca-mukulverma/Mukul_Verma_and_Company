"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { History, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fileKey, isItemFile, itemMonths, PortalFileRow, PortalPeriod } from "@/lib/gst-portal";
import type { ClientPortalFiles } from "@/lib/gst-portal-files";
import { FileChip, Legend, PortalLogin, type Owner } from "./gst-portal";
import { useOnGstSaved } from "./gst-download-queue";
import { fyOf } from "./gst-working";
import { apiError } from "./types";

// Download from the GST portal, opened from a filed GSTR-1 / GSTR-3B (the
// item popup, or the icon on its sheet row). This return's files come first,
// ticked when missing: GSTR-1 JSON and PDF; GSTR-3B PDF and GSTR-2B JSON (a
// quarter's three months). Below, every other file of the client still
// missing this financial year up to this period (and, on request, the year
// before), to fetch in the same login. The download runs in the GST
// download queue, so this can be closed straight away.

interface Props {
  item: { kind: string; periodStart: string; frequency: string; period: string; workTypeName: string };
  client: { id: string; name: string; gstin: string | null };
  onClose: () => void;
}

const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;

export function PortalDownloadDialog({ item, client, onClose }: Props) {
  const months = useMemo(() => itemMonths(item.periodStart, item.frequency), [item.periodStart, item.frequency]);
  const last = months[months.length - 1];
  const fy = fyOf(last);
  const [data, setData] = useState<ClientPortalFiles | null>(null);
  const [earlier, setEarlier] = useState<ClientPortalFiles | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ticked, setTicked] = useState<Set<string> | null>(null);

  const get = useCallback((year: number) => axios.get<ClientPortalFiles>("/api/compliance/gst-portal", { params: { clientId: client.id, fy: year } }).then((r) => r.data), [client.id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [now, before] = await Promise.all([get(fy), showEarlier ? get(fy - 1) : Promise.resolve(null)]);
      setData(now);
      setEarlier(before);
      // This return's missing files, ticked the first time
      setTicked((t) => t ?? new Set(now.periods.flatMap((p) => p.files).filter((f) => f.state === "missing" && isItemFile(f, item.kind, months)).map(fileKey)));
    } catch (e) {
      toast.error(apiError(e, "Could not load the GST files"));
    } finally {
      setLoading(false);
    }
  }, [get, fy, showEarlier, item.kind, months]);
  useEffect(() => {
    load();
  }, [load]);
  useOnGstSaved((saved) => {
    if (saved === client.id) load();
  });

  const gstin = client.gstin?.trim().toUpperCase() ?? "";
  const owner: Owner = { party: client.name, gstin };
  const on = ticked ?? new Set<string>();
  const tickMany = (files: PortalFileRow[], yes: boolean) =>
    setTicked((t) => {
      const next = new Set(t);
      for (const f of files) {
        if (yes) next.add(fileKey(f));
        else next.delete(fileKey(f));
      }
      return next;
    });

  // This return's files (saved ones show as saved)
  const own = (data?.periods ?? []).flatMap((p) => p.files).filter((f) => isItemFile(f, item.kind, months));
  const ownTickable = own.filter((f) => f.state === "missing" || f.state === "if_filed");
  // Every other missing file, a period a row, newest first
  const otherPeriods = (periods: PortalPeriod[], upTo: string | null) =>
    [...periods]
      .reverse()
      .map((p) => ({ ...p, files: p.files.filter((f) => f.state === "missing" && !isItemFile(f, item.kind, months) && (!upTo || f.month <= upTo)) }))
      .filter((p) => p.files.length);
  const others = [...otherPeriods(data?.periods ?? [], last), ...(showEarlier && earlier ? otherPeriods(earlier.periods, null) : [])];
  const otherFiles = others.flatMap((p) => p.files);
  // Files ticked, from this year and the one before (a period's month is unique)
  const all = [...own, ...otherFiles];
  const chosen = all.filter((f) => on.has(fileKey(f)) && f.state !== "saved" && f.state !== "not_yet");

  const boxState = (files: PortalFileRow[]): boolean | "indeterminate" => {
    const n = files.filter((f) => on.has(fileKey(f))).length;
    return n === 0 ? false : n === files.length ? true : "indeterminate";
  };
  const ownSaved = own.length > 0 && own.every((f) => f.state === "saved");
  const othersBox = boxState(otherFiles);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Download from the GST portal</DialogTitle>
          <DialogDescription>
            {client.name}
            {gstin ? ` · ${gstin}` : ""} · {item.workTypeName} {item.period}
          </DialogDescription>
        </DialogHeader>

        {!gstin ? (
          <p className="text-sm text-muted-foreground">Save this client&apos;s GSTIN to download its GST files.</p>
        ) : !data || !ticked ? (
          <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" />
        ) : (
          <div className="space-y-4 text-sm">
            <section className="space-y-2 rounded-md border p-3">
              <h3 className="font-semibold">
                This return · {item.workTypeName} {item.period}
                {loading && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
              </h3>
              {own.length === 0 ? (
                <p className="text-muted-foreground">No files of this return are due on the portal yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {own.map((f) => (
                    <FileChip key={fileKey(f)} file={f} ticked={on.has(fileKey(f))} onTick={ownTickable.includes(f) ? (yes) => tickMany([f], yes) : undefined} owner={owner} />
                  ))}
                </div>
              )}
              {ownSaved && <p className="text-xs text-emerald-700 dark:text-emerald-400">Every file of this return is saved: click one to download it.</p>}
            </section>

            <section className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Other files still missing for {client.name}</h3>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowEarlier(!showEarlier)} disabled={loading}>
                  <History className="mr-1 h-3.5 w-3.5" /> {showEarlier ? `Hide ${fyLabel(fy - 1)}` : `Also ${fyLabel(fy - 1)}`}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {fyLabel(fy)} up to {item.period}
                {showEarlier ? ` and all of ${fyLabel(fy - 1)}` : ""}. Tick any to fetch them in the same login.
              </p>
              {others.length === 0 ? (
                <p className="text-emerald-700 dark:text-emerald-400">Nothing else missing.</p>
              ) : (
                <>
                  <label className="flex w-fit cursor-pointer items-center gap-1.5 text-xs">
                    <Checkbox className="h-3.5 w-3.5" checked={othersBox} onCheckedChange={() => tickMany(otherFiles, othersBox !== true)} />
                    Select all ({otherFiles.length})
                  </label>
                  <ul className="divide-y rounded-md border">
                    {others.map((p) => {
                      const state = boxState(p.files);
                      return (
                        <li key={p.start} className="flex flex-col gap-1.5 p-2 sm:flex-row sm:items-start">
                          <span className="flex w-40 shrink-0 items-center gap-1.5 font-medium">
                            <Checkbox className="h-3.5 w-3.5" checked={state} aria-label={`Tick every file of ${p.title}`} onCheckedChange={() => tickMany(p.files, state !== true)} />
                            {p.title}
                            {p.quarterly && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">Qtr</span>}
                          </span>
                          <span className="flex flex-wrap gap-1.5">
                            {p.files.map((f) => (
                              <FileChip key={fileKey(f)} file={f} ticked={on.has(fileKey(f))} onTick={(yes) => tickMany([f], yes)} />
                            ))}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>

            <Legend />
            {!data.client.hasLogin && (
              <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                <KeyRound className="h-3.5 w-3.5" /> No GST login saved (Clients → Credentials, with “GST” in the title): staff type the username and password on the portal.
              </p>
            )}
            <PortalLogin clientId={client.id} clientName={data.client.name} gstin={gstin} files={chosen} onQueued={onClose} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
