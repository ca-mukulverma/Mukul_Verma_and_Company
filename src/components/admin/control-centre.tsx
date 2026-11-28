"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Loader2, Plus, Power, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiErrorMessage } from "@/components/billing/bill-types";
import { SupportTab, UpdatesTab } from "@/components/admin/control-centre-updates";
import { DownloadLinksTab } from "@/components/admin/control-centre-links";

// Admin → Control Centre (docs/CONTROL_CENTRE.md): the desktop software
// installed at clients (Gudakesa Desk …), the rules published to them and
// their daily reports.

interface Desk {
  id: string;
  code: string;
  name: string;
  clientId: string | null;
  keyHint: string;
  active: boolean;
  expectReports: boolean;
  lastReportDate: string | null;
  lastReportAt: string | null;
  lastSeen: string | null;
  appVersion: string | null;
  client: { companyName: string | null; contactPerson: string } | null;
  events: { at: string; kind: string; detail: string | null }[];
}
interface PortalClient {
  id: string;
  companyName: string | null;
  contactPerson: string;
}
interface Rule {
  id: number;
  key: string;
  value: unknown;
  effectiveFrom: string;
  label: string | null;
  unit: string | null;
  notes: string | null;
  clientCodes: string[];
  withdrawn: boolean;
  publishedBy: string;
  publishedAt: string;
}
interface OfficeChange {
  client: string;
  code: string;
  key: string;
  value: string;
  effective_from: string;
  notes: string | null;
  changed_by: string | null;
}
type Summary = Record<string, number | string[] | undefined>;
interface DayRow {
  id: string;
  code: string;
  name: string;
  expectReports: boolean;
  report: { id: string; receivedAt: string; summary: Summary; appVersion: string | null } | null;
}

const inr = (n: unknown) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–";
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "–";
const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

function KeyShown({ k, onClose }: { k: { name: string; key: string }; onClose: () => void }) {
  return (
    <Card className="border-amber-400">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Key for {k.name}: copy it now
        </CardTitle>
        <CardDescription>
          It is shown only this once. On the client&apos;s PC: Gudakesa Desk → Settings → MVC Control Centre → paste →
          Save &amp; test. Send it privately (not in a group).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-muted px-2 py-1 text-sm break-all">{k.key}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(k.key).then(() => toast.success("Key copied"))}
        >
          <Copy className="mr-1 h-4 w-4" /> Copy
        </Button>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ Clients
function ClientsTab() {
  const [desks, setDesks] = useState<Desk[] | null>(null);
  const [clients, setClients] = useState<PortalClient[]>([]);
  const [form, setForm] = useState({ code: "", name: "", clientId: "" });
  const [shownKey, setShownKey] = useState<{ name: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    axios
      .get<{ desks: Desk[]; clients: PortalClient[] }>("/api/admin/desk/clients")
      .then((r) => {
        setDesks(r.data.desks);
        setClients(r.data.clients);
      })
      .catch((e) => toast.error(apiErrorMessage(e, "Could not load")));
  }, []);
  useEffect(load, [load]);

  const add = async () => {
    setBusy(true);
    try {
      const r = await axios.post("/api/admin/desk/clients", form);
      setShownKey({ name: form.name, key: r.data.key });
      setForm({ code: "", name: "", clientId: "" });
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (d: Desk, data: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      const r = await axios.patch("/api/admin/desk/clients", { id: d.id, ...data });
      if (r.data.key) setShownKey({ name: d.name, key: r.data.key });
      else toast.success("Saved");
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };

  const lastWeekday = (() => {
    const t = new Date(`${todayIst()}T00:00:00Z`);
    do t.setUTCDate(t.getUTCDate() - 1);
    while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
    return t.toISOString().slice(0, 10);
  })();

  return (
    <div className="space-y-4">
      {shownKey && <KeyShown k={shownKey} onClose={() => setShownKey(null)} />}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clients using the desktop software</CardTitle>
          <CardDescription>
            Green = reported for the last working day. They contact this site on weekdays at 11:30, 1, 4 and 7 (report
            at 7).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {desks === null ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : desks.length === 0 ? (
            <p className="text-muted-foreground">No clients yet. Add the first one below.</p>
          ) : (
            desks.map((d) => {
              const ok = d.lastReportDate && d.lastReportDate.slice(0, 10) >= lastWeekday;
              return (
                <div key={d.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {!d.active ? (
                      <Power className="h-4 w-4 text-muted-foreground" />
                    ) : ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <span className="font-semibold">{d.name}</span>
                    <Badge variant="outline">{d.code}</Badge>
                    {!d.active && <Badge variant="secondary">Switched off</Badge>}
                    {d.appVersion && <Badge variant="outline">v{d.appVersion}</Badge>}
                  </div>
                  <div className="grid gap-1 text-muted-foreground sm:grid-cols-3">
                    <span>Last report: {day(d.lastReportDate)}</span>
                    <span>Last contact: {when(d.lastSeen)}</span>
                    <span>Key ends …{d.keyHint}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-8 rounded-md border bg-background px-2 text-sm"
                      value={d.clientId ?? ""}
                      onChange={(e) => patch(d, { clientId: e.target.value })}
                    >
                      <option value="">Not linked to a portal client</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.companyName || c.contactPerson}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" onClick={() => patch(d, { expectReports: !d.expectReports })}>
                      {d.expectReports ? "Stop missing-report alerts" : "Alert if report missing"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patch(d, { newKey: true }, `Make a new key for ${d.name}? The old key stops working at once.`)
                      }
                    >
                      <KeyRound className="mr-1 h-4 w-4" /> New key
                    </Button>
                    <Button
                      size="sm"
                      variant={d.active ? "destructive" : "default"}
                      onClick={() =>
                        patch(
                          d,
                          { active: !d.active },
                          d.active ? `Switch off ${d.name}? Its software can no longer pull rules or send reports.` : undefined
                        )
                      }
                    >
                      <Power className="mr-1 h-4 w-4" /> {d.active ? "Switch off" : "Switch on"}
                    </Button>
                  </div>
                  {d.events.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {d.events.map((ev, i) => (
                        <div key={i}>
                          {when(ev.at)} – {ev.detail ?? ev.kind}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" /> Add a client
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
          <div className="space-y-1">
            <Label>Code (short, capitals)</Label>
            <Input value={form.code} placeholder="GUDAKESA" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </div>
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={form.name} placeholder="Gudakesa Technologies Pvt Ltd" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Portal client (optional)</Label>
            <select
              className="h-9 w-full rounded-md border bg-background px-2"
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            >
              <option value="">–</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName || c.contactPerson}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <Button onClick={add} disabled={busy || !form.code || !form.name}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1 h-4 w-4" />} Add and
              make key
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Rules
function RulesTab() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [office, setOffice] = useState<OfficeChange[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [form, setForm] = useState({ key: "", value: "", effectiveFrom: todayIst(), label: "", unit: "", notes: "", clients: [] as string[] });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    axios
      .get<{ rules: Rule[]; officeChanges: OfficeChange[]; codes: string[] }>("/api/admin/desk/rules")
      .then((r) => {
        setRules(r.data.rules);
        setOffice(r.data.officeChanges);
        setCodes(r.data.codes);
      })
      .catch((e) => toast.error(apiErrorMessage(e, "Could not load")));
  }, []);
  useEffect(load, [load]);

  const publish = async () => {
    const to = form.clients.length ? form.clients.join(", ") : "ALL clients";
    if (!window.confirm(`Publish ${form.key} = ${form.value} from ${form.effectiveFrom} to ${to}?`)) return;
    setBusy(true);
    try {
      await axios.post("/api/admin/desk/rules", {
        key: form.key, value: form.value, effectiveFrom: form.effectiveFrom, label: form.label, unit: form.unit,
        notes: form.notes, clientCodes: form.clients,
      });
      toast.success("Published. Clients get it at their next contact.");
      setForm({ ...form, key: "", value: "", label: "", unit: "", notes: "", clients: [] });
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (r: Rule) => {
    if (!window.confirm(`${r.withdrawn ? "Bring back" : "Withdraw"} ${r.key} from ${day(r.effectiveFrom)}?`)) return;
    await axios.patch("/api/admin/desk/rules", { id: r.id, withdrawn: !r.withdrawn }).catch((e) => toast.error(apiErrorMessage(e)));
    load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4" /> Publish a rule change
          </CardTitle>
          <CardDescription>
            Use the same rule code as on the client&apos;s Rules screen (e.g. PF.WAGE_CEILING, GST.RATE.SERVICES,
            IT.NEW.SLABS). The new value applies from the date you give; older dates keep the old value.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
          <div className="space-y-1">
            <Label>Rule code</Label>
            <Input value={form.key} placeholder="PF.WAGE_CEILING" onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })} />
          </div>
          <div className="space-y-1">
            <Label>New value</Label>
            <Input value={form.value} placeholder="15000" onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Applies from</Label>
            <Input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>What it is (shown to staff)</Label>
            <Input value={form.label} placeholder="PF wage ceiling" onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Unit</Label>
            <Input value={form.unit} placeholder="Rs / month" onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Send to</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {codes.length === 0 && <span className="text-muted-foreground">All clients</span>}
              {codes.map((c) => (
                <label key={c} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.clients.includes(c)}
                    onChange={(e) =>
                      setForm({ ...form, clients: e.target.checked ? [...form.clients, c] : form.clients.filter((x) => x !== c) })
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">None ticked = all clients</p>
          </div>
          <div className="space-y-1 sm:col-span-3">
            <Label>Notes (notification, circular …)</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="sm:col-span-3">
            <Button onClick={publish} disabled={busy || !form.key || !form.value}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Publish
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Published</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rules === null ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : rules.length === 0 ? (
            <p className="text-muted-foreground">Nothing published yet. Clients use the rates built into their software.</p>
          ) : (
            rules.map((r) => (
              <div key={r.id} className={`flex flex-wrap items-center gap-2 rounded border p-2 ${r.withdrawn ? "opacity-50" : ""}`}>
                <Badge variant="outline">{r.key}</Badge>
                <span className="font-medium">{show(r.value)}</span>
                <span className="text-muted-foreground">{r.unit}</span>
                <span>from {day(r.effectiveFrom)}</span>
                <span className="text-muted-foreground">
                  → {r.clientCodes.length ? r.clientCodes.join(", ") : "all"} • {r.publishedBy}, {when(r.publishedAt)}
                </span>
                {r.withdrawn && <Badge variant="secondary">Withdrawn</Badge>}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => withdraw(r)}>
                  {r.withdrawn ? "Bring back" : "Withdraw"}
                </Button>
                {r.notes && <div className="w-full text-xs text-muted-foreground">{r.notes}</div>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Rates changed in a client&apos;s office
          </CardTitle>
          <CardDescription>From each client&apos;s latest daily report. Publish the correct value if needed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {office.length === 0 ? (
            <p className="text-muted-foreground">None.</p>
          ) : (
            office.map((o, i) => (
              <div key={i}>
                <b>{o.client}</b>: {o.key} = {o.value} from {o.effective_from} by {o.changed_by ?? "?"} – {o.notes}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Daily reports
function ReportsTab() {
  const [date, setDate] = useState("");
  const [data, setData] = useState<{ date: string; rows: DayRow[]; totals: Record<string, number> } | null>(null);
  const [open, setOpen] = useState<{ name: string; payload: Record<string, unknown> } | null>(null);

  const load = useCallback((d: string) => {
    axios
      .get(`/api/admin/desk/reports${d ? `?date=${d}` : ""}`)
      .then((r) => {
        setData(r.data);
        setDate(r.data.date);
      })
      .catch((e) => toast.error(apiErrorMessage(e, "Could not load")));
  }, []);
  useEffect(() => load(""), [load]);

  const view = async (row: DayRow) => {
    if (!row.report) return;
    const r = await axios.get(`/api/admin/desk/reports?id=${row.report.id}`).catch((e) => {
      toast.error(apiErrorMessage(e));
      return null;
    });
    if (r) setOpen({ name: row.name, payload: r.data.report.payload });
  };

  const t = data?.totals ?? {};
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <Label>Day</Label>
        <Input type="date" className="w-44" value={date} onChange={(e) => load(e.target.value)} />
      </div>
      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All clients – {day(data.date)}</CardTitle>
            <CardDescription>
              {t.reported} reported, {t.missing} missing • {t.bills} bills (₹ {inr(t.billsTotal)}) • {t.bankLines} bank
              entries • {t.purchases} purchases • {t.payrollPosted} salary journals • {t.errors} errors • {t.pending}{" "}
              pending items
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">Client</th>
                  <th>Bills</th>
                  <th>Billed ₹</th>
                  <th>Bank</th>
                  <th>Purchases</th>
                  <th>Salary</th>
                  <th>Errors</th>
                  <th>Pending</th>
                  <th>Who</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const s = r.report?.summary ?? {};
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="py-1.5">
                        {r.report ? (
                          <CheckCircle2 className="mr-1 inline h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="mr-1 inline h-4 w-4 text-red-600" />
                        )}
                        {r.name}
                      </td>
                      {r.report ? (
                        <>
                          <td>{String(s.bills ?? 0)}</td>
                          <td>{inr(s.billsTotal)}</td>
                          <td>{String(s.bankLines ?? 0)}</td>
                          <td>{String(s.purchases ?? 0)}</td>
                          <td>{String(s.payrollPosted ?? 0)}</td>
                          <td className={Number(s.errors) ? "font-semibold text-red-600" : ""}>{String(s.errors ?? 0)}</td>
                          <td className={Number(s.pending) ? "text-amber-600" : ""}>{String(s.pending ?? 0)}</td>
                          <td className="text-muted-foreground">{(s.users as string[] | undefined)?.join(", ")}</td>
                          <td>
                            <Button size="sm" variant="outline" onClick={() => view(r)}>
                              Open
                            </Button>
                          </td>
                        </>
                      ) : (
                        <td colSpan={9} className="text-red-600">
                          {r.expectReports ? "No report" : "No report (alerts off)"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {open && <ReportDetail name={open.name} payload={open.payload} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReportDetail({ name, payload, onClose }: { name: string; payload: Record<string, unknown>; onClose: () => void }) {
  const p = payload as {
    bills?: { number: string; customer: string; total: number; posted_by: string }[];
    bank?: { date: string; debit: number; credit: number; ledger: string; vch_type: string; split: boolean; posted_by: string }[];
    purchases?: { vendor: string; inv_no: string; inr_amount: number }[];
    payroll?: { month: string; n: number; gross: number; net: number }[];
    errors?: { at: string; user: string; action: string; detail: string }[];
    pending?: Record<string, number | string[]>;
    who?: Record<string, Record<string, number>>;
  };
  const words: Record<string, string> = {
    orders_ready: "Orders ready to post", resource_days_ready: "Resource bills ready", orders_draft: "Orders in draft",
    bank_lines_to_do: "Bank lines to do", bank_splits_not_balanced: "Bank splits not balanced",
    purchases_draft: "Purchases not posted", payroll_months_draft: "Salary months not posted",
    invoices_not_shared: "Invoices not sent on WhatsApp",
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{name}</CardTitle>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm md:grid-cols-2">
        <section>
          <h4 className="font-semibold">Bills posted</h4>
          {(p.bills ?? []).map((b) => (
            <div key={b.number}>
              {b.number} – {b.customer} – ₹ {inr(b.total)} ({b.posted_by})
            </div>
          ))}
          {!p.bills?.length && <div className="text-muted-foreground">None</div>}
        </section>
        <section>
          <h4 className="font-semibold">Bank entries posted</h4>
          {(p.bank ?? []).map((b, i) => (
            <div key={i}>
              {b.date} {b.credit ? `IN ₹ ${inr(b.credit)}` : `OUT ₹ ${inr(b.debit)}`} – {b.ledger}
              {b.split ? " (split)" : ""}
            </div>
          ))}
          {!p.bank?.length && <div className="text-muted-foreground">None</div>}
        </section>
        <section>
          <h4 className="font-semibold">Purchases and salary</h4>
          {(p.purchases ?? []).map((x) => (
            <div key={x.inv_no}>
              {x.vendor} {x.inv_no} – ₹ {inr(x.inr_amount)}
            </div>
          ))}
          {(p.payroll ?? []).map((x) => (
            <div key={x.month}>
              Salary {x.month}: {x.n} people, gross ₹ {inr(x.gross)}, net ₹ {inr(x.net)}
            </div>
          ))}
          {!p.purchases?.length && !p.payroll?.length && <div className="text-muted-foreground">None</div>}
        </section>
        <section>
          <h4 className="font-semibold">Pending</h4>
          {Object.entries(p.pending ?? {}).map(([k, v]) => {
            const n = Array.isArray(v) ? v.length : v;
            return n ? (
              <div key={k} className="text-amber-700">
                {words[k] ?? k}: {Array.isArray(v) ? v.join(", ") : v}
              </div>
            ) : null;
          })}
        </section>
        <section className="md:col-span-2">
          <h4 className="font-semibold">Errors</h4>
          {(p.errors ?? []).map((e, i) => (
            <div key={i} className="text-red-600">
              {e.at} {e.user}: {e.detail}
            </div>
          ))}
          {!p.errors?.length && <div className="text-muted-foreground">None</div>}
        </section>
        <section className="md:col-span-2">
          <h4 className="font-semibold">Who did what</h4>
          {Object.entries(p.who ?? {}).map(([u, acts]) => (
            <div key={u}>
              <b>{u}</b>:{" "}
              {Object.entries(acts)
                .map(([a, n]) => `${a} ×${n}`)
                .join(", ")}
            </div>
          ))}
        </section>
      </CardContent>
    </Card>
  );
}

export function ControlCentre() {
  return (
    <Tabs defaultValue="reports" className="space-y-4">
      <TabsList data-showme="control-centre-tabs">
        <TabsTrigger value="reports">Daily reports</TabsTrigger>
        <TabsTrigger value="rules">Rules</TabsTrigger>
        <TabsTrigger value="clients">Clients</TabsTrigger>
        <TabsTrigger value="updates">Updates</TabsTrigger>
        <TabsTrigger value="links">Download links</TabsTrigger>
        <TabsTrigger value="support">Support files</TabsTrigger>
      </TabsList>
      <TabsContent value="reports">
        <ReportsTab />
      </TabsContent>
      <TabsContent value="rules">
        <RulesTab />
      </TabsContent>
      <TabsContent value="clients">
        <ClientsTab />
      </TabsContent>
      <TabsContent value="updates">
        <UpdatesTab />
      </TabsContent>
      <TabsContent value="links">
        <DownloadLinksTab />
      </TabsContent>
      <TabsContent value="support">
        <SupportTab />
      </TabsContent>
    </Tabs>
  );
}
