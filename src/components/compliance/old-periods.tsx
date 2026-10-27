"use client";

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Download, FileUp, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WorkType } from "./setup";
import { apiError, currentMonthKey, todayKey } from "./types";
import { uploadComplianceFile } from "./upload";
import { returnFileKind } from "./old-period-files";

// Past periods of one work for a client, one row per month or quarter, each
// with its filing details and return PDF / JSON. Saving a row completes it;
// missing files show as tags. Many files at once go through Upload returns,
// which reads each file for its period.

interface Row {
  month: string;
  months: string[];
  period: string;
  item: {
    id: string;
    status: string;
    historical: boolean;
    filedAt: string | null;
    arn: string | null;
    isNil: boolean | null;
    documents: { id: string; kind: string; fileName: string }[];
  } | null;
}

interface Loaded {
  workType: { id: string; name: string; requirePdf: boolean; requireJson: boolean };
  trackedFrom: string | null;
  rows: Row[];
}

interface Draft {
  filedAt: string;
  arn: string;
  isNil: boolean;
  status: "completed" | "not_required";
}

// The financial year before the current one: April of last year to last month
function defaultRange() {
  const [y, m] = currentMonthKey().split("-").map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  const last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return { from: `${fyStart - 1}-04`, to: last };
}

export function OldPeriods({ clientId, workTypes, onChanged }: { clientId: string; workTypes: WorkType[]; onChanged: () => void }) {
  const [workTypeId, setWorkTypeId] = useState(workTypes[0]?.id ?? "");
  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState<Loaded | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get<Loaded>("/api/compliance/history", { params: { clientId, workTypeId, ...range } });
      setData(data);
      setDrafts(
        Object.fromEntries(
          data.rows.map((r) => [
            r.month,
            {
              filedAt: r.item?.filedAt ?? "",
              arn: r.item?.arn ?? "",
              isNil: r.item?.isNil === true,
              status: r.item?.status === "not_required" ? "not_required" : "completed",
            },
          ])
        )
      );
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setLoading(false);
    }
  };

  const setDraft = (month: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [month]: { ...d[month], ...patch } }));

  // Saves the row (creating its period if needed) and returns its item id
  const saveRow = async (row: Row): Promise<string | null> => {
    const d = drafts[row.month];
    const { data: saved } = await axios.post("/api/compliance/history", {
      clientId,
      workTypeId,
      month: row.month,
      status: d.status,
      filedAt: d.filedAt || null,
      arn: d.arn.trim() || null,
      isNil: d.isNil,
    });
    return saved.itemId ?? null;
  };

  const save = async (row: Row) => {
    setBusy(row.month);
    try {
      await saveRow(row);
      toast.success(`${row.period} saved`);
      await load();
      onChanged();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(null);
    }
  };

  const uploadTo = async (row: Row, files: File[]) => {
    let itemId = row.item?.id ?? null;
    if (!itemId) itemId = await saveRow(row);
    if (!itemId) return;
    for (const file of files) {
      const kind = returnFileKind(file.name) ?? "OTHER";
      await uploadComplianceFile(file, { clientId, itemId, kind });
    }
  };

  const uploadRow = async (row: Row, files: FileList | null) => {
    if (!files?.length) return;
    setBusy(row.month);
    try {
      await uploadTo(row, Array.from(files));
      toast.success(`${files.length} file(s) added to ${row.period}`);
      await load();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error && !axios.isAxiosError(error) ? error.message : apiError(error));
    } finally {
      setBusy(null);
    }
  };

  const editable = (row: Row) => !row.item || row.item.historical;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        For periods before tracking started, so the full history and every return PDF / JSON is in one place. A saved period is completed; a
        missing PDF or JSON shows as a tag. No RCM/TDS check, reminders or bills are made for them.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Select value={workTypeId} onValueChange={(v) => { setWorkTypeId(v); setData(null); }}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            {workTypes.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="month" className="w-40" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} title="From" />
        <Input type="month" className="w-40" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} title="To" />
        <Button size="sm" variant="outline" disabled={loading || !workTypeId || !range.from || !range.to} onClick={load}>
          {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />} Show periods
        </Button>
      </div>

      {data && (
        <>
          {data.trackedFrom && <p className="text-xs text-muted-foreground">Tracked in the sheets from {data.trackedFrom}; those periods are changed in the sheet.</p>}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs">
                <tr>
                  <th className="p-2">Period</th>
                  <th className="p-2">Filed on</th>
                  <th className="p-2">ARN / ack.</th>
                  <th className="p-2">Nil</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Files</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <PeriodRow
                    key={row.month}
                    row={row}
                    draft={drafts[row.month]}
                    workType={data.workType}
                    editable={editable(row)}
                    busy={busy}
                    onDraft={(patch) => setDraft(row.month, patch)}
                    onSave={() => save(row)}
                    onUpload={(files) => uploadRow(row, files)}
                  />
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No finished periods in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PeriodRow({
  row,
  draft,
  workType,
  editable,
  busy,
  onDraft,
  onSave,
  onUpload,
}: {
  row: Row;
  draft: Draft | undefined;
  workType: Loaded["workType"];
  editable: boolean;
  busy: string | null;
  onDraft: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onUpload: (files: FileList | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (!draft) return null;
  const docs = row.item?.documents ?? [];
  const hasPdf = docs.some((d) => d.kind === "RETURN_PDF");
  const hasJson = docs.some((d) => d.kind === "RETURN_JSON");
  const saved = !!row.item;
  const disabled = !editable || busy !== null;

  return (
    <tr className={cn("border-t", !editable && "opacity-60")}>
      <td className="whitespace-nowrap p-2 font-medium">
        {row.period}
        {saved && editable && <Check className="ml-1 inline h-3.5 w-3.5 text-emerald-600" />}
        {!editable && <span className="block text-[11px] font-normal text-muted-foreground">In the sheet</span>}
      </td>
      <td className="p-2">
        <Input type="date" className="w-36" max={todayKey()} value={draft.filedAt} disabled={disabled || draft.status === "not_required"} onChange={(e) => onDraft({ filedAt: e.target.value })} />
      </td>
      <td className="p-2">
        <Input className="w-40" maxLength={50} value={draft.arn} disabled={disabled || draft.status === "not_required"} onChange={(e) => onDraft({ arn: e.target.value })} />
      </td>
      <td className="p-2">
        <Checkbox checked={draft.isNil} disabled={disabled || draft.status === "not_required"} onCheckedChange={(c) => onDraft({ isNil: c === true })} />
      </td>
      <td className="p-2">
        <Select value={draft.status} onValueChange={(status) => onDraft({ status: status as Draft["status"] })} disabled={disabled}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="not_required">Not required</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="p-2">
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {docs.map((d) => (
            <a key={d.id} href={`/api/compliance/documents/${d.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 rounded border px-1 hover:bg-muted" title={d.fileName}>
              <Download className="h-3 w-3" /> {d.kind === "RETURN_JSON" ? "JSON" : d.kind === "RETURN_PDF" ? "PDF" : "File"}
            </a>
          ))}
          {draft.status === "completed" && workType.requirePdf && !hasPdf && <span className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">PDF missing</span>}
          {draft.status === "completed" && workType.requireJson && !hasJson && <span className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">JSON missing</span>}
          {editable && (
            <>
              <input ref={inputRef} type="file" multiple accept=".pdf,.json,.zip" className="hidden" onChange={(e) => onUpload(e.target.files)} />
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={disabled} onClick={() => inputRef.current?.click()}>
                <FileUp className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </td>
      <td className="p-2 text-right">
        {editable && (
          <Button size="sm" variant={saved ? "outline" : "default"} disabled={disabled} onClick={onSave}>
            {busy === row.month && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {saved ? "Update" : "Save"}
          </Button>
        )}
      </td>
    </tr>
  );
}
