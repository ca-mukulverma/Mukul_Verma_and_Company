"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, FileUp, FolderUp, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FORM_LABELS, Gstr2bRead, Gstr3bRead, GstRead, netSales, SalesRead, totalTax } from "@/lib/gst-read";
import { gstState } from "@/lib/gst-states";
import type { WorkType } from "./setup";
import { apiError, DOC_KIND_LABELS, rupees, STATUS_LABELS } from "./types";
import { canStore } from "./upload";
import type { InputFile, ReturnFound } from "./return-detect";
import { onPortalFiles, type PortalSaved } from "./portal-files";
import { checkPlaces, isReady, isSure, readRows, uploadRows, whyHeld, workFor, worksFor, type ClientRef, type Row } from "./return-save";

export type { ClientRef } from "./return-save";

// Upload documents (Compliance → Clients → a client): drop all of a party's
// PDFs, JSONs, ZIPs, RARs or whole folders at once. Each file is read for its
// return, GSTIN/TAN, period, ARN and filing date (and a GST return for its
// figures), goes to the party's registration with its GSTIN (a party may have
// one per state) and to the period in the file, and is uploaded straight
// away. Files that need a look (another party's GSTIN, a folder of another
// month, the same file twice, a period guessed from the name) stay in the
// table, unticked, to fix and upload by hand.

interface Props {
  party: ClientRef[];
  workTypes: WorkType[];
  onChanged: () => void;
  // Adds the party's GSTIN of another state (Admins and Partners)
  onAddGstin?: (gstin: string) => Promise<ClientRef | null>;
}

const NO_WORK = "none";
const FOUND_LABEL: Record<ReturnFound, string> = {
  GSTR1: "GSTR-1",
  GSTR1A: "GSTR-1A",
  GSTR3B: "GSTR-3B",
  GSTR2B: "GSTR-2B",
  TDS_RETURN: "TDS return",
  TDS_CERTIFICATE: "Form 16/16A",
  TDS_CHALLAN: "TDS challan",
};

// The main figure of a GST return, to see at a glance what was read
function gstSummary(g: GstRead): string {
  if (g.form === "GSTR3B") {
    const r = g as Gstr3bRead;
    return `3.1(a) ${rupees(r.outward.taxable)} · net ITC ${rupees(totalTax(r.itc.net))}${r.unread.length ? ` · not read: ${r.unread.join(", ")}` : ""}`;
  }
  if (g.form === "GSTR2B") {
    const r = g as Gstr2bRead;
    if (r.part === "part") return `Part ${r.partNo ?? "?"}: documents only; the totals are in the summary file`;
    return `ITC available ${rupees(totalTax(r.available!))}${r.part === "summary" ? ` · summary of ${r.fileCount} part file(s)` : ""}`;
  }
  const r = g as SalesRead;
  const net = netSales(r.rows);
  return `Net ${rupees(net.taxable)} · tax ${rupees(totalTax(net))}${r.notesNetted && r.source === "PDF" ? "" : ""}`;
}

// Files of a dropped folder, with their folder path
async function droppedFiles(items: DataTransferItemList): Promise<InputFile[]> {
  const out: InputFile[] = [];
  const walk = async (entry: FileSystemEntry, folder: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, folder });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const path = [folder, entry.name].filter(Boolean).join("/");
      // readEntries returns at most 100 entries per call
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, path);
      }
    }
  };
  const entries = Array.from(items)
    .map((i) => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => !!e);
  for (const entry of entries) await walk(entry, "");
  return out;
}

export function ReturnUpload({ party, workTypes, onChanged, onAddGstin }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const [adding, setAdding] = useState<string | null>(null);

  const newId = () => nextId.current++;

  // What happened to each file read (for the GST portal downloads)
  const read = async (inputs: InputFile[]): Promise<PortalSaved[]> => {
    if (!inputs.length) return [];
    let fresh: Row[] = [];
    try {
      const seen = new Map(rows.filter((r) => r.upload !== "done").map((r) => [r.sha, r.file.name]));
      fresh = await readRows(inputs, { party, workTypes, nextId: newId, seen, onProgress: setReading });
      setRows((r) => [...r.filter((x) => x.upload !== "done"), ...fresh]);
    } catch (error) {
      toast.error(apiError(error, "The files couldn't be read"));
      fresh = [];
    } finally {
      setReading(null);
      if (inputRef.current) inputRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
    }
    const now = fresh.filter(isSure);
    const uploaded = now.length ? await upload(now) : new Map<number, PortalSaved>();
    const waiting = fresh.length - now.length;
    if (waiting) toast.info(`${waiting} file(s) need a look before they are uploaded: see the highlighted rows`);
    return fresh.map((r) => uploaded.get(r.id) ?? { name: r.file.name, ok: false, message: `Needs a look in Upload documents: ${whyHeld(r)}` });
  };

  // Files fetched from the GST portal for this party come in here while
  // this box is on the page, so any that need a look stay in the table
  const readRef = useRef(read);
  readRef.current = read;
  const partyIds = party.map((c) => c.id).join(",");
  useEffect(
    () => onPortalFiles(partyIds.split(","), (files) => readRef.current(files.map((file) => ({ file, folder: "" })))),
    [partyIds]
  );

  const fromInput = (files: FileList | null) =>
    read(
      Array.from(files ?? []).map((file) => {
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
        return { file, folder: path.split("/").slice(0, -1).join("/") };
      })
    );

  const update = async (id: number, patch: Partial<Row>) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const next = { ...row, ...patch };
    const placeChanged = "workTypeId" in patch || "month" in patch;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...next, place: placeChanged ? null : next.place } : r)));
    if (!placeChanged) return;
    try {
      const place = (await checkPlaces([next])).get(id) ?? null;
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, place, include: r.include || (place?.ok === true && !r.error) } : r)));
    } catch (error) {
      toast.error(apiError(error));
    }
  };

  // The party's GSTIN of another state found in a file: add it, then send
  // every file of that GSTIN to it
  const addGstin = async (gstin: string) => {
    if (!onAddGstin) return;
    setAdding(gstin);
    try {
      const added = await onAddGstin(gstin);
      if (!added) return;
      const moved = rows
        .filter((r) => r.newGstin === gstin && !r.upload)
        .map((r) => ({
          ...r,
          client: added,
          error: undefined,
          newGstin: null,
          idCheck: "match" as const,
          idNote: `GSTIN of ${added.state ?? gstin}`,
          workTypeId: r.detected ? workFor(workTypes, r.detected, added.subscribed) : "",
          place: null,
        }));
      const places = await checkPlaces(moved);
      const placed = moved.map((r) => {
        const row = { ...r, place: places.get(r.id) ?? null };
        return { ...row, include: isReady(row) };
      });
      setRows((rs) => rs.map((r) => placed.find((m) => m.id === r.id) ?? r));
      const now = placed.filter(isSure);
      if (now.length) await upload(now);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setAdding(null);
    }
  };

  // Failed rows stay ticked, so Upload tries them again
  const ticked = rows.filter((r) => r.include && (!r.upload || r.upload === "failed") && r.client);

  const upload = async (list: Row[]) => {
    setBusy(true);
    const setRow = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      const { results, done, filed, error } = await uploadRows(list, setRow);
      if (error) toast.error(error);
      if (done) toast.success(`${done} file(s) uploaded${filed ? `; ${filed} period(s) marked filed from their returns` : ""}`);
      if (!error && done < list.length) toast.error(`${list.length - done} file(s) could not be uploaded: see the red rows`);
      if (done) onChanged();
      return results;
    } finally {
      setBusy(false);
    }
  };

  const disabled = !!reading || busy || !!adding;
  const showGstin = party.length > 1 || rows.some((r) => r.newGstin);
  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm"
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          if (disabled) return;
          // Both are emptied once the drop event is over
          const plain = Array.from(e.dataTransfer.files).map((file) => ({ file }));
          const files = await droppedFiles(e.dataTransfer.items);
          read(files.length ? files : plain);
        }}
      >
        <input ref={inputRef} type="file" multiple accept=".pdf,.json,.zip,.rar" className="hidden" onChange={(e) => fromInput(e.target.files)} />
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => fromInput(e.target.files)}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>
          {reading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />} Choose files
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => folderRef.current?.click()}>
          <FolderUp className="mr-1 h-4 w-4" /> Choose a folder
        </Button>
        <span className="text-xs text-muted-foreground">
          {reading ??
            `or drop them here, all together: return PDFs and JSONs (GSTR-1, IFF, 1A, 3B, 2B, TDS), challans, ZIPs, RARs or a whole folder. Each file goes to the period in it${party.length > 1 ? " and to the GSTIN in it" : ""} and is uploaded straight away; returns mark their periods filed and fill the GST working.`}
        </span>
      </div>

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="p-1" />
                  <th className="p-1">File</th>
                  {showGstin && <th className="p-1">GSTIN</th>}
                  <th className="p-1">Found</th>
                  <th className="p-1">Work</th>
                  <th className="p-1">File type</th>
                  <th className="p-1">Period</th>
                  <th className="p-1">Goes to</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bad = (!!r.error && !r.newGstin) || r.idCheck === "mismatch";
                  const attention = !!r.warning || (r.workTypeId && (!r.month || r.place?.ok === false)) || r.detected?.monthGuessed || (!r.workTypeId && r.kind !== "OTHER");
                  return (
                    <tr key={r.id} className={cn("border-t align-top", bad || r.upload === "failed" ? "bg-red-50 dark:bg-red-950/30" : (attention || r.newGstin) && !r.upload && "bg-amber-50 dark:bg-amber-950/30")}>
                      <td className="p-1">
                        {r.upload === "done" ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : r.upload === "uploading" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Checkbox checked={r.include} disabled={busy || !canStore(r.file.name) || !r.client || !!r.error} onCheckedChange={(c) => update(r.id, { include: c === true })} aria-label={`Upload ${r.file.name}`} />
                        )}
                      </td>
                      <td className="max-w-[12rem] p-1">
                        <p className="truncate font-medium" title={r.file.name}>{r.file.name}</p>
                        {(r.folder || r.from) && <p className="truncate text-muted-foreground" title={[r.from, r.folder].filter(Boolean).join(" › ")}>{[r.from, r.folder].filter(Boolean).join(" › ")}</p>}
                        {r.error && <p className={r.newGstin ? "text-amber-800 dark:text-amber-300" : "text-red-700 dark:text-red-300"}>{r.error}</p>}
                        {r.newGstin && onAddGstin && !r.upload && (
                          <Button size="sm" variant="outline" className="mt-1 h-7 text-xs" disabled={disabled} onClick={() => addGstin(r.newGstin!)}>
                            {adding === r.newGstin ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />} Add {gstState(r.newGstin)} GSTIN to this party
                          </Button>
                        )}
                        {r.warning && <p className="font-medium text-amber-800 dark:text-amber-300"><AlertTriangle className="mr-0.5 inline h-3 w-3" />{r.warning}</p>}
                        {r.upload === "failed" && <p className="text-red-700 dark:text-red-300">{r.message}</p>}
                        {r.upload === "done" && r.message && <p className="text-emerald-700 dark:text-emerald-300">{r.message}</p>}
                      </td>
                      {showGstin && (
                        <td className="max-w-[10rem] p-1">
                          {r.client?.gstin ? (
                            <>
                              <p className="font-medium">{r.client.state}</p>
                              <p className="text-muted-foreground">{r.client.gstin}</p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      <td className="max-w-[16rem] p-1">
                        <p>{r.detected?.gst ? `${FORM_LABELS[r.detected.gst.form]} ${r.detected.gst.source}` : r.detected?.found ? FOUND_LABEL[r.detected.found] : "Not recognised"}</p>
                        {r.detected?.gst && <p className="text-muted-foreground">{gstSummary(r.detected.gst)}</p>}
                        {r.idNote && (
                          <p className={cn(r.idCheck === "match" ? "text-emerald-700 dark:text-emerald-300" : r.idCheck === "mismatch" ? "font-medium text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300")}>
                            {r.idCheck === "mismatch" && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}
                            {r.idNote}
                          </p>
                        )}
                        {r.detected?.arn && <p className="text-muted-foreground">ARN/token {r.detected.arn}</p>}
                        {r.detected?.filedAt && r.detected.gst?.form !== "GSTR2B" && <p className="text-muted-foreground">Filed {r.detected.filedAt}</p>}
                      </td>
                      <td className="p-1">
                        <Select value={r.workTypeId || NO_WORK} disabled={busy || r.upload === "done" || !r.client} onValueChange={(v) => update(r.id, { workTypeId: v === NO_WORK ? "" : v, ...(v === NO_WORK && { kind: "OTHER" }) })}>
                          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_WORK}>No work (client file)</SelectItem>
                            {worksFor(workTypes, r.client?.subscribed ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1">
                        <Select value={r.kind} disabled={busy || r.upload === "done" || !!r.detected?.gst} onValueChange={(kind) => update(r.id, { kind })}>
                          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(DOC_KIND_LABELS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1">
                        {r.workTypeId ? (
                          <>
                            <Input type="month" className="h-8 w-36 text-xs" value={r.month} disabled={busy || r.upload === "done" || !!r.detected?.gst} onChange={(e) => update(r.id, { month: e.target.value })} />
                            {r.detected?.monthGuessed && r.month === r.detected.month && (
                              <p className="text-amber-700 dark:text-amber-300">{r.detected.found === "TDS_CHALLAN" ? "From the payment date: check" : "From the file name: check"}</p>
                            )}
                            {r.detected?.gst && <p className="text-muted-foreground">Read from the file</p>}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-1">
                        {!r.client ? (
                          <span className="text-muted-foreground">—</span>
                        ) : !r.workTypeId ? (
                          <span className="text-muted-foreground">Client&apos;s files</span>
                        ) : !r.month ? (
                          <span className="text-amber-700 dark:text-amber-300">Choose the period</span>
                        ) : !r.place ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : r.place.ok ? (
                          <span>
                            {r.place.period}{" "}
                            <span className="text-muted-foreground">
                              {r.place.state === "sheet"
                                ? `(in the sheet: ${STATUS_LABELS[r.place.status as keyof typeof STATUS_LABELS] ?? r.place.status})`
                                : r.place.state === "past"
                                  ? "(past period)"
                                  : r.upload === "done"
                                    ? "(saved as a past period)"
                                    : "(new past period, saved as completed)"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-red-700 dark:text-red-300">{r.place.error}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ticked.length > 0 && (
              <Button size="sm" disabled={disabled || ticked.some((r) => r.workTypeId && (!r.month || !r.place?.ok))} onClick={() => upload(ticked)}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />} Upload {ticked.length} ticked file(s)
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRows([])}>
              <X className="mr-1 h-4 w-4" /> Clear list
            </Button>
            <span className="text-xs text-muted-foreground">
              Highlighted rows were not uploaded: another party&apos;s GSTIN or TAN, a folder of another month, the same file twice, or a period guessed from the file name. Fix them, tick and upload. A filed return&apos;s PDF marks its period filed (with the ARN and date on it) unless something locks it.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
