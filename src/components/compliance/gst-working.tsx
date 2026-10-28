"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileSearch, Loader2, Mail, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Heads, totalTax } from "@/lib/gst-read/types";
import { FileCheck, Issue, RowKey, WORKING_ROWS } from "@/lib/gst-read/working";
import type { ClientWorking } from "@/lib/gst-working";
import type { WorkType } from "./setup";
import { ReturnUpload } from "./return-upload";
import { apiError, currentMonthKey, longDate } from "./types";

// GST working (see docs/GST_WORKING.md): every figure comes from the return
// files uploaded for the period. Upload for all clients, see what needs
// attention this month and which files are missing, then each client's year
// in the firm's format, signed off period by period and sent as Excel/PDF.

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

function Section({ title, open, onToggle, children, action }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="flex items-center gap-1 text-sm font-semibold" onClick={onToggle}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} {title}
        </button>
        {open && action}
      </div>
      {open && children}
    </section>
  );
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

export function GstWorking({ workTypes, isManager }: { workTypes: WorkType[]; isManager: boolean }) {
  const [open, setOpen] = useState({ upload: false, exceptions: true, files: false, working: true });
  const toggle = (key: keyof typeof open) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const [clientId, setClientId] = useState("");
  const [fy, setFy] = useState(fyOf(previousMonth()));
  const [refresh, setRefresh] = useState(0);
  const workingRef = useRef<HTMLDivElement>(null);

  const openClient = (id: string, year: number) => {
    setClientId(id);
    setFy(year);
    setOpen((o) => ({ ...o, working: true }));
    setTimeout(() => workingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Every figure is read from the return files uploaded for the period (GSTR-1/IFF JSON and PDF, GSTR-1A PDF, GSTR-3B PDF, GSTR-2B JSON); nothing is typed in. To correct a figure, upload the corrected file.
      </p>
      <Section title="Upload returns for all clients" open={open.upload} onToggle={() => toggle("upload")}>
        <ReturnUpload client={null} workTypes={workTypes} onChanged={() => setRefresh((r) => r + 1)} />
      </Section>
      <Section title="Needs attention this month" open={open.exceptions} onToggle={() => toggle("exceptions")}>
        <Exceptions refresh={refresh} onOpen={openClient} />
      </Section>
      <Section title="Files uploaded" open={open.files} onToggle={() => toggle("files")}>
        <Completeness refresh={refresh} onOpen={openClient} />
      </Section>
      <div ref={workingRef}>
        <Section title="Client's GST working" open={open.working} onToggle={() => toggle("working")}>
          <ClientWorkingView
            workTypes={workTypes}
            clientId={clientId}
            setClientId={setClientId}
            fy={fy}
            setFy={setFy}
            refresh={refresh}
            onChanged={() => setRefresh((r) => r + 1)}
          />
        </Section>
      </div>
      {isManager && <SwingSetting />}
    </div>
  );
}

// ─── Every client's period ending in a month ────────────────────────────────

interface ExceptionRow {
  clientId: string;
  client: string;
  gstin: string | null;
  period: string;
  start: string;
  magnitude: number;
  hasDifference: boolean;
  issues: Issue[];
  checked: boolean;
}

function Exceptions({ refresh, onOpen }: { refresh: number; onOpen: (clientId: string, fy: number) => void }) {
  const [month, setMonth] = useState(previousMonth());
  const [rows, setRows] = useState<ExceptionRow[] | null>(null);
  const [show, setShow] = useState<"all" | "difference" | "missing">("all");

  useEffect(() => {
    setRows(null);
    axios
      .get("/api/compliance/gst-working", { params: { month } })
      .then(({ data }) => setRows(data.rows))
      .catch((e) => toast.error(apiError(e)));
  }, [month, refresh]);

  const shown = (rows ?? []).filter((r) => show === "all" || (show === "difference" ? r.hasDifference : r.issues.some((i) => i.severity === "missing")));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Returns for the period ending in</p>
          <Input type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <Select value={show} onValueChange={(v) => setShow(v as typeof show)}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everything that needs attention</SelectItem>
            <SelectItem value="difference">Only differences</SelectItem>
            <SelectItem value="missing">Only missing files</SelectItem>
          </SelectContent>
        </Select>
        {rows && (
          <span className="text-xs text-muted-foreground">
            {rows.filter((r) => r.hasDifference).length} with differences · {rows.filter((r) => r.issues.some((i) => i.severity === "missing")).length} with missing files
          </span>
        )}
      </div>
      {rows === null ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs attention for this month.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((r) => (
            <li key={r.clientId} className={cn("rounded-md border p-2", r.hasDifference && "border-red-300 dark:border-red-900")}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button className="font-medium hover:underline" onClick={() => onOpen(r.clientId, fyOf(r.start))}>{r.client}</button>
                <span className="text-xs text-muted-foreground">{r.period}{r.gstin ? ` · ${r.gstin}` : ""}</span>
                {r.checked && <span className="rounded border border-emerald-300 px-1.5 text-xs text-emerald-700 dark:text-emerald-400">Checked</span>}
              </div>
              <Issues issues={r.issues} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Files uploaded per client and period ───────────────────────────────────

interface CompletenessRow {
  clientId: string;
  client: string;
  gstin: string | null;
  periods: { start: string; title: string; files: FileCheck[]; hasDifference: boolean }[];
}

function Completeness({ refresh, onOpen }: { refresh: number; onOpen: (clientId: string, fy: number) => void }) {
  const [fy, setFy] = useState(fyOf(previousMonth()));
  const [rows, setRows] = useState<CompletenessRow[] | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(true);

  useEffect(() => {
    setRows(null);
    axios
      .get("/api/compliance/gst-working", { params: { files: fy } })
      .then(({ data }) => setRows(data.clients))
      .catch((e) => toast.error(apiError(e)));
  }, [fy, refresh]);

  const missingOf = (p: CompletenessRow["periods"][number]) => p.files.filter((f) => f.state === "missing");
  const shown = (rows ?? []).filter((r) => !onlyMissing || r.periods.some((p) => missingOf(p).length > 0));
  const months = [...new Set((rows ?? []).flatMap((r) => r.periods.map((p) => p.start)))].sort();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <FySelect fy={fy} setFy={setFy} />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyMissing} onCheckedChange={(c) => setOnlyMissing(c === true)} /> Only clients with missing files
        </label>
      </div>
      {rows === null ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{rows.length ? "Every file is uploaded." : "No clients with GST work."}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-2">Client</th>
                {months.map((m) => (
                  <th key={m} className="whitespace-nowrap p-2">{new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" })}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.clientId} className="border-t align-top">
                  <td className="p-2">
                    <button className="font-medium hover:underline" onClick={() => onOpen(r.clientId, fy)}>{r.client}</button>
                  </td>
                  {months.map((m) => {
                    const p = r.periods.find((x) => x.start === m);
                    if (!p) return <td key={m} className="p-2" />;
                    const missing = missingOf(p);
                    return (
                      <td key={m} className="p-2" title={p.files.map((f) => `${f.label}: ${f.state === "ok" ? "uploaded" : f.state}`).join("\n")}>
                        {missing.length === 0 ? (
                          <span className="text-emerald-700 dark:text-emerald-400">✓{p.hasDifference ? <AlertTriangle className="ml-1 inline h-3 w-3 text-red-600" /> : null}</span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">{missing.map((f) => f.label.replace(" PDF", "").replace("GSTR-", "")).join(", ")}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Each cell lists the files still to upload (a quarterly filer&apos;s cell is under the quarter&apos;s first month). ✓ all uploaded; a red mark means the figures differ.</p>
    </div>
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

function ClientWorkingView({
  workTypes,
  clientId,
  setClientId,
  fy,
  setFy,
  refresh,
  onChanged,
}: {
  workTypes: WorkType[];
  clientId: string;
  setClientId: (id: string) => void;
  fy: number;
  setFy: (fy: number) => void;
  refresh: number;
  onChanged: () => void;
}) {
  const [clients, setClients] = useState<{ id: string; name: string; gstin: string | null }[]>([]);
  const [data, setData] = useState<ClientWorking | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState<Measure>("taxable");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState<{ id: string; fileName: string }[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const gstWorks = new Set(workTypes.filter((w) => w.kind === "GSTR1" || w.kind === "GSTR3B").map((w) => w.id));
    axios
      .get("/api/compliance/clients")
      .then(({ data }) => setClients(data.clients.filter((c: { works: { workTypeId: string }[] }) => c.works.some((w) => gstWorks.has(w.workTypeId)))))
      .catch(() => undefined);
  }, [workTypes]);

  const load = useCallback(() => {
    if (!clientId) return;
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
  useEffect(() => setTo(""), [clientId]);

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
    onChanged();
  };

  const email = async () => {
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Client</p>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Choose a client" /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Financial year</p>
          <FySelect fy={fy} setFy={setFy} />
        </div>
        {clientId && (
          <>
            <Button asChild size="sm" variant="outline">
              <a href={exportUrl("xlsx")}><Download className="mr-1 h-4 w-4" /> Excel</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={exportUrl("pdf")}><Download className="mr-1 h-4 w-4" /> PDF</a>
            </Button>
          </>
        )}
      </div>

      {!clientId ? (
        <p className="text-sm text-muted-foreground">Choose a client to see their year, or click a client above.</p>
      ) : loading && !data ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : data ? (
        <>
          {unread.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <FileSearch className="h-4 w-4" />
              {reading ?? `${unread.length} return file(s) were uploaded before figures were read from files.`}
              {!reading && <Button size="sm" variant="outline" onClick={readEarlier}>Read their figures</Button>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Show</span>
            <Select value={show} onValueChange={(v) => setShow(v as Measure)}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {measures.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">The Excel and PDF have every column (taxable value, IGST, CGST, SGST{data.hasCess ? ", cess" : ""}, total tax, total value).</span>
          </div>

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
                      {p.check && !p.check.outdated && <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-600" />}
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

          <div className="grid gap-2 lg:grid-cols-2">
            {data.periods.filter((p) => p.over || p.files.some((f) => f.state === "ok")).map((p) => (
              <PeriodCard key={p.start} clientId={clientId} period={p} onChanged={() => setVersion((v) => v + 1)} />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <Input className="min-w-64 flex-1" placeholder="Client email (several: separate with commas)" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button size="sm" disabled={sending || !to.trim()} onClick={email}>
              {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Mail className="mr-1 h-4 w-4" />} Email the working (Excel and PDF)
            </Button>
          </div>
        </>
      ) : null}
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

function PeriodCard({ clientId, period, onChanged }: { clientId: string; period: Period; onChanged: () => void }) {
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const missing = period.files.filter((f) => f.state === "missing");

  const sign = async () => {
    setBusy(true);
    try {
      await axios.post("/api/compliance/gst-working/check", { clientId, start: period.start, remark: remark.trim() || null });
      toast.success(`${period.title} checked`);
      setRemark("");
      onChanged();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    setBusy(true);
    try {
      await axios.delete("/api/compliance/gst-working/check", { params: { clientId, start: period.start } });
      onChanged();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("space-y-1.5 rounded-md border p-2", period.hasDifference && "border-red-300 dark:border-red-900")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{period.title}</p>
        <span className="text-xs text-muted-foreground">
          Files: {period.files.filter((f) => f.state === "ok").length} of {period.files.filter((f) => f.state !== "optional").length}
          {missing.length > 0 && <span className="text-amber-700 dark:text-amber-400"> · missing {missing.map((f) => f.label).join(", ")}</span>}
        </span>
      </div>
      {period.issues.length ? <Issues issues={period.issues} /> : <p className="text-xs text-emerald-700 dark:text-emerald-400">Everything ties.</p>}
      {period.check ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn(period.check.outdated ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
            {period.check.outdated ? "Checked before the figures changed: check again." : "Checked"} by {period.check.by} on {longDate(period.check.at.slice(0, 10))}
            {period.check.remark ? ` – ${period.check.remark}` : ""}
          </span>
          {period.check.outdated && (
            <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={sign}>Check again</Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={undo}><Undo2 className="mr-1 h-3 w-3" /> Undo</Button>
        </div>
      ) : period.over ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 min-w-48 flex-1 text-xs"
            placeholder={period.hasDifference ? "Why the difference is fine (needed)" : "Remark (optional)"}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          <Button size="sm" className="h-8" disabled={busy || (period.hasDifference && remark.trim().length < 5)} onClick={sign}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />} Mark checked
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SwingSetting() {
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
      <span>Flag sales, ITC or credit notes that move more than</span>
      <Input type="number" min={5} className="h-8 w-20" value={value} onChange={(e) => setValue(e.target.value)} />
      <span>% from the average of the last 3 periods</span>
      <Button size="sm" variant="outline" disabled={saving || !value} onClick={save}>Save</Button>
      <span className="text-xs text-muted-foreground">(Admins and Partners)</span>
    </div>
  );
}
