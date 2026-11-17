"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Download, Loader2, Send, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatIndianDate, formatRupees } from "@/lib/billing-constants";
import { monthLabel, previousMonthKey } from "@/lib/gst-return-number";
import { apiErrorMessage } from "./bill-types";

interface Row {
  id: string;
  status: string;
  billNumber: string | null;
  billDate: string | null;
  party: string;
  gstin: string | null;
  placeOfSupply: string | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  gstReturnNumber: string | null;
  pushedBy: string | null;
}

interface Loaded {
  view: "pending" | "pushed";
  month: string;
  isAdmin: boolean;
  series: { financialYear: string; nextNumber: number; preview: string };
  rows: Row[];
}

type PushResult = { done: { id: string; gstReturnNumber: string }[]; skipped: { id: string; reason: string }[] };

// Billing → GST return (docs/BILLING.md → GST return series). The MVC billing
// manager or Admin picks numbered GST bills and pushes them to the GST return
// of a month; each gets the next GST return number, used only in GSTR-1.
// The month's register lists them for entering in the return; Admin can take
// the last numbers back.
export function GstReturn({ pendingCount, onChanged }: { pendingCount?: number | null; onChanged: () => void }) {
  const [view, setView] = useState<"pending" | "pushed">("pending");
  const [month, setMonth] = useState(previousMonthKey);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Only the latest request counts: switching view or month while one is
  // loading must not show the older answer
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    setData(null);
    setSelected(new Set());
    try {
      const response = await axios.get<Loaded>("/api/billing/gst-return", { params: { view, month } });
      if (request === latest.current) setData(response.data);
    } catch (error) {
      if (request === latest.current) toast.error(apiErrorMessage(error, "Could not load the GST return"));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [view, month]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows ?? [];
  const selectable = data?.view === "pending" || !!data?.isAdmin;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const push = async () => {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (!ids.length || data?.view !== "pending") return;
    if (!window.confirm(`Push ${ids.length} bill${ids.length === 1 ? "" : "s"} to the GST return of ${monthLabel(month)}? Each gets the next GST return number.`)) return;
    setBusy(true);
    try {
      const { data: result } = await axios.post<PushResult>("/api/billing/gst-return", { action: "push", ids, month });
      if (result.done.length) {
        const first = result.done[0].gstReturnNumber;
        const last = result.done[result.done.length - 1].gstReturnNumber;
        toast.success(`${result.done.length} pushed: ${first}${result.done.length > 1 ? ` to ${last}` : ""}`);
      }
      if (result.skipped.length) {
        const reasons = [...new Set(result.skipped.map((s) => s.reason))].join("; ");
        toast.warning(`${result.skipped.length} not pushed: ${reasons}`, { duration: 10000 });
      }
      onChanged();
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not push the bills"));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    const chosen = rows.filter((r) => selected.has(r.id));
    if (!chosen.length) return;
    if (!window.confirm(`Take ${chosen.length} bill${chosen.length === 1 ? "" : "s"} out of the GST return? Their numbers are given again to the next bills pushed.`)) return;
    setBusy(true);
    try {
      const { data: result } = await axios.post<{ undone: number }>("/api/billing/gst-return", {
        action: "undo",
        ids: chosen.map((r) => r.id),
      });
      toast.success(`${result.undone} taken out of the GST return`);
      onChanged();
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not undo"), { duration: 10000 });
    } finally {
      setBusy(false);
    }
  };

  const active = rows.filter((r) => r.status !== "cancelled");
  const sum = (key: "taxable" | "cgst" | "sgst" | "igst" | "total") => active.reduce((n, r) => n + r[key], 0);

  return (
    <Card data-showme="gst-return">
      <CardHeader>
        <CardTitle>GST return</CardTitle>
        <CardDescription>
          Pick numbered GST bills and push them to the firm&apos;s GST return. Each gets the next GST return number
          (e.g. {data?.series.preview ?? "GR/26-27/001"}), a separate series used only in GSTR-1. It is never printed on
          the bill, emailed or sent to Tally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="gst-return-month">Return month</Label>
            <Input
              id="gst-return-month"
              type="month"
              className="w-44"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </div>
          <div role="tablist" className="inline-flex rounded-md border p-1 gap-1">
            {(["pending", "pushed"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded px-3 py-1.5 text-sm font-medium",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {v === "pending" ? "To push" : `Register of ${monthLabel(month)}`}
                {v === "pending" && !!pendingCount && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs text-foreground">{pendingCount}</span>}
              </button>
            ))}
          </div>
          {data && (
            <p className="text-sm text-muted-foreground">
              Next GST return number ({data.series.financialYear}): <span className="font-mono text-foreground">{data.series.preview}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {view === "pending" ? (
            <Button size="sm" onClick={push} disabled={busy || selected.size === 0}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Push {selected.size || ""} to GST return of {monthLabel(month)}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" asChild disabled={rows.length === 0}>
                <a href={`/api/billing/gst-return/export?month=${month}`} download>
                  <Download className="mr-1 h-4 w-4" /> Download Excel
                </a>
              </Button>
              {data?.isAdmin && (
                <Button size="sm" variant="outline" className="text-destructive" onClick={undo} disabled={busy || selected.size === 0}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1 h-4 w-4" />}
                  Undo push{selected.size ? ` (${selected.size})` : ""}
                </Button>
              )}
            </>
          )}
          {view === "pending" && (
            <span className="text-xs text-muted-foreground">
              Numbered GST bills dated up to the end of {monthLabel(month)}, not cancelled and not pushed yet.
            </span>
          )}
          {view === "pushed" && data?.isAdmin && (
            <span className="text-xs text-muted-foreground">Only the last numbers of the series can be undone.</span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {view === "pending" ? "No GST bills waiting to be pushed." : `No bills in the GST return of ${monthLabel(month)}.`}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  {selectable && (
                    <th className="w-8 p-2">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(c) => setSelected(c === true ? new Set(rows.map((r) => r.id)) : new Set())}
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  {view === "pushed" && <th className="p-2">GST return no.</th>}
                  <th className="p-2">Bill no.</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Party</th>
                  <th className="p-2">GSTIN</th>
                  <th className="p-2 text-right">Taxable</th>
                  <th className="p-2 text-right">CGST</th>
                  <th className="p-2 text-right">SGST</th>
                  <th className="p-2 text-right">IGST</th>
                  <th className="p-2 text-right">Total</th>
                  {view === "pushed" && <th className="p-2">Pushed by</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const cancelled = row.status === "cancelled";
                  return (
                    <tr key={row.id} className={cn("border-t", cancelled && "text-muted-foreground line-through")}>
                      {selectable && (
                        <td className="p-2">
                          <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggle(row.id)} aria-label={`Select ${row.billNumber}`} />
                        </td>
                      )}
                      {view === "pushed" && (
                        <td className="whitespace-nowrap p-2 font-mono font-medium">
                          {row.gstReturnNumber}
                          {cancelled && <Badge variant="outline" className="ml-2 no-underline">Cancelled</Badge>}
                        </td>
                      )}
                      <td className="whitespace-nowrap p-2 font-mono">{row.billNumber}</td>
                      <td className="whitespace-nowrap p-2">{row.billDate ? formatIndianDate(row.billDate) : ""}</td>
                      <td className="p-2">{row.party}</td>
                      <td className="whitespace-nowrap p-2 font-mono text-xs">{row.gstin ?? <span className="font-sans text-muted-foreground">B2C</span>}</td>
                      <td className="whitespace-nowrap p-2 text-right">{formatRupees(row.taxable)}</td>
                      <td className="whitespace-nowrap p-2 text-right">{formatRupees(row.cgst)}</td>
                      <td className="whitespace-nowrap p-2 text-right">{formatRupees(row.sgst)}</td>
                      <td className="whitespace-nowrap p-2 text-right">{formatRupees(row.igst)}</td>
                      <td className="whitespace-nowrap p-2 text-right">{formatRupees(row.total)}</td>
                      {view === "pushed" && <td className="whitespace-nowrap p-2 text-xs">{row.pushedBy}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t bg-muted/30 font-medium">
                <tr>
                  <td className="p-2" colSpan={(selectable ? 1 : 0) + (view === "pushed" ? 1 : 0) + 4}>
                    Total{active.length !== rows.length ? " (cancelled left out)" : ""}
                  </td>
                  <td className="whitespace-nowrap p-2 text-right">{formatRupees(sum("taxable"))}</td>
                  <td className="whitespace-nowrap p-2 text-right">{formatRupees(sum("cgst"))}</td>
                  <td className="whitespace-nowrap p-2 text-right">{formatRupees(sum("sgst"))}</td>
                  <td className="whitespace-nowrap p-2 text-right">{formatRupees(sum("igst"))}</td>
                  <td className="whitespace-nowrap p-2 text-right">{formatRupees(sum("total"))}</td>
                  {view === "pushed" && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
