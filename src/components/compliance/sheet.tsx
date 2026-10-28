"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { CheckSquare, Loader2, MessageCircle, RefreshCw, Search, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ItemDialog } from "./item-dialog";
import { ReminderDialog, ReminderTarget } from "./reminder-dialog";
import {
  ColourKey,
  DataReceivedCell,
  DocsCell,
  ItemCell,
  matchesFilter,
  openItems,
  ReminderCell,
  ROW_FILTERS,
  RowFilter,
  rowStatus,
  SelectAll,
} from "./sheet-parts";
import { apiError, ClientCell, longDate, rupees, SheetItem, shortDate } from "./types";

export interface WorkTypeInfo {
  id: string;
  name: string;
  kind: string;
  frequency: string;
  reminderMessage: string;
  active: boolean;
}

type View = "gst" | "tds" | "work";

interface Row {
  client: ClientCell;
  // Named cells: gstr1/gstr3b, m0–m2 and return work type ids, or item
  slots: Record<string, SheetItem | null>;
}

interface SheetMeta {
  months?: string[];
  returnTypes?: { id: string; name: string }[];
  period?: string;
}

function rowItems(row: Row) {
  return Object.values(row.slots);
}

function normalize(view: View, data: Record<string, unknown>): { rows: Row[]; meta: SheetMeta } {
  if (view === "gst") {
    const rows = (data.rows as { client: ClientCell; gstr1: SheetItem | null; gstr3b: SheetItem | null }[]).map((r) => ({
      client: r.client,
      slots: { gstr1: r.gstr1, gstr3b: r.gstr3b },
    }));
    return { rows, meta: {} };
  }
  if (view === "tds") {
    const returnTypes = data.returnTypes as { id: string; name: string }[];
    const rows = (data.rows as { client: ClientCell; months: (SheetItem | null)[]; returns: Record<string, SheetItem> }[]).map((r) => ({
      client: r.client,
      slots: {
        m0: r.months[0],
        m1: r.months[1],
        m2: r.months[2],
        ...Object.fromEntries(returnTypes.map((t) => [t.id, r.returns[t.id] ?? null])),
      },
    }));
    return { rows, meta: { months: data.months as string[], returnTypes } };
  }
  const rows = (data.rows as { client: ClientCell; item: SheetItem }[]).map((r) => ({ client: r.client, slots: { item: r.item } }));
  return { rows, meta: { period: data.period as string } };
}

// The month a sheet opens on: GST returns of a month are filed in the next
// month, so until the 20th the previous month is shown
function defaultMonth(view: View) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  if (view === "work") return today.slice(0, 7);
  const back = view === "gst" ? d <= 20 : true;
  const date = new Date(Date.UTC(y, m - 1 - (back ? 1 : 0), 1));
  return date.toISOString().slice(0, 7);
}

// Each person's last filter on each sheet, kept in this browser
function savedFilter(view: View): { filter: RowFilter; mine: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(`compliance-filter-${view}`) || "null");
    if (saved && ROW_FILTERS.some((f) => f.value === saved.filter)) return { filter: saved.filter, mine: !!saved.mine };
  } catch {
    // Nothing saved, or storage blocked
  }
  return { filter: "all", mine: false };
}

export function ComplianceSheet({
  view,
  workTypes,
  isManager,
  initialWorkTypeId,
  initialMonth,
  initialItemId,
}: {
  view: View;
  workTypes: WorkTypeInfo[];
  isManager: boolean;
  initialWorkTypeId?: string | null;
  // Opened from a link (My work → Open): this period, with this item's popup open
  initialMonth?: string | null;
  initialItemId?: string | null;
}) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const genericTypes = workTypes.filter((w) => w.active && w.kind === "GENERIC");
  const [month, setMonth] = useState(() => (initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : defaultMonth(view)));
  const [workTypeId, setWorkTypeId] = useState<string>(initialWorkTypeId ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<SheetMeta>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilterState] = useState<RowFilter>("all");
  const [mine, setMineState] = useState(false);
  const [pendingItemId, setPendingItemId] = useState(initialItemId ?? null);

  useEffect(() => {
    const saved = savedFilter(view);
    setFilterState(saved.filter);
    setMineState(saved.mine);
  }, [view]);

  const remember = (next: { filter: RowFilter; mine: boolean }) => {
    try {
      localStorage.setItem(`compliance-filter-${view}`, JSON.stringify(next));
    } catch {
      // Kept until the page is reloaded
    }
  };
  const setFilter = (next: RowFilter) => {
    setFilterState(next);
    remember({ filter: next, mine });
  };
  const setMine = (next: boolean) => {
    setMineState(next);
    remember({ filter, mine: next });
  };
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{ item: SheetItem; client: ClientCell } | null>(null);
  const [reminder, setReminder] = useState<ReminderTarget[] | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const effectiveWorkTypeId = view === "work" ? workTypeId || genericTypes[0]?.id || "" : "";

  const load = useCallback(async () => {
    if (view === "work" && !effectiveWorkTypeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get("/api/compliance/sheet", {
        params: { view, month, ...(view === "work" && { workTypeId: effectiveWorkTypeId }) },
      });
      const normalized = normalize(view, data);
      setRows(normalized.rows);
      setMeta(normalized.meta);
      setSelected([]);
    } catch (error) {
      toast.error(apiError(error, "Could not load the sheet"));
    } finally {
      setLoading(false);
    }
  }, [view, month, effectiveWorkTypeId]);

  useEffect(() => {
    load();
  }, [load]);

  // Open the item asked for in the link once its sheet has loaded
  useEffect(() => {
    if (!pendingItemId || loading) return;
    for (const row of rows) {
      const item = rowItems(row).find((i) => i?.id === pendingItemId);
      if (item) {
        setDialog({ item, client: row.client });
        break;
      }
    }
    setPendingItemId(null);
  }, [pendingItemId, loading, rows]);

  const updateItems = useCallback((updated: SheetItem[]) => {
    const byId = new Map(updated.map((i) => [i.id, i]));
    setRows((current) =>
      current.map((row) => {
        let changed = false;
        const slots = Object.fromEntries(
          Object.entries(row.slots).map(([key, item]) => {
            const next = item && byId.get(item.id);
            if (next) changed = true;
            return [key, next ?? item];
          })
        );
        return changed ? { ...row, slots } : row;
      })
    );
    setDialog((d) => (d && byId.get(d.item.id) ? { ...d, item: byId.get(d.item.id)! } : d));
  }, []);

  // A change can unlock or lock other items (e.g. filing GSTR-1 opens GSTR-3B),
  // so the sheet is reloaded when the popup closes
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const onItemChange = (item: SheetItem) => {
    updateItems([item]);
    setNeedsRefresh(true);
  };
  const closeDialog = () => {
    setDialog(null);
    if (needsRefresh) {
      setNeedsRefresh(false);
      load();
    }
  };

  // Rows matching the search and "My clients", before the status filter
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!q || row.client.name.toLowerCase().includes(q) || row.client.gstin?.toLowerCase().includes(q)) &&
        (!mine || row.client.managerId === userId)
    );
  }, [rows, search, mine, userId]);
  const visible = useMemo(() => searched.filter((row) => matchesFilter(rowItems(row), filter)), [searched, filter]);
  const filterCounts = useMemo(
    () => Object.fromEntries(ROW_FILTERS.map((f) => [f.value, searched.filter((row) => matchesFilter(rowItems(row), f.value)).length])),
    [searched]
  );

  const templateFor = (items: SheetItem[]) => {
    const first = [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    return workTypes.find((w) => w.id === first?.workTypeId)?.reminderMessage ?? null;
  };

  const remindRows = (targetRows: Row[]) => {
    const targets = targetRows
      .map((row) => ({ clientId: row.client.id, clientName: row.client.name, itemIds: openItems(rowItems(row)).filter((i) => i.canEdit).map((i) => i.id) }))
      .filter((t) => t.itemIds.length > 0);
    if (targets.length === 0) {
      toast.info("Nothing pending to remind about");
      return;
    }
    setReminder(targets);
  };

  const markSelectedReceived = async () => {
    const ids = rows
      .filter((r) => selected.includes(r.client.id))
      .flatMap((r) => openItems(rowItems(r)))
      .filter((i) => !i.dataReceivedAt && i.kind !== "TDS_PAYMENT" && i.canEdit)
      .map((i) => i.id);
    if (ids.length === 0) return toast.info("Nothing to mark");
    setBulkSaving(true);
    try {
      const { data } = await axios.post("/api/compliance/items/bulk", { itemIds: ids, action: "data_received" });
      updateItems(data.items);
      toast.success(`Data received for ${selected.length} client(s)`);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBulkSaving(false);
    }
  };

  const open = (row: Row) => (item: SheetItem) => setDialog({ item, client: row.client });
  const allSelected = visible.length > 0 && visible.every((r) => selected.includes(r.client.id));

  // Columns of each sheet
  const headers: string[] =
    view === "gst"
      ? ["Client", "Reminder", "Data recd", "GSTR-1", "1A", "RCM", "GSTR-3B", "Tax payable", "Files", "Status"]
      : view === "tds"
        ? ["Client", "Reminder", ...(meta.months ?? ["Month 1", "Month 2", "Month 3"]), ...(meta.returnTypes ?? []).map((t) => t.name), "Files", "Status"]
        : ["Client", "Reminder", "Data recd", "Work", "Filed", "Tax payable", "Files", "Status"];

  const cells = (row: Row) => {
    const items = rowItems(row);
    const reminderCell = <ReminderCell items={items} onRemind={() => remindRows([row])} />;
    const files = <DocsCell items={items} onOpen={open(row)} />;
    const status = <span className="text-xs">{rowStatus(items)}</span>;
    if (view === "gst") {
      const { gstr1, gstr3b } = row.slots;
      const lines = gstr3b?.lines ?? [];
      const resolved = lines.filter((l) => l.status !== "pending").length;
      return [
        reminderCell,
        <DataReceivedCell key="d" items={items} onChange={updateItems} />,
        <ItemCell key="1" item={gstr1} onOpen={open(row)} />,
        gstr1?.gstr1aFiled ? (
          <button key="1a" className="text-xs underline" onClick={() => open(row)(gstr1)}>Filed {shortDate(gstr1.gstr1aFiledAt)}</button>
        ) : (
          <span key="1a" className="text-xs text-muted-foreground">–</span>
        ),
        lines.length && gstr3b ? (
          <button
            key="rcm"
            className={cn("text-xs", resolved === lines.length ? "text-emerald-700 dark:text-emerald-400" : "font-medium text-amber-700 dark:text-amber-300")}
            onClick={() => open(row)(gstr3b)}
          >
            {resolved === lines.length ? "✓" : ""} {resolved}/{lines.length}
          </button>
        ) : (
          <span key="rcm" className="text-xs text-muted-foreground">–</span>
        ),
        <ItemCell key="3" item={gstr3b} onOpen={open(row)} />,
        gstr3b ? (
          <button key="t" className="whitespace-nowrap text-xs" onClick={() => open(row)(gstr3b)}>
            {gstr3b.taxPayable !== null ? rupees(gstr3b.taxPayable) : <span className="text-muted-foreground">add</span>}
          </button>
        ) : (
          <span key="t" />
        ),
        files,
        status,
      ];
    }
    if (view === "tds") {
      return [
        reminderCell,
        ...["m0", "m1", "m2"].map((k) => <ItemCell key={k} item={row.slots[k]} onOpen={open(row)} compact />),
        ...(meta.returnTypes ?? []).map((t) => {
          const ret = row.slots[t.id];
          const steps =
            ret?.needsCertificates && (ret.status === "filed" || ret.status === "completed")
              ? [ret.certRequestedAt ? "req ✓" : "req", ret.documents.some((d) => d.kind === "CERTIFICATE") ? "file ✓" : "file", ret.certEmailedAt ? "mail ✓" : "mail"]
              : null;
          return (
            <div key={t.id} className="space-y-0.5">
              <ItemCell item={ret} onOpen={open(row)} />
              {steps && <p className="whitespace-nowrap text-[10px] text-muted-foreground">{ret!.workTypeName.includes("24Q") ? "Form 16" : "16A"}: {steps.join(" · ")}</p>}
            </div>
          );
        }),
        files,
        status,
      ];
    }
    const item = row.slots.item;
    return [
      reminderCell,
      <DataReceivedCell key="d" items={items} onChange={updateItems} />,
      <ItemCell key="i" item={item} onOpen={open(row)} />,
      <span key="f" className="whitespace-nowrap text-xs">{item?.filedAt ? `${longDate(item.filedAt)}${item.arn ? ` · ${item.arn}` : ""}` : "–"}</span>,
      item ? (
        <button key="t" className="text-xs" onClick={() => open(row)(item)}>
          {item.taxPayable !== null ? rupees(item.taxPayable) : <span className="text-muted-foreground">–</span>}
        </button>
      ) : (
        <span key="t" />
      ),
      files,
      status,
    ];
  };

  const periodHint = view === "tds" ? "Any month of the quarter" : view === "work" ? "Any month of the period" : "Month";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        {view === "work" && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Work</p>
            <Select value={effectiveWorkTypeId} onValueChange={setWorkTypeId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Choose a work" /></SelectTrigger>
              <SelectContent>
                {genericTypes.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{periodHint}</p>
          <Input type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-56 pl-8" placeholder="Search client or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="ghost" size="icon" onClick={load} title="Refresh">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {selected.length > 0 && view !== "tds" && (
            <Button variant="outline" size="sm" disabled={bulkSaving} onClick={markSelectedReceived}>
              {bulkSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckSquare className="mr-1 h-4 w-4" />} Data received ({selected.length})
            </Button>
          )}
          {selected.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => remindRows(rows.filter((r) => selected.includes(r.client.id)))}>
              <MessageCircle className="mr-1 h-4 w-4" /> Remind selected ({selected.length})
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => remindRows(visible.filter((r) => rowItems(r).some((i) => i && i.status === "pending" && !i.historical)))}
          >
            <MessageCircle className="mr-1 h-4 w-4" /> Remind all with data pending
          </Button>
        </div>
      </div>

      {/* Quick filters with how many clients each has; the choice is remembered */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant={mine ? "default" : "outline"}
          className="h-7 rounded-full px-3 text-xs"
          onClick={() => setMine(!mine)}
          title="Only clients you manage"
        >
          <UserCheck className="mr-1 h-3.5 w-3.5" />My clients
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {ROW_FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
            <Badge variant="secondary" className="ml-1.5 h-4 rounded-full px-1.5 text-[10px]">
              {filterCounts[f.value] ?? 0}
            </Badge>
          </Button>
        ))}
      </div>
      <ColourKey />

      {view !== "gst" && (meta.period || meta.months) && (
        <p className="text-sm text-muted-foreground">
          {meta.period ?? `Quarter: ${meta.months![0]} – ${meta.months![2]}`}
        </p>
      )}

      {view === "work" && genericTypes.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No other works yet. Admins and Partners can add them in Setup.</p>
      ) : (
        // Scrolls inside its own box so the header row and client column stay in view
        <div className="max-h-[70vh] overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="w-8 border-b p-2">
                  <SelectAll checked={allSelected} onChange={(c) => setSelected(c ? visible.map((r) => r.client.id) : [])} />
                </th>
                {headers.map((h, i) => (
                  <th key={h + i} className={cn("whitespace-nowrap border-b p-2 text-left text-xs font-semibold", i === 0 && "sticky left-0 z-20 bg-muted")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length + 1} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={headers.length + 1} className="p-8 text-center text-sm text-muted-foreground">
                    {rows.length === 0
                      ? "No clients have this work for this period. Admins and Partners add clients in Compliance → Clients."
                      : "No client matches the search or filter."}
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr key={row.client.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-2">
                      <Checkbox
                        checked={selected.includes(row.client.id)}
                        onCheckedChange={(c) => setSelected((s) => (c === true ? [...s, row.client.id] : s.filter((id) => id !== row.client.id)))}
                        aria-label={`Select ${row.client.name}`}
                      />
                    </td>
                    <td className="sticky left-0 z-[1] max-w-[14rem] bg-background p-2">
                      <p className="truncate font-medium" title={row.client.name}>{row.client.name}</p>
                      {row.client.gstin && <p className="text-[11px] text-muted-foreground">{row.client.gstin}</p>}
                      {row.client.noWhatsapp && (
                        <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          ⚠ No WhatsApp number{row.client.responsibleName ? ` for ${row.client.responsibleName}` : ""}
                        </p>
                      )}
                    </td>
                    {cells(row).map((cell, i) => (
                      <td key={i} className="p-2 align-middle">
                        <Fragment>{cell}</Fragment>
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {visible.length} of {rows.length} clients · Click a cell to update it · Tick clients to mark data received or remind them together
      </p>

      {dialog && (
        <ItemDialog item={dialog.item} client={dialog.client} isManager={isManager} onClose={closeDialog} onChange={onItemChange} />
      )}
      {reminder && (
        <ReminderDialog
          targets={reminder}
          template={templateFor(rows.flatMap((r) => openItems(rowItems(r))).filter((i) => reminder.some((t) => t.itemIds.includes(i.id))))}
          onClose={() => setReminder(null)}
          onSent={load}
        />
      )}
    </div>
  );
}
