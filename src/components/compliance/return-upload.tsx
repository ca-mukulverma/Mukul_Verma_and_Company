"use client";

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Check, FileUp, FolderUp, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FORM_LABELS, Gstr2bRead, Gstr3bRead, GstRead, netSales, SalesRead, totalTax } from "@/lib/gst-read";
import { monthLabel } from "@/lib/gst-read/working";
import { gstState, panOfGstin } from "@/lib/gst-states";
import type { WorkType } from "./setup";
import { apiError, DOC_KIND_LABELS, rupees, STATUS_LABELS } from "./types";
import { canStore, uploadComplianceFile } from "./upload";
import { detectReturn, expandFiles, monthFromFolder, type Detected, type InputFile, type ReturnFound } from "./return-detect";

// Upload documents (Compliance → Clients → a client): drop all of a party's
// PDFs, JSONs, ZIPs, RARs or whole folders at once. Each file is read for its
// return, GSTIN/TAN, period, ARN and filing date (and a GST return for its
// figures), goes to the party's registration with its GSTIN (a party may have
// one per state) and to the period in the file, and is uploaded straight
// away. Files that need a look (another party's GSTIN, a folder of another
// month, the same file twice, a period guessed from the name) stay in the
// table, unticked, to fix and upload by hand.

type Place =
  | { ok: true; period: string; month: string; itemId: string | null; state: "sheet" | "past" | "new_past"; status: string | null }
  | { ok: false; period: string | null; error: string };

// One of the party's GST registrations (the main record first)
export interface ClientRef {
  id: string;
  name: string;
  gstin: string | null;
  tan: string | null;
  pan: string | null;
  state: string | null;
  subscribed: string[];
}

interface Row {
  id: number;
  file: File;
  from: string | null;
  folder: string;
  sha: string;
  error?: string;
  detected: Detected | null;
  client: ClientRef | null;
  workTypeId: string;
  kind: string;
  month: string;
  idCheck: "match" | "mismatch" | "none";
  idNote: string | null;
  // A GSTIN of the party's PAN in a state not added yet
  newGstin: string | null;
  // Folder of another month, or the same file twice
  warning: string | null;
  place: Place | null;
  include: boolean;
  upload: "uploading" | "done" | "failed" | null;
  message?: string;
}

interface Props {
  party: ClientRef[];
  workTypes: WorkType[];
  onChanged: () => void;
  // Adds the party's GSTIN of another state (Admins and Partners)
  onAddGstin?: (gstin: string) => Promise<ClientRef | null>;
}

const NO_WORK = "none";
const WORK_KIND: Record<ReturnFound, string> = {
  GSTR1: "GSTR1",
  GSTR1A: "GSTR1",
  GSTR3B: "GSTR3B",
  GSTR2B: "GSTR3B",
  TDS_RETURN: "TDS_RETURN",
  TDS_CERTIFICATE: "TDS_RETURN",
  TDS_CHALLAN: "TDS_PAYMENT",
};
const FOUND_LABEL: Record<ReturnFound, string> = {
  GSTR1: "GSTR-1",
  GSTR1A: "GSTR-1A",
  GSTR3B: "GSTR-3B",
  GSTR2B: "GSTR-2B",
  TDS_RETURN: "TDS return",
  TDS_CERTIFICATE: "Form 16/16A",
  TDS_CHALLAN: "TDS challan",
};

function docKind(d: Detected) {
  if (d.gst) {
    if (d.gst.form === "GSTR2B") return "GSTR2B_JSON";
    if (d.gst.form === "GSTR1A") return d.format === "JSON" ? "GSTR1A_JSON" : "GSTR1A_PDF";
    return d.format === "JSON" ? "RETURN_JSON" : "RETURN_PDF";
  }
  if (d.found === "TDS_CERTIFICATE") return "CERTIFICATE";
  if (d.found === "TDS_CHALLAN") return "CHALLAN";
  if (d.format === "OTHER" || !d.found) return d.format === "OTHER" ? "OTHER" : d.format === "JSON" ? "RETURN_JSON" : "RETURN_PDF";
  if (d.found === "GSTR1A") return d.format === "JSON" ? "GSTR1A_JSON" : "GSTR1A_PDF";
  return d.format === "JSON" ? "RETURN_JSON" : "RETURN_PDF";
}

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

// Which of the party's registrations a file is for, from the GSTIN or TAN in it
function matchParty(d: Detected, party: ClientRef[]): Pick<Row, "client" | "idCheck" | "idNote" | "newGstin" | "error"> {
  const main = party[0];
  const several = party.length > 1;
  const none = { client: main, idCheck: "none" as const, idNote: null, newGstin: null };
  if (d.gstin) {
    const gstin = d.gstin.toUpperCase();
    const found = party.find((c) => c.gstin?.toUpperCase() === gstin);
    if (found) return { client: found, idCheck: "match", idNote: several ? `GSTIN of ${found.state ?? found.gstin}` : "GSTIN matches", newGstin: null };
    if (!party.some((c) => c.gstin)) return { ...none, idNote: `GSTIN ${gstin}; the client has no GSTIN saved` };
    const pan = main.pan ?? panOfGstin(main.gstin);
    if (pan && panOfGstin(gstin) === pan) {
      return { client: null, idCheck: "none", idNote: null, newGstin: gstin, error: `GSTIN ${gstin} (${gstState(gstin)}) is this party's, but not added yet` };
    }
    return { client: null, idCheck: "mismatch", idNote: null, newGstin: null, error: `GSTIN ${gstin} is not this party's (${party.map((c) => c.gstin).filter(Boolean).join(", ")})` };
  }
  if (d.tan) {
    const tan = d.tan.toUpperCase();
    const found = party.find((c) => c.tan?.toUpperCase() === tan);
    if (found) return { client: found, idCheck: "match", idNote: "TAN matches", newGstin: null };
    const saved = party.find((c) => c.tan)?.tan;
    if (saved) return { client: null, idCheck: "mismatch", idNote: null, newGstin: null, error: `TAN ${tan} is not this party's (${saved})` };
    return { ...none, idNote: `TAN ${tan}; the client has no TAN saved` };
  }
  return none;
}

// Months a file may be in a folder of: a quarterly 3B or 2B covers three
function monthsCovered(d: Detected): string[] {
  if (!d.month) return [];
  if (!d.gst?.quarterly) return [d.month];
  const [y, m] = d.month.split("-").map(Number);
  return [2, 1, 0].map((back) => {
    const date = new Date(Date.UTC(y, m - 1 - back, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

async function sha256(file: File) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

  const active = workTypes.filter((w) => w.active);
  // The client's own works first
  const worksFor = (mine: string[]) => [...active.filter((w) => mine.includes(w.id)), ...active.filter((w) => !mine.includes(w.id))];

  const workFor = (d: Detected, mine: string[]) => {
    if (!d.found) return "";
    let options = worksFor(mine).filter((w) => w.kind === WORK_KIND[d.found!]);
    if (d.formNo && options.some((w) => w.returnType === d.formNo)) options = options.filter((w) => w.returnType === d.formNo);
    return options[0]?.id ?? "";
  };

  // Where each row goes, asked of each client's returns
  const check = async (list: Row[]) => {
    const places = new Map<number, Place>();
    const asked = list.filter((r) => r.client && r.workTypeId && r.month);
    for (const clientId of new Set(asked.map((r) => r.client!.id))) {
      const mine = asked.filter((r) => r.client!.id === clientId);
      const { data } = await axios.post<{ results: Place[] }>(`/api/compliance/clients/${clientId}/returns`, {
        place: false,
        rows: mine.map((r) => ({ workTypeId: r.workTypeId, month: r.month })),
      });
      mine.forEach((r, i) => places.set(r.id, data.results[i]));
    }
    return places;
  };

  // Ticked when the file can go in as it is; the rest wait for a look
  const ready = (row: Row) =>
    !row.error &&
    !!row.client &&
    !row.warning &&
    row.idCheck !== "mismatch" &&
    (!row.workTypeId ? row.kind === "OTHER" : !!row.month && row.place?.ok === true);
  // Uploaded without asking: ticked, and nothing in it was guessed
  const sure = (row: Row) => row.include && !row.detected?.monthGuessed && (!!row.workTypeId || !row.detected?.found);

  const read = async (inputs: InputFile[]) => {
    if (!inputs.length) return;
    setReading("Opening the files…");
    let fresh: Row[] = [];
    try {
      const expanded = await expandFiles(inputs);
      const seen = new Map(rows.filter((r) => r.upload !== "done").map((r) => [r.sha, r.file.name]));
      let n = 0;
      for (const { file, from, folder, error } of expanded) {
        setReading(`Reading ${++n} of ${expanded.length}: ${file.name}`);
        const detected = error ? null : await detectReturn(file);
        const sha = await sha256(file);
        let warning: string | null = null;
        const same = seen.get(sha);
        if (same) warning = `Same file as ${same === file.name ? "another one" : same} above`;
        else seen.set(sha, file.name);
        const folderMonth = monthFromFolder(folder);
        if (!warning && detected?.month && folderMonth && !monthsCovered(detected).includes(folderMonth)) {
          warning = `In the folder of ${monthLabel(folderMonth)}, but the file is for ${monthLabel(detected.month)}`;
        }
        const match = detected ? matchParty(detected, party) : null;
        fresh.push({
          id: nextId.current++,
          file,
          from,
          folder,
          sha,
          error: error ?? (canStore(file.name) ? undefined : "This type of file can't be kept") ?? match?.error,
          detected,
          client: match ? match.client : party[0],
          workTypeId: detected && match?.client ? workFor(detected, match.client.subscribed) : "",
          kind: detected ? docKind(detected) : "OTHER",
          month: detected?.month ?? "",
          idCheck: match?.idCheck ?? "none",
          idNote: match?.idNote ?? null,
          newGstin: match?.newGstin ?? null,
          warning,
          place: null,
          include: false,
          upload: null,
        });
      }

      setReading("Finding the periods…");
      const places = await check(fresh);
      fresh = fresh.map((row) => {
        const placed = { ...row, place: places.get(row.id) ?? null };
        return { ...placed, include: ready(placed) };
      });
      setRows((r) => [...r.filter((x) => x.upload !== "done"), ...fresh]);
    } catch (error) {
      toast.error(apiError(error, "The files couldn't be read"));
      fresh = [];
    } finally {
      setReading(null);
      if (inputRef.current) inputRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
    }
    const now = fresh.filter(sure);
    if (now.length) await upload(now);
    const waiting = fresh.length - now.length;
    if (waiting) toast.info(`${waiting} file(s) need a look before they are uploaded: see the highlighted rows`);
  };

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
      const place = (await check([next])).get(id) ?? null;
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
          workTypeId: r.detected ? workFor(r.detected, added.subscribed) : "",
          place: null,
        }));
      const places = await check(moved);
      const placed = moved.map((r) => {
        const row = { ...r, place: places.get(r.id) ?? null };
        return { ...row, include: ready(row) };
      });
      setRows((rs) => rs.map((r) => placed.find((m) => m.id === r.id) ?? r));
      const now = placed.filter(sure);
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
    let done = 0;
    let filed = 0;
    const placeOf = (r: Row) => `${r.client!.id}|${r.workTypeId}|${r.month}`;
    const placed = new Map<string, Place>();
    const uploadedTo = new Set<string>();
    try {
      // Periods first (past periods that don't exist yet are created), then the files
      const forItems = list.filter((r) => r.workTypeId);
      const keys = [...new Set(forItems.map(placeOf))];
      for (const clientId of new Set(keys.map((k) => k.split("|")[0]))) {
        const mine = keys.filter((k) => k.startsWith(`${clientId}|`));
        const { data } = await axios.post<{ results: Place[] }>(`/api/compliance/clients/${clientId}/returns`, {
          place: true,
          rows: mine.map((key) => {
            const same = forItems.filter((r) => placeOf(r) === key);
            const [, workTypeId, month] = key.split("|");
            return {
              workTypeId,
              month,
              arn: same.find((r) => r.detected?.arn)?.detected?.arn ?? null,
              filedAt: same.find((r) => r.detected?.filedAt)?.detected?.filedAt ?? null,
            };
          }),
        });
        mine.forEach((key, i) => placed.set(key, data.results[i]));
      }
      // Oldest first, each period's JSON before its PDF, GSTR-1 before GSTR-3B,
      // so periods complete and get filed in order
      const order = (r: Row) => `${r.client!.id}|${r.month}|${["GSTR1", "IFF", "GSTR1A", "GSTR3B", "GSTR2B"].indexOf(r.detected?.gst?.form ?? "")}|${r.detected?.gst?.source === "JSON" ? 0 : 1}`;
      const uploadedGst = new Set<string>();
      for (const row of [...list].sort((a, b) => order(a).localeCompare(order(b)))) {
        const place = row.workTypeId ? placed.get(placeOf(row)) : null;
        if (place && (!place.ok || !place.itemId)) {
          setRow(row.id, { upload: "failed", message: place.ok ? "No period" : place.error });
          continue;
        }
        setRow(row.id, { upload: "uploading" });
        try {
          const result = await uploadComplianceFile(row.file, {
            clientId: row.client!.id,
            itemId: place?.ok ? place.itemId : null,
            kind: row.kind,
            gst: place?.ok ? row.detected?.gst ?? null : null,
          });
          if (result.filed?.startsWith("Marked filed")) filed++;
          if (row.detected?.gst) uploadedGst.add(row.client!.id);
          if (row.workTypeId) uploadedTo.add(placeOf(row));
          setRow(row.id, { upload: "done", place: place ?? row.place, message: result.filed ?? undefined });
          done++;
        } catch (error) {
          setRow(row.id, { upload: "failed", message: error instanceof Error && !axios.isAxiosError(error) ? error.message : apiError(error) });
        }
      }
      // Periods locked by an earlier one uploaded later in the batch
      if (uploadedGst.size) {
        const { data } = await axios.post<{ filed: number }>("/api/compliance/gst-working/file", { clientIds: [...uploadedGst] });
        filed += data.filed;
      }
      if (done) toast.success(`${done} file(s) uploaded${filed ? `; ${filed} period(s) marked filed from their returns` : ""}`);
      if (done < list.length) toast.error(`${list.length - done} file(s) could not be uploaded: see the red rows`);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      // A past period made for this upload whose files all failed is removed
      // again, so it doesn't show as done without its files
      for (const [key, place] of placed) {
        if (place.ok && place.state === "new_past" && place.itemId && !uploadedTo.has(key)) {
          await axios.delete("/api/compliance/history", { params: { itemId: place.itemId } }).catch(() => undefined);
        }
      }
      setBusy(false);
      if (done) onChanged();
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
                            {worksFor(r.client?.subscribed ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
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
