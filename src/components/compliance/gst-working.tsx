"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileSearch, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Heads, totalTax } from "@/lib/gst-read/types";
import { Issue, RowKey, WORKING_ROWS } from "@/lib/gst-read/working";
import type { ClientWorking } from "@/lib/gst-working";
import { apiError, currentMonthKey } from "./types";

// GST working (see docs/GST_WORKING.md), on the client's page in Compliance →
// Clients: every figure comes from the return files uploaded for the period,
// in the firm's format, with what doesn't tie under each period, and sent to
// the client as Excel/PDF. Nothing is typed in or signed off here.

type Period = ClientWorking["periods"][number];
type Column = "taxable" | "cgst" | "sgst" | "igst" | "cess" | "total";

// Every head side by side, in the order the working is read
const COLUMNS: { key: Column; label: string }[] = [
  { key: "taxable", label: "Taxable" },
  { key: "cgst", label: "CGST" },
  { key: "sgst", label: "SGST" },
  { key: "igst", label: "IGST" },
  { key: "cess", label: "Cess" },
  { key: "total", label: "Total" },
];

// "Total" is the taxable value plus all the tax
const valueOf = (h: Heads, key: Column) => (key === "total" ? h.taxable + totalTax(h) : h[key]);
// "year" is the whole financial year; otherwise a period's start (YYYY-MM)
type Selection = "year" | string;
const amount = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fyOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}
const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
function previousMonth() {
  const [y, m] = currentMonthKey().split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const SEVERITY: Record<Issue["severity"], { label: string; className: string }> = {
  difference: { label: "Difference", className: "text-red-700 dark:text-red-400" },
  missing: { label: "Missing", className: "text-amber-700 dark:text-amber-400" },
  check: { label: "Check", className: "text-sky-700 dark:text-sky-400" },
};

function Issues({ issues }: { issues: Issue[] }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {issues.map((i, n) => (
        <li key={n} className={SEVERITY[i.severity].className}>
          <span className="font-semibold">{SEVERITY[i.severity].label}:</span> {i.text}
        </li>
      ))}
    </ul>
  );
}

// ‹ FY 2025-26 › : earlier and later years with a tap, no list to open
function FyStepper({ fy, setFy }: { fy: number; setFy: (fy: number) => void }) {
  const current = fyOf(currentMonthKey());
  return (
    <div className="flex items-center gap-1">
      <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setFy(fy - 1)} disabled={fy <= current - 4} aria-label="Previous year">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-24 text-center text-sm font-semibold">{fyLabel(fy)}</span>
      <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setFy(fy + 1)} disabled={fy >= current} aria-label="Next year">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── One client's year ──────────────────────────────────────────────────────

export function ClientGstWorking({ clientId, email, refresh }: { clientId: string; email: string | null; refresh: number }) {
  const [fy, setFy] = useState(fyOf(previousMonth()));
  const [data, setData] = useState<ClientWorking | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [to, setTo] = useState(email ?? "");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState<{ id: string; fileName: string }[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      axios.get<ClientWorking>("/api/compliance/gst-working", { params: { clientId, fy } }),
      axios.get<{ docs: { id: string; fileName: string }[] }>("/api/compliance/gst-working/unread", { params: { clientId } }),
    ])
      .then(([working, docs]) => {
        setData(working.data);
        // Opens on the latest period with figures (the year when there are none),
        // and keeps the period chosen when the same year reloads after an upload
        setSelected((current) => {
          if (current && (current === "year" || working.data.periods.some((p) => p.start === current))) return current;
          const withFigures = working.data.periods.filter((p) => Object.keys(p.rows).length > 0);
          return withFigures.length ? withFigures[withFigures.length - 1].start : "year";
        });
        setTo((t) => t || working.data.client.email || "");
        setUnread(docs.data.docs);
      })
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, [clientId, fy]);
  // A new year opens on its own latest period
  useEffect(() => setSelected(null), [fy]);
  useEffect(() => {
    load();
  }, [load, refresh, version]);

  // Files uploaded before the app read figures: read them now in the browser
  const readEarlier = async () => {
    const { readGstBytes } = await import("./gst-file");
    let done = 0;
    let filed = 0;
    const problems: string[] = [];
    for (const [n, doc] of unread.entries()) {
      setReading(`Reading ${n + 1} of ${unread.length}: ${doc.fileName}`);
      try {
        const response = await fetch(`/api/compliance/documents/${doc.id}`);
        if (!response.ok) throw new Error("download failed");
        const gst = await readGstBytes(doc.fileName, await response.arrayBuffer());
        if (!gst) {
          problems.push(`${doc.fileName}: not a return the app reads`);
          continue;
        }
        const { data: result } = await axios.patch(`/api/compliance/documents/${doc.id}`, { gst });
        done++;
        if (result.filed?.startsWith("Marked filed")) filed++;
      } catch (error) {
        problems.push(`${doc.fileName}: ${apiError(error, "couldn't be read")}`);
      }
    }
    if (done) {
      const { data: more } = await axios.post<{ filed: number }>("/api/compliance/gst-working/file", { clientIds: [clientId] }).catch(() => ({ data: { filed: 0 } }));
      filed += more.filed;
    }
    setReading(null);
    if (done) toast.success(`Figures read from ${done} file(s)${filed ? `; ${filed} period(s) marked filed` : ""}`);
    if (problems.length) toast.error(problems.slice(0, 3).join("; ") + (problems.length > 3 ? ` and ${problems.length - 3} more` : ""));
    setVersion((v) => v + 1);
  };

  const sendEmail = async () => {
    setSending(true);
    try {
      await axios.post("/api/compliance/gst-working/email", { clientId, fy, to });
      toast.success("GST working emailed");
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSending(false);
    }
  };

  const columns = COLUMNS.filter((c) => c.key !== "cess" || data?.hasCess);
  const rows = WORKING_ROWS.filter((r) => !("key" in r) || !r.optional || data?.periods.some((p) => p.rows[r.key] && valueOf(p.rows[r.key]!, "total") !== 0));
  const periods = data?.periods ?? [];
  const index = periods.findIndex((p) => p.start === selected);
  const period = index >= 0 ? periods[index] : null;
  // The figures shown: one period, or the year's total
  const figures = period ? period.rows : data?.total ?? {};
  const shortTitle = (p: Period) => p.title.replace(/ \d{4}-\d{2}$/, "");
  // Previous / next go through Year, then each period in turn
  const order: Selection[] = ["year", ...periods.map((p) => p.start)];
  const position = order.indexOf(selected ?? "year");
  const step = (by: number) => setSelected(order[Math.min(order.length - 1, Math.max(0, position + by))]);
  const exportUrl = (format: string) => `/api/compliance/gst-working/export?${new URLSearchParams({ clientId, fy: String(fy), format })}`;
  const attention = data?.periods.filter((p) => p.issues.length > 0) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FyStepper fy={fy} setFy={setFy} />
        <Button asChild size="sm" variant="outline">
          <a href={exportUrl("xlsx")}><Download className="mr-1 h-4 w-4" /> Excel</a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={exportUrl("pdf")}><Download className="mr-1 h-4 w-4" /> PDF</a>
        </Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>

      {!data ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <>
          {unread.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <FileSearch className="h-4 w-4" />
              {reading ?? `${unread.length} return file(s) were uploaded before figures were read from files.`}
              {!reading && <Button size="sm" variant="outline" onClick={readEarlier}>Read their figures</Button>}
            </div>
          )}

          {/* One button per month (or quarter); scrolls sideways on a phone */}
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => step(-1)} disabled={position <= 0} aria-label="Previous period">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex flex-1 gap-1.5 overflow-x-auto pb-1">
              {order.map((key) => {
                const p = periods.find((x) => x.start === key);
                const active = (selected ?? "year") === key;
                const empty = p && Object.keys(p.rows).length === 0;
                return (
                  <Button
                    key={key}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className={cn("h-8 shrink-0 rounded-full px-3 text-xs", empty && !active && "text-muted-foreground")}
                    onClick={() => setSelected(key)}
                  >
                    {p ? shortTitle(p) : "Year total"}
                    {p?.hasDifference && <AlertTriangle className={cn("ml-1 h-3 w-3", active ? "text-white" : "text-red-600")} />}
                  </Button>
                );
              })}
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => step(1)} disabled={position >= order.length - 1} aria-label="Next period">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <p className="text-sm font-semibold">
            {period ? period.title : `${fyLabel(fy)} – total of all periods`}
            {period && Object.keys(period.rows).length === 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">No return files uploaded for this period yet</span>
            )}
          </p>

          {/* Computer: one table with every head side by side */}
          <div className="hidden overflow-x-auto rounded-md border md:block">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left">PARTICULARS</th>
                  {columns.map((c) => (
                    <th key={c.key} className={cn("whitespace-nowrap p-2 text-right", c.key === "total" && "bg-muted-foreground/10")}>
                      {c.label.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((def, n) =>
                  "heading" in def ? (
                    <tr key={`h${n}`} className="border-t bg-muted/40">
                      <td className="p-1.5 font-semibold underline" colSpan={columns.length + 1}>{def.heading}</td>
                    </tr>
                  ) : (
                    <tr key={def.key} className={cn("border-t", isNetRow(def.key) && "font-semibold")}>
                      <td className={cn("p-1.5", def.difference && "font-semibold")}>{def.label}</td>
                      {columns.map((c) => (
                        <Cell key={c.key} value={figures[def.key as RowKey]} column={c.key} difference={def.difference} />
                      ))}
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>

          {/* Phone: one card per line, the heads under each other, no sideways scrolling */}
          <div className="space-y-2 md:hidden">
            {rows.map((def, n) =>
              "heading" in def ? (
                <p key={`h${n}`} className="pt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{def.heading}</p>
              ) : (
                <MobileRow key={def.key} label={def.label} value={figures[def.key as RowKey]} columns={columns} difference={def.difference} strong={isNetRow(def.key)} />
              )
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Every figure is read from the files uploaded for the period (GSTR-1/IFF JSON and PDF, GSTR-1A PDF, GSTR-3B PDF, GSTR-2B JSON); to correct one, upload the corrected file. The Excel and PDF have every month together.
          </p>

          {period ? (
            period.issues.length > 0 || period.files.some((f) => f.state === "missing") ? (
              <PeriodCard period={period} />
            ) : (
              Object.keys(period.rows).length > 0 && <p className="text-xs text-emerald-700 dark:text-emerald-400">Everything ties for {period.title}.</p>
            )
          ) : attention.length > 0 ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {attention.map((p) => <PeriodCard key={p.start} period={p} />)}
            </div>
          ) : (
            data.periods.some((p) => p.files.some((f) => f.state === "ok")) && <p className="text-xs text-emerald-700 dark:text-emerald-400">Everything ties for the periods uploaded.</p>
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <Input className="min-w-64 flex-1" placeholder="Client email (several: separate with commas)" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button size="sm" disabled={sending || !to.trim()} onClick={sendEmail}>
              {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Mail className="mr-1 h-4 w-4" />} Email the working (Excel and PDF)
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const isNetRow = (key: string) => key.endsWith("_net") || key === "net_after_1a";

// A difference shows ✓ when it ties (under ₹1) and the amount in red when not
function shown(value: Heads | undefined, column: Column, difference?: boolean) {
  if (!value) return { text: "–", tone: "text-muted-foreground" };
  const v = valueOf(value, column);
  if (!difference) return { text: amount(v), tone: "" };
  return Math.abs(v) >= 1 ? { text: amount(v), tone: "font-semibold text-red-600" } : { text: "✓", tone: "text-emerald-700 dark:text-emerald-400" };
}

function Cell({ value, column, difference }: { value: Heads | undefined; column: Column; difference?: boolean }) {
  const { text, tone } = shown(value, column, difference);
  return <td className={cn("whitespace-nowrap p-1.5 text-right tabular-nums", column === "total" && "bg-muted/40 font-semibold", tone)}>{text}</td>;
}

function MobileRow({
  label,
  value,
  columns,
  difference,
  strong,
}: {
  label: string;
  value: Heads | undefined;
  columns: { key: Column; label: string }[];
  difference?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={cn("rounded-md border p-2", strong && "border-primary/40 bg-primary/5")}>
      <p className={cn("mb-1 text-xs", (strong || difference) && "font-semibold")}>{label}</p>
      {!value ? (
        <p className="text-xs text-muted-foreground">–</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          {columns.map((c) => {
            const { text, tone } = shown(value, c.key, difference);
            return (
              <div key={c.key} className={cn("flex justify-between gap-2", c.key === "total" && "col-span-2 border-t pt-0.5 font-semibold")}>
                <dt className="text-muted-foreground">{c.label}</dt>
                <dd className={cn("tabular-nums", tone)}>{text}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}

// What doesn't tie in one period, and which files are still to upload
function PeriodCard({ period }: { period: Period }) {
  const missing = period.files.filter((f) => f.state === "missing");
  return (
    <div className={cn("space-y-1.5 rounded-md border p-2", period.hasDifference && "border-red-300 dark:border-red-900")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{period.title}</p>
        <span className="text-xs text-muted-foreground">
          Files: {period.files.filter((f) => f.state === "ok").length} of {period.files.filter((f) => f.state !== "optional").length}
          {missing.length > 0 && <span className="text-amber-700 dark:text-amber-400"> · missing {missing.map((f) => f.label).join(", ")}</span>}
        </span>
      </div>
      <Issues issues={period.issues} />
    </div>
  );
}

// GST working: when a period's sales, ITC or credit notes count as a swing
// (Admins and Partners, Compliance → Setup)
export function SwingSetting() {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    axios.get("/api/compliance/gst-working/settings").then(({ data }) => setValue(String(data.swingPercent))).catch(() => undefined);
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      await axios.put("/api/compliance/gst-working/settings", { swingPercent: Number(value) });
      toast.success("Saved");
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm">
      <span>GST working: flag sales, ITC or credit notes that move more than</span>
      <Input type="number" min={5} className="h-8 w-20" value={value} onChange={(e) => setValue(e.target.value)} />
      <span>% from the average of the last 3 periods</span>
      <Button size="sm" variant="outline" disabled={saving || !value} onClick={save}>Save</Button>
    </div>
  );
}
