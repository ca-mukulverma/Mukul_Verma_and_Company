"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Lock, MessageCircle, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { apiError, cellText, SheetItem, shortDate, statusClasses } from "./types";

// Building blocks shared by the GST, TDS and other-work sheets

export function ItemCell({ item, onOpen, compact }: { item: SheetItem | null; onOpen: (item: SheetItem) => void; compact?: boolean }) {
  if (!item) return <span className="text-xs text-muted-foreground">–</span>;
  const locked = !!item.lockReason;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={item.lockReason ? `Locked: ${item.lockReason}` : `${item.workTypeName} ${item.period}: click to update`}
      className={cn(
        "flex w-full min-w-[7.5rem] items-center gap-1 rounded border px-2 py-1 text-left text-xs font-medium hover:ring-2 hover:ring-primary/40 focus:outline-none focus:ring-2 focus:ring-primary",
        statusClasses(item),
        compact && "min-w-[6rem]"
      )}
    >
      {locked && <Lock className="h-3 w-3 shrink-0" />}
      <span className="truncate">{locked ? "Locked" : cellText(item)}</span>
      {item.frequency === "QUARTERLY" && item.kind !== "TDS_RETURN" && <span className="ml-auto rounded bg-background/60 px-1 text-[10px]">Qtr</span>}
    </button>
  );
}

// "Reminder" column: last reminder and a send button
export function ReminderCell({
  items,
  onRemind,
}: {
  items: (SheetItem | null)[];
  onRemind: () => void;
}) {
  const present = items.filter((i): i is SheetItem => !!i);
  const last = present.map((i) => i.lastReminderAt).filter(Boolean).sort().pop() ?? null;
  const count = Math.max(0, ...present.map((i) => i.reminderCount));
  const canEdit = present.some((i) => i.canEdit && !i.historical);
  const anyOpen = present.some((i) => i.status === "pending" || i.status === "data_received");
  return (
    <div className="flex items-center gap-1 whitespace-nowrap text-xs">
      {last ? <span title={`${count} reminder(s)`}>✔ {shortDate(last)}{count > 1 ? ` (${count})` : ""}</span> : <span className="text-muted-foreground">–</span>}
      {canEdit && anyOpen && (
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Send reminder" onClick={onRemind}>
          <MessageCircle className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

// "Data received" column: one tick sets it on all of the row's open items
export function DataReceivedCell({ items, onChange }: { items: (SheetItem | null)[]; onChange: (items: SheetItem[]) => void }) {
  const [saving, setSaving] = useState(false);
  const relevant = items.filter((i): i is SheetItem => !!i && i.status !== "not_required" && i.kind !== "TDS_PAYMENT");
  if (relevant.length === 0) return <span className="text-xs text-muted-foreground">–</span>;
  const received = relevant.every((i) => i.dataReceivedAt);
  const date = relevant.map((i) => i.dataReceivedAt).filter(Boolean).sort()[0] ?? null;
  const canEdit = relevant.some((i) => i.canEdit);

  const toggle = async (undo: boolean) => {
    setSaving(true);
    try {
      const { data } = await axios.post("/api/compliance/items/bulk", {
        itemIds: relevant.map((i) => i.id),
        action: undo ? "undo_data_received" : "data_received",
      });
      onChange(data.items);
      if (!undo) {
        toast.success("Data received", {
          action: { label: "Undo", onClick: () => toggle(true) },
        });
      }
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="flex items-center gap-1.5 whitespace-nowrap text-xs">
      <Checkbox checked={received} disabled={!canEdit || saving} onCheckedChange={() => toggle(received)} aria-label="Data received" />
      {date ? shortDate(date) : ""}
    </label>
  );
}

export function DocsCell({ items, onOpen }: { items: (SheetItem | null)[]; onOpen: (item: SheetItem) => void }) {
  const present = items.filter((i): i is SheetItem => !!i);
  const count = present.reduce((s, i) => s + i.documents.length, 0);
  const missing = present.some((i) => i.status === "filed" && i.missing.length > 0);
  const first = present.find((i) => i.status === "filed" && i.missing.length) ?? present[0];
  if (!first) return null;
  return (
    <button type="button" className={cn("flex items-center gap-1 text-xs", missing && "font-medium text-sky-700 dark:text-sky-300")} onClick={() => onOpen(first)}>
      <Paperclip className="h-3.5 w-3.5" />
      {count}
      {missing && " · pending"}
    </button>
  );
}

// Overall state of a row, for the Status column and filters
export function rowStatus(items: (SheetItem | null)[]) {
  const present = items.filter((i): i is SheetItem => !!i);
  if (present.length === 0) return "–";
  if (present.every((i) => i.status === "completed" || i.status === "not_required")) return "Completed";
  if (present.some((i) => i.overdue)) return "Overdue";
  const waiting = present.find((i) => i.status === "filed" && i.missing.length);
  if (waiting) return `${waiting.workTypeName}: ${waiting.missing[0]} pending`;
  const open = present.find((i) => i.status === "pending" || i.status === "data_received");
  if (open?.lockReason) return `${open.workTypeName} locked`;
  if (open) return `${open.workTypeName} ${open.status === "pending" ? "– data pending" : "– to file"}`;
  return "Filed";
}

export type RowFilter = "all" | "data_pending" | "to_file" | "files_pending" | "overdue" | "locked" | "done";

export const ROW_FILTERS: { value: RowFilter; label: string }[] = [
  { value: "all", label: "All clients" },
  { value: "data_pending", label: "Data not received" },
  { value: "to_file", label: "Data received, to file" },
  { value: "files_pending", label: "Filed, files/steps pending" },
  { value: "overdue", label: "Overdue" },
  { value: "locked", label: "Locked" },
  { value: "done", label: "Completed" },
];

export function matchesFilter(items: (SheetItem | null)[], filter: RowFilter) {
  const present = items.filter((i): i is SheetItem => !!i);
  switch (filter) {
    case "data_pending":
      return present.some((i) => i.status === "pending");
    case "to_file":
      return present.some((i) => i.status === "data_received");
    case "files_pending":
      return present.some((i) => i.status === "filed" && i.missing.length > 0);
    case "overdue":
      return present.some((i) => i.overdue);
    case "locked":
      return present.some((i) => !!i.lockReason);
    case "done":
      return present.length > 0 && present.every((i) => i.status === "completed" || i.status === "not_required");
    default:
      return true;
  }
}

export function SelectAll({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} aria-label="Select all" />;
}

// Open items of the given rows, for reminders
export function openItems(items: (SheetItem | null)[]) {
  return items.filter((i): i is SheetItem => !!i && !i.historical && (i.status === "pending" || i.status === "data_received"));
}

// The colour key above each sheet: what each cell colour means
const COLOUR_KEY: { label: string; item: Pick<SheetItem, "status" | "overdue">; hint: string }[] = [
  { label: "Pending", item: { status: "pending", overdue: false }, hint: "Waiting for the client's data" },
  { label: "Data received", item: { status: "data_received", overdue: false }, hint: "Data is in: ready to file" },
  { label: "Filed", item: { status: "filed", overdue: false }, hint: "Filed; files or steps may still be pending" },
  { label: "Completed", item: { status: "completed", overdue: false }, hint: "Filed with every file and step done" },
  { label: "Overdue", item: { status: "pending", overdue: true }, hint: "Past the due date and not filed" },
  { label: "Not required", item: { status: "not_required", overdue: false }, hint: "Nothing to file this period" },
];

export function ColourKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Colour key">
      <span className="font-medium">Colours:</span>
      {COLOUR_KEY.map((k) => (
        <span key={k.label} className="flex items-center gap-1" title={k.hint}>
          <span className={cn("inline-block h-3 w-5 rounded border", statusClasses(k.item))} />
          {k.label}
        </span>
      ))}
      <span className="flex items-center gap-1" title="An earlier period or step must be finished first">
        <Lock className="h-3 w-3" />
        Locked
      </span>
    </div>
  );
}
