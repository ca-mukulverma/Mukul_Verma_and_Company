"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Download, FileUp, History, Loader2, Lock, Mail, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  apiError,
  ClientCell,
  DOC_KIND_LABELS,
  FIGURE_FIELDS,
  formatBytes,
  GSTR1A_FIGURES,
  longDate,
  rupees,
  runItemAction,
  SheetItem,
  STATUS_LABELS,
  statusClasses,
  TDS_SECTIONS,
  todayKey,
} from "./types";
import { uploadComplianceFile } from "./upload";

interface Props {
  item: SheetItem;
  client: ClientCell;
  isManager: boolean;
  onClose: () => void;
  onChange: (item: SheetItem) => void;
}

interface Details {
  events: { id: string; action: string; remark: string | null; createdAt: string; user: { name: string } | null }[];
  reminders: { id: string; channel: string; sentTo: string; ok: boolean; error: string | null; sentAt: string; sentBy: { name: string } | null }[];
  fee?: number | null;
}

const EVENT_LABELS: Record<string, string> = {
  data_received: "Data received",
  data_received_undone: "Data received undone",
  filed: "Filed",
  filing_updated: "Filing details changed",
  filing_undone: "Filing undone",
  completed: "Completed",
  sent_to_billing: "Sent to billing",
  reopened: "Reopened",
  tax_payable: "Tax payable",
  figures_updated: "Figures changed",
  gstr1a_filed: "GSTR-1A filed",
  gstr1a_removed: "GSTR-1A removed",
  line_confirmed: "Line confirmed",
  line_skipped: "Line skipped",
  line_pending: "Line set back",
  challan_added: "Challan added",
  challan_removed: "Challan removed",
  tds_paid: "TDS month closed",
  no_tds: "No TDS this month",
  not_required: "Not required",
  certificates_requested: "Form 16/16A requested",
  certificates_request_undone: "Form 16/16A request undone",
  certificates_emailed: "Form 16/16A emailed",
  documents_emailed: "Files emailed",
  document_added: "File added",
  document_removed: "File removed",
  fee_set: "Fee set",
  past_period_entered: "Past period entered",
};

const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2 rounded-md border p-3", className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function ItemDialog({ item, client, isManager, onClose, onChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`/api/compliance/items/${item.id}`)
      .then(({ data }) => !cancelled && setDetails(data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.id, item.updatedAt]);

  const run = async (key: string, body: Record<string, unknown>, success?: string) => {
    setBusy(key);
    try {
      const updated = await runItemAction(item.id, body);
      onChange(updated);
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error(apiError(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const locked = !!item.lockReason;
  const readOnly = !item.canEdit;
  const open = item.status === "pending" || item.status === "data_received";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {item.workTypeName} · {item.period}
            <span className={cn("rounded border px-2 py-0.5 text-xs font-medium", statusClasses(item))}>
              {STATUS_LABELS[item.status]}
            </span>
            {item.historical && <span className="rounded border px-2 py-0.5 text-xs">Past period</span>}
          </DialogTitle>
          <DialogDescription>
            {client.name}
            {client.gstin ? ` · ${client.gstin}` : ""} · Due {longDate(item.dueDate)}
            {item.updatedBy ? ` · Last updated by ${item.updatedBy}` : ""}
          </DialogDescription>
        </DialogHeader>

        {readOnly && (
          <p className="rounded-md bg-muted p-2 text-sm">You can see this work, but only its team, Admins and Partners can change it.</p>
        )}
        {locked && open && (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" /> Can&apos;t be filed yet: {item.lockReason}
          </p>
        )}
        {item.status === "filed" && item.missing.length > 0 && (
          <p className="rounded-md border border-sky-300 bg-sky-50 p-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            Filed. It will be completed{item.kind !== "GSTR1" ? " (and sent to billing, if billable)" : ""} once these are done: {item.missing.join(", ")}.
          </p>
        )}

        <div className="space-y-3">
          {item.kind !== "TDS_PAYMENT" && <DataReceived item={item} disabled={readOnly} onChange={onChange} />}

          {(item.kind === "GSTR3B" || item.kind === "TDS_PAYMENT" || item.kind === "GENERIC") && open && (
            <TaxPayable item={item} disabled={readOnly} busy={busy} run={run} />
          )}

          {item.lines.length > 0 && (
            <Lines item={item} disabled={readOnly || item.status === "completed"} busy={busy} run={run} />
          )}

          {item.kind === "TDS_PAYMENT" ? (
            <TdsPayment item={item} disabled={readOnly} busy={busy} run={run} onChange={onChange} />
          ) : (
            <Filing item={item} disabled={readOnly || (locked && open)} busy={busy} run={run} />
          )}

          {item.kind === "GSTR1" && (item.status === "filed" || item.status === "completed") && (
            <Gstr1A item={item} client={client} disabled={readOnly} busy={busy} run={run} onChange={onChange} />
          )}

          {item.needsCertificates && (item.status === "filed" || item.status === "completed") && (
            <Certificates item={item} client={client} disabled={readOnly} busy={busy} run={run} onChange={onChange} />
          )}

          <Files item={item} client={client} disabled={readOnly} onChange={onChange} />

          {item.status === "completed" && item.kind !== "TDS_PAYMENT" && !readOnly && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <span>
                Completed{item.billStatus ? ` · bill ${item.billStatus === "draft" ? "waiting for the billing manager" : "in billing"}` : ""}.
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null || (!!item.billStatus && item.billStatus !== "draft")}
                onClick={() => run("reopen", { action: "reopen" }, "Reopened")}
              >
                <Undo2 className="mr-1 h-4 w-4" /> Reopen
              </Button>
            </div>
          )}

          {isManager && details && "fee" in details && item.kind !== "TDS_PAYMENT" && item.kind !== "GSTR1" && (
            <Fee item={item} fee={details.fee ?? null} busy={busy} run={run} />
          )}

          <div>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory((s) => !s)}>
              <History className="mr-1 h-4 w-4" /> {showHistory ? "Hide history" : "History and reminders"}
            </Button>
            {showHistory && details && (
              <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="mb-1 font-semibold">History</p>
                  <ul className="space-y-1">
                    {details.events.map((e) => (
                      <li key={e.id}>
                        {new Date(e.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                        {EVENT_LABELS[e.action] ?? e.action}
                        {e.remark ? ` (${e.remark})` : ""}
                        {e.user ? ` · ${e.user.name}` : ""}
                      </li>
                    ))}
                    {details.events.length === 0 && <li className="text-muted-foreground">Nothing yet</li>}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-semibold">Reminders</p>
                  <ul className="space-y-1">
                    {details.reminders.map((r) => (
                      <li key={r.id}>
                        {new Date(r.sentAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                        {r.channel === "WHATSAPP" ? "WhatsApp" : "Email"} to {r.sentTo}
                        {r.ok ? "" : ` – failed: ${r.error}`}
                        {r.sentBy ? ` · ${r.sentBy.name}` : ""}
                      </li>
                    ))}
                    {details.reminders.length === 0 && <li className="text-muted-foreground">None sent</li>}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Run = (key: string, body: Record<string, unknown>, success?: string) => Promise<boolean>;

function DataReceived({ item, disabled, onChange }: { item: SheetItem; disabled: boolean; onChange: (i: SheetItem) => void }) {
  const [saving, setSaving] = useState(false);
  const received = !!item.dataReceivedAt;
  const toggle = async () => {
    setSaving(true);
    try {
      const { data } = await axios.post("/api/compliance/items/bulk", {
        itemIds: [item.id],
        action: received ? "undo_data_received" : "data_received",
      });
      if (data.items[0]) onChange(data.items[0]);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
      <Checkbox checked={received} disabled={disabled || saving} onCheckedChange={toggle} />
      Data received from the client
      {item.dataReceivedAt && <span className="text-muted-foreground">on {longDate(item.dataReceivedAt)}</span>}
      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
    </label>
  );
}

function TaxPayable({ item, disabled, busy, run }: { item: SheetItem; disabled: boolean; busy: string | null; run: Run }) {
  const [value, setValue] = useState(item.taxPayable !== null ? String(item.taxPayable) : "");
  const changed = numberOrNull(value) !== item.taxPayable;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
      <div className="space-y-1">
        <Label htmlFor="tax-payable">Tax payable (used in the reminder message)</Label>
        <Input id="tax-payable" type="number" min={0} className="w-48" value={value} disabled={disabled} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Button size="sm" variant="outline" disabled={disabled || !changed || busy !== null} onClick={() => run("tax", { action: "tax_payable", amount: numberOrNull(value) }, "Saved")}>
        {busy === "tax" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
      </Button>
    </div>
  );
}

function Lines({ item, disabled, busy, run }: { item: SheetItem; disabled: boolean; busy: string | null; run: Run }) {
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(item.lines.map((l) => [l.id, l.taxAmount !== null ? String(l.taxAmount) : ""]))
  );
  const title = item.kind === "GSTR3B" ? "RCM to pay this period" : "TDS to deduct and pay this month";
  return (
    <Section title={title}>
      <p className="text-xs text-muted-foreground">Confirm each line with the amount, or skip it with a reason. The period can&apos;t be closed while a line is open.</p>
      <ul className="space-y-2">
        {item.lines.map((line) => (
          <li key={line.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-48 flex-1">
              {line.label} <span className="text-muted-foreground">@ {line.ratePercent}%</span>
              {line.fixed && line.baseAmount !== null && <span className="text-muted-foreground"> on {rupees(line.baseAmount)}</span>}
            </span>
            {line.status === "pending" ? (
              <>
                <Input
                  type="number"
                  min={0}
                  placeholder="Tax amount"
                  className="w-32"
                  value={amounts[line.id] ?? ""}
                  disabled={disabled}
                  onChange={(e) => setAmounts((a) => ({ ...a, [line.id]: e.target.value }))}
                />
                <Button
                  size="sm"
                  disabled={disabled || busy !== null || numberOrNull(amounts[line.id] ?? "") === null}
                  onClick={() => run(`line-${line.id}`, { action: "line", lineId: line.id, status: "confirmed", taxAmount: numberOrNull(amounts[line.id] ?? "") })}
                >
                  <Check className="mr-1 h-4 w-4" /> Confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || busy !== null}
                  onClick={() => {
                    const note = window.prompt("Why is it skipped this time? (e.g. rent not paid this month)");
                    if (note !== null) run(`line-${line.id}`, { action: "line", lineId: line.id, status: "skipped", note });
                  }}
                >
                  Skip
                </Button>
              </>
            ) : (
              <>
                <span className={line.status === "confirmed" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                  {line.status === "confirmed" ? `✓ ${rupees(line.taxAmount)}` : `Skipped${line.note ? `: ${line.note}` : ""}`}
                </span>
                {!disabled && (
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run(`line-${line.id}`, { action: "line", lineId: line.id, status: "pending" })}>
                    <Undo2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function FigureInputs({
  fields,
  values,
  setValues,
  disabled,
}: {
  fields: { key: string; label: string }[];
  values: Record<string, string>;
  setValues: (fn: (v: Record<string, string>) => Record<string, string>) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label className="text-xs">{f.label}</Label>
          <Input type="number" value={values[f.key] ?? ""} disabled={disabled} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
        </div>
      ))}
    </div>
  );
}

function figuresPayload(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]));
}

function Filing({ item, disabled, busy, run }: { item: SheetItem; disabled: boolean; busy: string | null; run: Run }) {
  const fields = FIGURE_FIELDS[item.kind] ?? [];
  const [filedAt, setFiledAt] = useState(item.filedAt ?? todayKey());
  const [arn, setArn] = useState(item.arn ?? "");
  const [isNil, setIsNil] = useState(item.isNil === true);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, item.figures[f.key] !== undefined ? String(item.figures[f.key]) : ""]))
  );
  const filed = item.status === "filed" || item.status === "completed";
  const closed = item.status === "completed" || item.status === "not_required";
  const arnLabel = item.kind === "TDS_RETURN" ? "Token / RRR number" : "ARN / acknowledgement number";

  if (item.status === "not_required") {
    return <Section title="Filing"><p className="text-sm">Not required for this period (no challans in the quarter).</p></Section>;
  }

  return (
    <Section title={filed ? "Filing details" : "Mark as filed"}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Filing date</Label>
          <Input type="date" max={todayKey()} value={filedAt} disabled={disabled || closed} onChange={(e) => setFiledAt(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{arnLabel}{item.kind === "TDS_RETURN" ? "" : " (optional)"}</Label>
          <Input value={arn} maxLength={50} disabled={disabled || closed} onChange={(e) => setArn(e.target.value)} />
        </div>
      </div>
      {(item.kind === "GSTR1" || item.kind === "GSTR3B" || item.kind === "GENERIC") && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isNil} disabled={disabled || closed} onCheckedChange={(c) => setIsNil(c === true)} /> Nil return
        </label>
      )}
      {fields.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {item.kind === "TDS_RETURN" ? "Return figures (needed to mark it filed):" : "Figures for the reconciliation (optional, can be added later):"}
          </p>
          <FigureInputs fields={fields} values={values} setValues={setValues} disabled={disabled} />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {!closed && (
          <Button
            size="sm"
            disabled={disabled || busy !== null || !filedAt}
            onClick={() =>
              run("file", { action: "file", filedAt, arn: arn.trim() || null, isNil, figures: figuresPayload(values) }, filed ? "Saved" : "Marked filed")
            }
          >
            {busy === "file" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {filed ? "Save filing details" : "Mark filed"}
          </Button>
        )}
        {closed && fields.length > 0 && (
          <Button size="sm" variant="outline" disabled={disabled || busy !== null} onClick={() => run("figures", { action: "figures", figures: figuresPayload(values) }, "Figures saved")}>
            Save figures
          </Button>
        )}
        {item.status === "filed" && (
          <Button size="sm" variant="outline" disabled={disabled || busy !== null} onClick={() => run("undo", { action: "undo_filed" }, "Set back")}>
            <Undo2 className="mr-1 h-4 w-4" /> Not filed yet
          </Button>
        )}
      </div>
    </Section>
  );
}

function Gstr1A({ item, client, disabled, busy, run, onChange }: { item: SheetItem; client: ClientCell; disabled: boolean; busy: string | null; run: Run; onChange: (i: SheetItem) => void }) {
  const [filed, setFiled] = useState(item.gstr1aFiled);
  const [filedAt, setFiledAt] = useState(item.gstr1aFiledAt ?? todayKey());
  const [arn, setArn] = useState(item.gstr1aArn ?? "");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(GSTR1A_FIGURES.map((f) => [f.key, item.figures[f.key] !== undefined ? String(item.figures[f.key]) : ""]))
  );
  const save = async () => {
    const ok = await run("1a", { action: "gstr1a", filed, filedAt: filed ? filedAt : null, arn: arn.trim() || null });
    if (ok && filed) await run("1a-fig", { action: "figures", figures: figuresPayload(values) }, "GSTR-1A saved");
  };
  return (
    <Section title="GSTR-1A (only if filed this period)">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={filed} disabled={disabled} onCheckedChange={(c) => setFiled(c === true)} /> GSTR-1A filed for this period
      </label>
      {filed && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Filing date</Label>
              <Input type="date" max={todayKey()} value={filedAt} disabled={disabled} onChange={(e) => setFiledAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">ARN (optional)</Label>
              <Input value={arn} disabled={disabled} onChange={(e) => setArn(e.target.value)} />
            </div>
          </div>
          <FigureInputs fields={GSTR1A_FIGURES} values={values} setValues={setValues} disabled={disabled} />
          <FileButtons item={item} client={client} kinds={["GSTR1A_PDF", "GSTR1A_JSON"]} disabled={disabled} onChange={onChange} />
        </>
      )}
      <Button size="sm" variant="outline" disabled={disabled || busy !== null} onClick={save}>
        {(busy === "1a" || busy === "1a-fig") && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save GSTR-1A
      </Button>
    </Section>
  );
}

function TdsPayment({ item, disabled, busy, run, onChange }: { item: SheetItem; disabled: boolean; busy: string | null; run: Run; onChange: (i: SheetItem) => void }) {
  const [form, setForm] = useState({ section: "192", bsrCode: "", challanDate: todayKey(), serialNo: "", amount: "" });
  const closed = item.status === "completed";
  const total = item.challans.reduce((s, c) => s + c.amount, 0);
  const addChallan = async () => {
    const ok = await run("challan", { action: "challan_add", ...form, amount: Number(form.amount) }, "Challan added");
    if (ok) setForm((f) => ({ ...f, bsrCode: "", serialNo: "", amount: "" }));
  };
  return (
    <Section title="TDS paid this month">
      {!closed && <DataReceived item={item} disabled={disabled} onChange={onChange} />}
      {item.challans.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {item.challans.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="flex-1">
                {c.section} · {rupees(c.amount)} · {longDate(c.challanDate)}
                {c.bsrCode ? ` · BSR ${c.bsrCode}` : ""}
                {c.serialNo ? ` · No. ${c.serialNo}` : ""}
              </span>
              {!closed && !disabled && (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("challan", { action: "challan_remove", challanId: c.id })}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
          <li className="font-medium">Total {rupees(total)}</li>
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{item.noTds ? "No TDS this month." : "No challans yet."}</p>
      )}
      {!closed && (
        <div className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-5">
          <Select value={form.section} onValueChange={(section) => setForm((f) => ({ ...f, section }))} disabled={disabled}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TDS_SECTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" placeholder="Amount" value={form.amount} disabled={disabled} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          <Input type="date" value={form.challanDate} disabled={disabled} onChange={(e) => setForm((f) => ({ ...f, challanDate: e.target.value }))} />
          <Input placeholder="BSR code" maxLength={7} value={form.bsrCode} disabled={disabled} onChange={(e) => setForm((f) => ({ ...f, bsrCode: e.target.value }))} />
          <div className="flex gap-2">
            <Input placeholder="Challan no." value={form.serialNo} disabled={disabled} onChange={(e) => setForm((f) => ({ ...f, serialNo: e.target.value }))} />
            <Button size="sm" disabled={disabled || busy !== null || !form.amount} onClick={addChallan}>Add</Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {closed ? (
          <Button size="sm" variant="outline" disabled={disabled || busy !== null} onClick={() => run("close", { action: "tds_reopen" }, "Reopened")}>
            <Undo2 className="mr-1 h-4 w-4" /> Reopen month
          </Button>
        ) : (
          <>
            <Button size="sm" disabled={disabled || busy !== null || item.challans.length === 0} onClick={() => run("close", { action: "tds_close", noTds: false }, "Month closed")}>
              Close month (TDS paid)
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || busy !== null || item.challans.length > 0} onClick={() => run("close", { action: "tds_close", noTds: true }, "Marked no TDS")}>
              No TDS this month
            </Button>
          </>
        )}
      </div>
    </Section>
  );
}

function Certificates({ item, client, disabled, busy, run, onChange }: { item: SheetItem; client: ClientCell; disabled: boolean; busy: string | null; run: Run; onChange: (i: SheetItem) => void }) {
  const [date, setDate] = useState(item.certRequestedAt ?? todayKey());
  const [requestNo, setRequestNo] = useState(item.certRequestNo ?? "");
  const [to, setTo] = useState(client.email ?? "");
  const [sending, setSending] = useState(false);
  const certs = item.documents.filter((d) => d.kind === "CERTIFICATE");
  const name = item.workTypeName.includes("24Q") ? "Form 16" : "Form 16A";
  const closed = item.status === "completed";

  const email = async () => {
    setSending(true);
    try {
      const { data } = await axios.post("/api/compliance/documents/email", {
        docIds: certs.map((c) => c.id),
        to,
        certificateItemId: item.id,
      });
      if (data.item) onChange(data.item);
      toast.success(`${name} emailed`);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <Section title={`${name}: request, attach and email`}>
      <ol className="space-y-3 text-sm">
        <li className="space-y-1">
          <p className="font-medium">1. Requested on TRACES {item.certRequestedAt && <span className="text-emerald-700 dark:text-emerald-400">✓ {longDate(item.certRequestedAt)}</span>}</p>
          {!item.certRequestedAt ? (
            <div className="flex flex-wrap gap-2">
              <Input type="date" className="w-40" max={todayKey()} value={date} disabled={disabled} onChange={(e) => setDate(e.target.value)} />
              <Input placeholder="Request number" className="w-44" value={requestNo} disabled={disabled} onChange={(e) => setRequestNo(e.target.value)} />
              <Button size="sm" disabled={disabled || busy !== null} onClick={() => run("cert", { action: "cert_requested", date, requestNo: requestNo.trim() || null }, "Request noted")}>
                Mark requested
              </Button>
            </div>
          ) : (
            !closed && !disabled && !item.certEmailedAt && (
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("cert", { action: "cert_undo" })}>
                <Undo2 className="mr-1 h-4 w-4" /> Undo
              </Button>
            )
          )}
          {item.certRequestNo && <p className="text-xs text-muted-foreground">Request no. {item.certRequestNo}</p>}
        </li>
        <li className="space-y-1">
          <p className="font-medium">2. Downloaded and attached {certs.length > 0 && <span className="text-emerald-700 dark:text-emerald-400">✓ {certs.length} file(s)</span>}</p>
          {!closed && <FileButtons item={item} client={client} kinds={["CERTIFICATE"]} disabled={disabled || !item.certRequestedAt} onChange={onChange} multiple />}
        </li>
        <li className="space-y-1">
          <p className="font-medium">
            3. Emailed to the client{" "}
            {item.certEmailedAt && <span className="text-emerald-700 dark:text-emerald-400">✓ {longDate(item.certEmailedAt)} to {item.certEmailedTo}</span>}
          </p>
          {!item.certEmailedAt && (
            <div className="flex flex-wrap gap-2">
              <Input className="min-w-64 flex-1" placeholder="Client email (several: separate with commas)" value={to} disabled={disabled} onChange={(e) => setTo(e.target.value)} />
              <Button size="sm" disabled={disabled || sending || certs.length === 0 || !item.certRequestedAt || !to.trim()} onClick={email}>
                {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Mail className="mr-1 h-4 w-4" />} Email {name}
              </Button>
            </div>
          )}
        </li>
      </ol>
    </Section>
  );
}

function FileButtons({
  item,
  client,
  kinds,
  disabled,
  onChange,
  multiple,
}: {
  item: SheetItem;
  client: ClientCell;
  kinds: string[];
  disabled: boolean;
  onChange: (i: SheetItem) => void;
  multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(kinds[0]);
  const [uploading, setUploading] = useState(false);
  const pick = (k: string) => {
    setKind(k);
    inputRef.current?.click();
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      let latest: SheetItem | null = null;
      for (const file of Array.from(files)) latest = (await uploadComplianceFile(file, { clientId: client.id, itemId: item.id, kind })) ?? latest;
      if (latest) onChange(latest);
      toast.success(files.length === 1 ? "File added" : `${files.length} files added`);
    } catch (error) {
      toast.error(error instanceof Error && !axios.isAxiosError(error) ? error.message : apiError(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const accept = kind.endsWith("JSON") ? ".json" : kind === "OTHER" ? ".pdf,.json,.xlsx,.xls,.csv,.zip,.jpg,.jpeg,.png" : ".pdf,.zip";
  return (
    <div className="flex flex-wrap gap-2">
      <input ref={inputRef} type="file" className="hidden" accept={accept} multiple={multiple} onChange={(e) => upload(e.target.files)} />
      {kinds.map((k) => (
        <Button key={k} size="sm" variant="outline" disabled={disabled || uploading} onClick={() => pick(k)}>
          {uploading && kind === k ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />}
          Add {DOC_KIND_LABELS[k]}
        </Button>
      ))}
    </div>
  );
}

function Files({ item, client, disabled, onChange }: { item: SheetItem; client: ClientCell; disabled: boolean; onChange: (i: SheetItem) => void }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [to, setTo] = useState(client.email ?? "");
  const [sending, setSending] = useState(false);
  const kinds = [
    ...(item.kind !== "TDS_PAYMENT" ? ["RETURN_PDF"] : []),
    ...(item.requireJson || item.kind === "GSTR1" || item.kind === "GSTR3B" ? ["RETURN_JSON"] : []),
    ...(item.kind === "TDS_PAYMENT" ? ["CHALLAN"] : []),
    "OTHER",
  ];
  const remove = async (id: string) => {
    if (!window.confirm("Remove this file?")) return;
    setRemoving(id);
    try {
      const { data } = await axios.delete(`/api/compliance/documents/${id}`);
      if (data.item) onChange(data.item);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setRemoving(null);
    }
  };
  const email = async () => {
    setSending(true);
    try {
      await axios.post("/api/compliance/documents/email", { docIds: selected, to });
      toast.success("Emailed");
      setSelected([]);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSending(false);
    }
  };
  const needed = [item.requirePdf && "Return PDF", item.requireJson && "Return JSON"].filter(Boolean).join(" and ");
  return (
    <Section title="Files">
      {needed && item.kind !== "TDS_PAYMENT" && <p className="text-xs text-muted-foreground">Needed after filing: {needed}.</p>}
      {item.documents.length > 0 && (
        <ul className="space-y-1 text-sm">
          {item.documents.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <Checkbox
                checked={selected.includes(d.id)}
                onCheckedChange={(c) => setSelected((s) => (c === true ? [...s, d.id] : s.filter((id) => id !== d.id)))}
                aria-label="Select to email"
              />
              <span className="flex-1 truncate">
                <span className="text-muted-foreground">{DOC_KIND_LABELS[d.kind]}:</span> {d.fileName} <span className="text-xs text-muted-foreground">({formatBytes(d.size)})</span>
              </span>
              <Button asChild size="sm" variant="ghost">
                <a href={`/api/compliance/documents/${d.id}`} target="_blank" rel="noreferrer" aria-label="Download">
                  <Download className="h-4 w-4" />
                </a>
              </Button>
              {!disabled && item.status !== "completed" && (
                <Button size="sm" variant="ghost" disabled={removing === d.id} onClick={() => remove(d.id)} aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-64 flex-1" placeholder="Client email" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button size="sm" disabled={sending || !to.trim()} onClick={email}>
            {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Mail className="mr-1 h-4 w-4" />} Email {selected.length} file(s)
          </Button>
        </div>
      )}
      {item.status !== "completed" && <FileButtons item={item} client={client} kinds={kinds} disabled={disabled} onChange={onChange} />}
    </Section>
  );
}

function Fee({ item, fee, busy, run }: { item: SheetItem; fee: number | null; busy: string | null; run: Run }) {
  const [value, setValue] = useState(fee !== null ? String(fee) : "");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
      <div className="space-y-1">
        <Label className="text-xs">Fee for this period only (Admins and Partners; leave empty to use the client&apos;s fee)</Label>
        <Input type="number" min={0} className="w-40" value={value} onChange={(e) => setValue(e.target.value)} disabled={item.status === "completed"} />
      </div>
      <Button size="sm" variant="outline" disabled={busy !== null || item.status === "completed"} onClick={() => run("fee", { action: "fee", fee: numberOrNull(value) }, "Fee saved")}>
        Save fee
      </Button>
    </div>
  );
}
