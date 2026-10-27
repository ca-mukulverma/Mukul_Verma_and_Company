"use client";

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Check, FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WorkType } from "./setup";
import { apiError, DOC_KIND_LABELS, STATUS_LABELS } from "./types";
import { canStore, uploadComplianceFile } from "./upload";
import { detectReturn, expandFiles, type Detected, type ReturnFound } from "./return-detect";

// Upload returns for one client: drop PDFs, JSONs or ZIPs; each file is read
// for its return, GSTIN/TAN, period, ARN and filing date, and shown in a table
// to confirm (and correct) before anything is uploaded. Files of another
// GSTIN or TAN are left unticked.

type Place =
  | { ok: true; period: string; month: string; itemId: string | null; state: "sheet" | "past" | "new_past"; status: string | null }
  | { ok: false; period: string | null; error: string };

interface Row {
  id: number;
  file: File;
  from: string | null;
  error?: string;
  detected: Detected | null;
  workTypeId: string;
  kind: string;
  month: string;
  idCheck: "match" | "mismatch" | "none";
  idNote: string | null;
  place: Place | null;
  include: boolean;
  upload: "uploading" | "done" | "failed" | null;
  message?: string;
}

interface Props {
  client: { id: string; gstin: string | null; tan: string | null };
  subscribed: string[];
  workTypes: WorkType[];
  onChanged: () => void;
}

const NO_WORK = "none";
const WORK_KIND: Record<ReturnFound, string> = {
  GSTR1: "GSTR1",
  GSTR1A: "GSTR1",
  GSTR3B: "GSTR3B",
  TDS_RETURN: "TDS_RETURN",
  TDS_CERTIFICATE: "TDS_RETURN",
  TDS_CHALLAN: "TDS_PAYMENT",
};
const FOUND_LABEL: Record<ReturnFound, string> = {
  GSTR1: "GSTR-1",
  GSTR1A: "GSTR-1A",
  GSTR3B: "GSTR-3B",
  TDS_RETURN: "TDS return",
  TDS_CERTIFICATE: "Form 16/16A",
  TDS_CHALLAN: "TDS challan",
};

function docKind(d: Detected) {
  if (d.found === "TDS_CERTIFICATE") return "CERTIFICATE";
  if (d.found === "TDS_CHALLAN") return "CHALLAN";
  if (d.format === "OTHER" || !d.found) return d.format === "OTHER" ? "OTHER" : d.format === "JSON" ? "RETURN_JSON" : "RETURN_PDF";
  if (d.found === "GSTR1A") return d.format === "JSON" ? "GSTR1A_JSON" : "GSTR1A_PDF";
  return d.format === "JSON" ? "RETURN_JSON" : "RETURN_PDF";
}

// The GSTIN or TAN in the file against the client's
function idCheck(d: Detected, client: Props["client"]): Pick<Row, "idCheck" | "idNote"> {
  const checks: [string, string | null, string | null][] = [
    ["GSTIN", d.gstin, client.gstin],
    ["TAN", d.tan, client.tan],
  ];
  for (const [label, inFile, saved] of checks) {
    if (!inFile) continue;
    if (!saved) return { idCheck: "none", idNote: `${label} ${inFile}; the client has no ${label} saved` };
    return inFile.toUpperCase() === saved.toUpperCase()
      ? { idCheck: "match", idNote: `${label} matches` }
      : { idCheck: "mismatch", idNote: `${label} ${inFile} is not this client's (${saved})` };
  }
  return { idCheck: "none", idNote: null };
}

export function ReturnUpload({ client, subscribed, workTypes, onChanged }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const active = workTypes.filter((w) => w.active);
  // The client's own works first
  const works = [...active.filter((w) => subscribed.includes(w.id)), ...active.filter((w) => !subscribed.includes(w.id))];

  const workFor = (d: Detected) => {
    if (!d.found) return "";
    let options = works.filter((w) => w.kind === WORK_KIND[d.found!]);
    if (d.formNo && options.some((w) => w.returnType === d.formNo)) options = options.filter((w) => w.returnType === d.formNo);
    return options[0]?.id ?? "";
  };

  const check = async (list: Row[]) => {
    const asked = list.filter((r) => r.workTypeId && r.month);
    if (!asked.length) return new Map<number, Place>();
    const { data } = await axios.post<{ results: Place[] }>(`/api/compliance/clients/${client.id}/returns`, {
      place: false,
      rows: asked.map((r) => ({ workTypeId: r.workTypeId, month: r.month })),
    });
    return new Map(asked.map((r, i) => [r.id, data.results[i]]));
  };

  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    setReading(true);
    try {
      const expanded = await expandFiles(Array.from(files));
      const fresh: Row[] = [];
      for (const { file, from, error } of expanded) {
        const detected = error ? null : await detectReturn(file);
        const storable = canStore(file.name);
        fresh.push({
          id: nextId.current++,
          file,
          from,
          error: error ?? (storable ? undefined : "This type of file can't be kept"),
          detected,
          workTypeId: detected ? workFor(detected) : "",
          kind: detected ? docKind(detected) : "OTHER",
          month: detected?.month ?? "",
          ...(detected ? idCheck(detected, client) : { idCheck: "none" as const, idNote: null }),
          place: null,
          include: false,
          upload: null,
        });
      }
      const places = await check(fresh);
      for (const row of fresh) {
        row.place = places.get(row.id) ?? null;
        row.include = !row.error && row.idCheck !== "mismatch" && (!row.workTypeId ? row.kind === "OTHER" : !!row.month && row.place?.ok === true);
      }
      setRows((r) => [...r.filter((x) => x.upload !== "done"), ...fresh]);
    } catch (error) {
      toast.error(apiError(error, "The files couldn't be read"));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const update = async (id: number, patch: Partial<Row>) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const next = { ...row, ...patch };
    const placeChanged = "workTypeId" in patch || "month" in patch;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...next, place: placeChanged ? null : next.place } : r)));
    if (!placeChanged) return;
    try {
      const place = (await check([next])).get(id) ?? null;
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, place, include: r.include || (place?.ok === true && !r.error) } : r)));
    } catch (error) {
      toast.error(apiError(error));
    }
  };

  const ready = rows.filter((r) => r.include && !r.upload);

  const uploadAll = async () => {
    setBusy(true);
    const setRow = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    let done = 0;
    try {
      // Periods first (past periods that don't exist yet are created), then the files
      const forItems = ready.filter((r) => r.workTypeId);
      const keys = [...new Set(forItems.map((r) => `${r.workTypeId}|${r.month}`))];
      const itemIds = new Map<string, Place>();
      if (keys.length) {
        const { data } = await axios.post<{ results: Place[] }>(`/api/compliance/clients/${client.id}/returns`, {
          place: true,
          rows: keys.map((key) => {
            const same = forItems.filter((r) => `${r.workTypeId}|${r.month}` === key);
            const [workTypeId, month] = key.split("|");
            return {
              workTypeId,
              month,
              arn: same.find((r) => r.detected?.arn)?.detected?.arn ?? null,
              filedAt: same.find((r) => r.detected?.filedAt)?.detected?.filedAt ?? null,
            };
          }),
        });
        keys.forEach((key, i) => itemIds.set(key, data.results[i]));
      }
      for (const row of ready) {
        const place = row.workTypeId ? itemIds.get(`${row.workTypeId}|${row.month}`) : null;
        if (place && (!place.ok || !place.itemId)) {
          setRow(row.id, { upload: "failed", message: place.ok ? "No period" : place.error });
          continue;
        }
        setRow(row.id, { upload: "uploading" });
        try {
          await uploadComplianceFile(row.file, { clientId: client.id, itemId: place?.ok ? place.itemId : null, kind: row.kind });
          setRow(row.id, { upload: "done", place: place ?? row.place });
          done++;
        } catch (error) {
          setRow(row.id, { upload: "failed", message: error instanceof Error && !axios.isAxiosError(error) ? error.message : apiError(error) });
        }
      }
      if (done) toast.success(`${done} file(s) uploaded`);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(false);
      if (done) onChanged();
    }
  };

  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!reading && !busy) read(e.dataTransfer.files);
        }}
      >
        <input ref={inputRef} type="file" multiple accept=".pdf,.json,.zip" className="hidden" onChange={(e) => read(e.target.files)} />
        <Button size="sm" variant="outline" disabled={reading || busy} onClick={() => inputRef.current?.click()}>
          {reading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />} Choose files
        </Button>
        <span className="text-xs text-muted-foreground">
          {reading ? "Reading the files…" : "or drop them here: return PDFs, JSONs and ZIPs. Each file is read and shown below to confirm before it is uploaded."}
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
                  <th className="p-1">Found</th>
                  <th className="p-1">Work</th>
                  <th className="p-1">File type</th>
                  <th className="p-1">Period</th>
                  <th className="p-1">Goes to</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const attention = !!r.error || r.idCheck === "mismatch" || (r.workTypeId && (!r.month || r.place?.ok === false)) || r.detected?.monthGuessed || (!r.workTypeId && r.kind !== "OTHER");
                  return (
                    <tr key={r.id} className={cn("border-t align-top", r.idCheck === "mismatch" || r.error ? "bg-red-50 dark:bg-red-950/30" : attention && !r.upload && "bg-amber-50 dark:bg-amber-950/30")}>
                      <td className="p-1">
                        {r.upload === "done" ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : r.upload === "uploading" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Checkbox checked={r.include} disabled={busy || !canStore(r.file.name)} onCheckedChange={(c) => update(r.id, { include: c === true })} aria-label={`Upload ${r.file.name}`} />
                        )}
                      </td>
                      <td className="max-w-[12rem] p-1">
                        <p className="truncate font-medium" title={r.file.name}>{r.file.name}</p>
                        {r.from && <p className="truncate text-muted-foreground">from {r.from}</p>}
                        {r.error && <p className="text-red-700 dark:text-red-300">{r.error}</p>}
                        {r.upload === "failed" && <p className="text-red-700 dark:text-red-300">{r.message}</p>}
                      </td>
                      <td className="p-1">
                        <p>{r.detected?.found ? FOUND_LABEL[r.detected.found] : "Not recognised"}</p>
                        {r.idNote && (
                          <p className={cn(r.idCheck === "match" ? "text-emerald-700 dark:text-emerald-300" : r.idCheck === "mismatch" ? "font-medium text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300")}>
                            {r.idCheck === "mismatch" && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}
                            {r.idNote}
                          </p>
                        )}
                        {r.detected?.arn && <p className="text-muted-foreground">ARN/token {r.detected.arn}</p>}
                        {r.detected?.filedAt && <p className="text-muted-foreground">Filed {r.detected.filedAt}</p>}
                      </td>
                      <td className="p-1">
                        <Select value={r.workTypeId || NO_WORK} disabled={busy || !!r.upload} onValueChange={(v) => update(r.id, { workTypeId: v === NO_WORK ? "" : v, ...(v === NO_WORK && { kind: "OTHER" }) })}>
                          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_WORK}>No work (client file)</SelectItem>
                            {works.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1">
                        <Select value={r.kind} disabled={busy || !!r.upload} onValueChange={(kind) => update(r.id, { kind })}>
                          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(DOC_KIND_LABELS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1">
                        {r.workTypeId ? (
                          <>
                            <Input type="month" className="h-8 w-36 text-xs" value={r.month} disabled={busy || !!r.upload} onChange={(e) => update(r.id, { month: e.target.value })} />
                            {r.detected?.monthGuessed && r.month === r.detected.month && (
                              <p className="text-amber-700 dark:text-amber-300">{r.detected.found === "TDS_CHALLAN" ? "From the payment date: check" : "From the file name: check"}</p>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-1">
                        {!r.workTypeId ? (
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
            <Button size="sm" disabled={busy || reading || ready.length === 0 || ready.some((r) => r.workTypeId && (!r.month || !r.place?.ok))} onClick={uploadAll}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />} Upload {ready.length} ticked file(s)
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRows([])}>
              <X className="mr-1 h-4 w-4" /> Clear list
            </Button>
            <span className="text-xs text-muted-foreground">
              Check the highlighted rows. Files of another GSTIN or TAN are left unticked. Periods in the sheet only get the file; their status is changed in the sheet.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
