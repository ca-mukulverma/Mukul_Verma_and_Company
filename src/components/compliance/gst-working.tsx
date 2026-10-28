"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Download, FileSearch, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
type Measure = "taxable" | "igst" | "cgst" | "sgst" | "cess" | "tax" | "value";

const MEASURES: { key: Measure; label: string }[] = [
  { key: "taxable", label: "Taxable value" },
  { key: "igst", label: "IGST" },
  { key: "cgst", label: "CGST" },
  { key: "sgst", label: "SGST" },
  { key: "cess", label: "Cess" },
  { key: "tax", label: "Total tax" },
  { key: "value", label: "Total value" },
];

const measure = (h: Heads, key: Measure) => (key === "tax" ? totalTax(h) : key === "value" ? h.taxable + totalTax(h) : h[key]);
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

function FySelect({ fy, setFy }: { fy: number; setFy: (fy: number) => void }) {
  const current = fyOf(currentMonthKey());
  return (
    <Select value={String(fy)} onValueChange={(v) => setFy(Number(v))}>
      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
      <SelectContent>
        {[0, 1, 2, 3, 4].map((i) => <SelectItem key={i} value={String(current - i)}>{fyLabel(current - i)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ─── One client's year ──────────────────────────────────────────────────────

export function ClientGstWorking({ clientId, email, refresh }: { clientId: string; email: string | null; refresh: number }) {
  const [fy, setFy] = useState(fyOf(previousMonth()));
  const [data, setData] = useState<ClientWorking | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState<Measure>("taxable");
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
        setTo((t) => t || working.data.client.email || "");
        setUnread(docs.data.docs);
      })
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, [clientId, fy]);
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

  const measures = MEASURES.filter((m) => m.key !== "cess" || data?.hasCess);
  const rows = WORKING_ROWS.filter((r) => !("key" in r) || !r.optional || data?.periods.some((p) => p.rows[r.key] && measure(p.rows[r.key]!, "value") !== 0));
  const exportUrl = (format: string) => `/api/compliance/gst-working/export?${new URLSearchParams({ clientId, fy: String(fy), format })}`;
  const attention = data?.periods.filter((p) => p.issues.length > 0) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FySelect fy={fy} setFy={setFy} />
        <span className="text-xs text-muted-foreground">Show</span>
        <Select value={show} onValueChange={(v) => setShow(v as Measure)}>
          <SelectTrigger className="h-9 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {measures.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
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

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted p-2 text-left">SALES WORKING</th>
                  <th className="whitespace-nowrap p-2 text-right">TOTAL</th>
                  {data.periods.map((p) => (
                    <th key={p.start} className="whitespace-nowrap p-2 text-right">
                      {p.title.replace(/ \d{4}-\d{2}$/, "")}
                      {p.hasDifference && <AlertTriangle className="ml-1 inline h-3 w-3 text-red-600" />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((def, n) =>
                  "heading" in def ? (
                    <tr key={`h${n}`} className="border-t bg-muted/40">
                      <td className="sticky left-0 bg-muted p-1.5 font-semibold underline" colSpan={1}>{def.heading}</td>
                      <td colSpan={data.periods.length + 1} />
                    </tr>
                  ) : (
                    <tr key={def.key} className={cn("border-t", (def.key.endsWith("_net") || def.key === "net_after_1a") && "font-semibold")}>
                      <td className={cn("sticky left-0 z-10 bg-background p-1.5", def.difference && "font-semibold")}>{def.label}</td>
                      <Cell value={data.total[def.key as RowKey]} show={show} difference={def.difference} />
                      {data.periods.map((p) => <Cell key={p.start} value={p.rows[def.key as RowKey]} show={show} difference={def.difference} />)}
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Every figure is read from the files uploaded for the period (GSTR-1/IFF JSON and PDF, GSTR-1A PDF, GSTR-3B PDF, GSTR-2B JSON); to correct one, upload the corrected file. The Excel and PDF have every column.
          </p>

          {attention.length > 0 ? (
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

function Cell({ value, show, difference }: { value: Heads | undefined; show: Measure; difference?: boolean }) {
  if (!value) return <td className="p-1.5 text-right text-muted-foreground">–</td>;
  const v = measure(value, show);
  const bad = difference && Math.abs(v) >= 1;
  return (
    <td className={cn("whitespace-nowrap p-1.5 text-right tabular-nums", bad && "font-semibold text-red-600", difference && !bad && "text-emerald-700 dark:text-emerald-400")}>
      {difference && !bad ? "✓" : amount(v)}
    </td>
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
