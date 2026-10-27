"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Download, FileUp, Loader2, Mail, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AskClaudeButton } from "./ask-claude";
import type { WorkType } from "./setup";
import {
  apiError,
  currentMonthKey,
  DOC_KIND_LABELS,
  formatBytes,
  longDate,
  RCM_CATEGORIES,
  rupees,
  STATUS_LABELS,
  statusClasses,
  TDS_SECTIONS,
} from "./types";
import { uploadComplianceFile } from "./upload";
import { OldPeriods } from "./old-periods";

interface ClientListItem {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  works: { workTypeId: string; frequency: string }[];
}

interface ClientDetail {
  fy: number;
  client: { id: string; name: string; gstin: string | null; phone: string | null; email: string | null };
  subscriptions: {
    id: string;
    workTypeId: string;
    workTypeName: string;
    kind: string;
    frequency: "MONTHLY" | "QUARTERLY" | "YEARLY";
    previousFrequency: string | null;
    frequencyFrom: string | null;
    startPeriod: string;
    endPeriod: string | null;
    active: boolean;
    feeNil?: number | null;
    feeNonNil?: number | null;
  }[];
  obligations: {
    id: string;
    kind: "RCM" | "TDS";
    category: string;
    payee: string;
    fixedAmount: number | null;
    ratePercent: number;
    fromMonth: string;
    toMonth: string | null;
    active: boolean;
  }[];
  documents: { id: string; kind: string; fileName: string; size: number; createdAt: string; itemId: string | null; work: string | null }[];
  items: { id: string; workTypeId: string; period: string; periodStart: string; frequency: string; status: keyof typeof STATUS_LABELS; dueDate: string; filedAt: string | null; historical: boolean }[];
}

const FREQ = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", YEARLY: "Yearly" } as const;

export function ClientsPanel({ workTypes, isManager, initialClientId }: { workTypes: WorkType[]; isManager: boolean; initialClientId?: string | null }) {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [workFilter, setWorkFilter] = useState("all");
  const [checked, setChecked] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialClientId ?? null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get("/api/compliance/clients");
      setClients(data.clients);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || c.gstin?.toLowerCase().includes(q)) &&
        (workFilter === "all" ||
          (workFilter === "none" ? c.works.length === 0 : c.works.some((w) => w.workTypeId === workFilter)))
    );
  }, [clients, search, workFilter]);
  const nameOf = (id: string) => workTypes.find((w) => w.id === id)?.name ?? "";

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search client or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={workFilter} onValueChange={setWorkFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            <SelectItem value="none">No recurring work yet</SelectItem>
            {workTypes.map((w) => <SelectItem key={w.id} value={w.id}>With {w.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {isManager && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={visible.length > 0 && visible.every((c) => checked.includes(c.id))}
                onCheckedChange={(c) => setChecked(c === true ? visible.map((v) => v.id) : [])}
              />
              Select all shown
            </label>
            <Button size="sm" disabled={checked.length === 0} onClick={() => setBulkOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add work ({checked.length})
            </Button>
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto rounded-md border">
          {loading ? (
            <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" />
          ) : (
            visible.map((c) => (
              <div
                key={c.id}
                className={cn("flex cursor-pointer items-start gap-2 border-b p-2 text-sm last:border-0 hover:bg-muted/50", selectedId === c.id && "bg-muted")}
                onClick={() => setSelectedId(c.id)}
              >
                {isManager && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={checked.includes(c.id)}
                      onCheckedChange={(v) => setChecked((s) => (v === true ? [...s, c.id] : s.filter((id) => id !== c.id)))}
                    />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.works.length ? c.works.map((w) => nameOf(w.workTypeId)).join(", ") : "No recurring work"}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        {selectedId ? (
          <ClientDetailView key={selectedId} clientId={selectedId} workTypes={workTypes} isManager={isManager} onChanged={load} />
        ) : (
          <p className="rounded-md border p-8 text-center text-sm text-muted-foreground">
            Choose a client to see and set up their recurring work, monthly RCM/TDS payments, past periods and files.
            {isManager && " To add a work to many clients at once, tick them and use Add work."}
          </p>
        )}
      </div>

      {bulkOpen && (
        <AddWorkDialog
          clientIds={checked}
          workTypes={workTypes}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            setChecked([]);
            load();
          }}
        />
      )}
    </div>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

function AddWorkDialog({ clientIds, workTypes, onClose, onDone }: { clientIds: string[]; workTypes: WorkType[]; onClose: () => void; onDone: () => void }) {
  const active = workTypes.filter((w) => w.active);
  const [workTypeId, setWorkTypeId] = useState(active[0]?.id ?? "");
  const workType = active.find((w) => w.id === workTypeId);
  const [frequency, setFrequency] = useState<string>(workType?.frequency ?? "MONTHLY");
  const [startPeriod, setStartPeriod] = useState(currentMonthKey());
  const [feeNonNil, setFeeNonNil] = useState("");
  const [feeNil, setFeeNil] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (workType) setFrequency(workType.frequency);
  }, [workType]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axios.post("/api/compliance/subscriptions", {
        clientIds,
        workTypeId,
        frequency,
        startPeriod,
        feeNonNil: num(feeNonNil),
        feeNil: num(feeNil),
      });
      toast.success(`${workType?.name} added to ${data.added} client(s)${data.skipped.length ? `; ${data.skipped.length} skipped (${data.skipped[0].reason})` : ""}`);
      onDone();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a work to {clientIds.length} client(s)</DialogTitle>
          <DialogDescription>Periods appear in the sheets from the first period you choose. Older periods can be entered later as past periods.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Work</Label>
            <Select value={workTypeId} onValueChange={setWorkTypeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {active.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {workType?.allowQuarterly && (
            <div className="space-y-1">
              <Label>Filing frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="QUARTERLY">Quarterly (QRMP)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">GSTR-1 and GSTR-3B of a client must have the same frequency.</p>
            </div>
          )}
          <div className="space-y-1">
            <Label>First period to track</Label>
            <Input type="month" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} />
          </div>
          {workType?.billable && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Fee (non-nil)</Label>
                <Input type="number" min={0} placeholder={workType.defaultFeeNonNil !== null ? `Default ${workType.defaultFeeNonNil}` : ""} value={feeNonNil} onChange={(e) => setFeeNonNil(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fee (nil return)</Label>
                <Input type="number" min={0} placeholder={workType.defaultFeeNil !== null ? `Default ${workType.defaultFeeNil}` : ""} value={feeNil} onChange={(e) => setFeeNil(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">Leave empty to use the work&apos;s default fee. Each client&apos;s fee can be changed later.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !workTypeId}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientDetailView({ clientId, workTypes, isManager, onChanged }: { clientId: string; workTypes: WorkType[]; isManager: boolean; onChanged: () => void }) {
  const [fy, setFy] = useState<number | null>(null);
  const [data, setData] = useState<ClientDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`/api/compliance/clients/${clientId}`, { params: fy ? { fy } : {} });
      setData(data);
    } catch (error) {
      toast.error(apiError(error));
    }
  }, [clientId, fy]);
  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <Loader2 className="mx-auto mt-8 h-6 w-6 animate-spin" />;
  const reload = () => {
    load();
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{data.client.name}</h2>
          <p className="text-xs text-muted-foreground">
            {[data.client.gstin, data.client.phone, data.client.email].filter(Boolean).join(" · ") || "No GSTIN, phone or email saved"}
          </p>
        </div>
        {isManager && (
          <AskClaudeButton
            label="Ask Claude about this client"
            question={`Make a compliance and reconciliation summary for the client "${data.client.name}"${data.client.gstin ? ` (GSTIN ${data.client.gstin})` : ""} for FY ${data.fy}-${String((data.fy + 1) % 100).padStart(2, "0")}: what is filed and pending, GSTR-1 (+1A) vs GSTR-3B by period, ITC claimed vs GSTR-2B, RCM, and TDS challans vs returns.`}
          />
        )}
      </div>

      <Works data={data} workTypes={workTypes} isManager={isManager} onChanged={reload} />
      <Obligations data={data} onChanged={reload} />
      <YearView data={data} workTypes={workTypes} fy={data.fy} setFy={setFy} />
      <PastPeriods data={data} workTypes={workTypes} onChanged={reload} />
      <Documents data={data} onChanged={reload} />
    </div>
  );
}

function Box({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Works({ data, workTypes, isManager, onChanged }: { data: ClientDetail; workTypes: WorkType[]; isManager: boolean; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClientDetail["subscriptions"][number] | null>(null);
  const stop = async (id: string, active: boolean) => {
    if (!active && !window.confirm("Stop this work for the client? Periods already in the sheet stay.")) return;
    try {
      await axios.patch(`/api/compliance/subscriptions/${id}`, { active });
      onChanged();
    } catch (error) {
      toast.error(apiError(error));
    }
  };
  return (
    <Box title="Recurring work" action={isManager && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" /> Add work</Button>}>
      {data.subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recurring work set up.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-1">Work</th>
                <th className="p-1">Frequency</th>
                <th className="p-1">Tracked from</th>
                {isManager && <th className="p-1">Fee (non-nil / nil)</th>}
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {data.subscriptions.map((s) => (
                <tr key={s.id} className={cn("border-t", !s.active && "opacity-50")}>
                  <td className="p-1 font-medium">{s.workTypeName}{!s.active && " (stopped)"}</td>
                  <td className="p-1">
                    {FREQ[s.frequency]}
                    {s.previousFrequency && s.frequencyFrom && <span className="text-xs text-muted-foreground"> (from {s.frequencyFrom}; before: {FREQ[s.previousFrequency as keyof typeof FREQ]})</span>}
                  </td>
                  <td className="p-1">{s.startPeriod}</td>
                  {isManager && <td className="p-1">{s.feeNonNil != null ? rupees(s.feeNonNil) : "default"} / {s.feeNil != null ? rupees(s.feeNil) : "default"}</td>}
                  <td className="p-1 text-right">
                    {isManager && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => stop(s.id, !s.active)}>{s.active ? "Stop" : "Restart"}</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddWorkDialog clientIds={[data.client.id]} workTypes={workTypes} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChanged(); }} />}
      {editing && <EditSubscription sub={editing} workTypes={workTypes} onClose={() => setEditing(null)} onDone={() => { setEditing(null); onChanged(); }} />}
    </Box>
  );
}

function EditSubscription({
  sub,
  workTypes,
  onClose,
  onDone,
}: {
  sub: ClientDetail["subscriptions"][number];
  workTypes: WorkType[];
  onClose: () => void;
  onDone: () => void;
}) {
  const workType = workTypes.find((w) => w.id === sub.workTypeId);
  const [feeNonNil, setFeeNonNil] = useState(sub.feeNonNil != null ? String(sub.feeNonNil) : "");
  const [feeNil, setFeeNil] = useState(sub.feeNil != null ? String(sub.feeNil) : "");
  const [changeFrequency, setChangeFrequency] = useState(false);
  const [from, setFrom] = useState(currentMonthKey());
  const [saving, setSaving] = useState(false);
  const newFrequency = sub.frequency === "MONTHLY" ? "QUARTERLY" : "MONTHLY";
  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`/api/compliance/subscriptions/${sub.id}`, {
        feeNonNil: num(feeNonNil),
        feeNil: num(feeNil),
        ...(changeFrequency && { frequencyChange: { frequency: newFrequency, from } }),
      });
      toast.success("Saved");
      onDone();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{sub.workTypeName}</DialogTitle>
          <DialogDescription>Fees apply to periods completed from now on. The billing manager checks every fee before the bill is approved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {workType?.billable ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Fee (non-nil)</Label>
                <Input type="number" min={0} value={feeNonNil} onChange={(e) => setFeeNonNil(e.target.value)} placeholder="Work's default" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fee (nil return)</Label>
                <Input type="number" min={0} value={feeNil} onChange={(e) => setFeeNil(e.target.value)} placeholder="Work's default" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This work is not billed.</p>
          )}
          {workType?.allowQuarterly && (
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={changeFrequency} onCheckedChange={(c) => setChangeFrequency(c === true)} />
                Change to {FREQ[newFrequency].toLowerCase()} filing
              </label>
              {changeFrequency && (
                <>
                  <Label className="text-xs">From (a quarter&apos;s first month for quarterly)</Label>
                  <Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <p className="text-xs text-muted-foreground">GSTR-1 and GSTR-3B change together. Earlier periods keep the old frequency.</p>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Obligations({ data, onChanged }: { data: ClientDetail; onChanged: () => void }) {
  const empty = { kind: "RCM" as "RCM" | "TDS", category: RCM_CATEGORIES[0], payee: "", fixedAmount: "", ratePercent: "18", fromMonth: currentMonthKey() };
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    setSaving(true);
    try {
      await axios.post("/api/compliance/obligations", {
        clientId: data.client.id,
        kind: form.kind,
        category: form.category,
        payee: form.payee.trim(),
        fixedAmount: num(form.fixedAmount),
        ratePercent: Number(form.ratePercent),
        fromMonth: form.fromMonth,
      });
      toast.success("Added. It now appears in the client's open periods");
      setForm(empty);
      setOpen(false);
      onChanged();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Stop this payment? Months already done keep it.")) return;
    try {
      await axios.delete(`/api/compliance/obligations/${id}`);
      onChanged();
    } catch (error) {
      toast.error(apiError(error));
    }
  };
  const active = data.obligations.filter((o) => o.active);
  return (
    <Box
      title="Monthly RCM and TDS payments (so they are never missed)"
      action={<Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>{open ? <X className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}{open ? "Close" : "Add"}</Button>}
    >
      <p className="text-xs text-muted-foreground">
        RCM lines appear in every GSTR-3B and TDS lines in every TDS payment month. Staff must confirm or skip each line before closing the period.
      </p>
      {active.length > 0 && (
        <ul className="space-y-1 text-sm">
          {active.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <span className="w-12 rounded bg-muted px-1 text-center text-xs">{o.kind}</span>
              <span className="flex-1">
                {o.category} – {o.payee} · {o.fixedAmount !== null ? `${rupees(o.fixedAmount)}/month` : "amount varies"} @ {o.ratePercent}%
                <span className="text-xs text-muted-foreground"> from {o.fromMonth}{o.toMonth ? ` to ${o.toMonth}` : ""}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => remove(o.id)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-3">
          <Select
            value={form.kind}
            onValueChange={(kind) => set(kind === "RCM" ? { kind: "RCM", category: RCM_CATEGORIES[0], ratePercent: "18" } : { kind: "TDS", category: "194I(b)", ratePercent: "10" })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="RCM">RCM (in GSTR-3B)</SelectItem>
              <SelectItem value="TDS">TDS (monthly payment)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={form.category} onValueChange={(category) => set({ category })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(form.kind === "RCM" ? RCM_CATEGORIES : TDS_SECTIONS).map((c) => <SelectItem key={c} value={c}>{form.kind === "TDS" ? `Section ${c}` : c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Paid to (e.g. landlord's name)" value={form.payee} onChange={(e) => set({ payee: e.target.value })} />
          <Input type="number" min={0} placeholder="Fixed amount per month (empty if it varies)" value={form.fixedAmount} onChange={(e) => set({ fixedAmount: e.target.value })} />
          <div className="flex items-center gap-1">
            <Input type="number" min={0} max={100} value={form.ratePercent} onChange={(e) => set({ ratePercent: e.target.value })} />
            <span className="text-sm">%</span>
          </div>
          <div className="flex gap-2">
            <Input type="month" value={form.fromMonth} onChange={(e) => set({ fromMonth: e.target.value })} title="From month" />
            <Button size="sm" disabled={saving || form.payee.trim().length < 2} onClick={save}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}</Button>
          </div>
        </div>
      )}
    </Box>
  );
}

function YearView({ data, workTypes, fy, setFy }: { data: ClientDetail; workTypes: WorkType[]; fy: number; setFy: (fy: number) => void }) {
  const ids = [...new Set([...data.subscriptions.map((s) => s.workTypeId), ...data.items.map((i) => i.workTypeId)])];
  const rows = workTypes.filter((w) => ids.includes(w.id));
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    const y = m >= 4 ? fy : fy + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  });
  const label = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
  return (
    <Box
      title="Year at a glance"
      action={
        <Select value={String(fy)} onValueChange={(v) => setFy(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[fy - 2, fy - 1, fy, fy + 1].map((y) => <SelectItem key={y} value={String(y)}>FY {y}-{String((y + 1) % 100).padStart(2, "0")}</SelectItem>)}
          </SelectContent>
        </Select>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing for this year.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="p-1 text-left">Work</th>
                {months.map((m) => <th key={m} className="p-1">{label(m)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td className="whitespace-nowrap p-1 font-medium">{w.name}</td>
                  {months.map((m) => {
                    const item = data.items.find((i) => i.workTypeId === w.id && i.periodStart.slice(0, 7) === m);
                    return (
                      <td key={m} className="p-0.5">
                        {item ? (
                          <span
                            title={`${item.period}: ${STATUS_LABELS[item.status]}${item.filedAt ? `, filed ${longDate(item.filedAt)}` : ""}`}
                            className={cn("block min-w-[3.5rem] rounded border px-1 py-0.5 text-center", statusClasses({ status: item.status, overdue: false }))}
                          >
                            {item.status === "completed" ? "✓" : item.status === "filed" ? "Filed" : item.status === "not_required" ? "N/A" : item.status === "data_received" ? "Data" : "–"}
                            {item.frequency === "QUARTERLY" ? " Q" : item.frequency === "YEARLY" ? " FY" : ""}
                          </span>
                        ) : (
                          <span className="block min-w-[3.5rem]" />
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
    </Box>
  );
}

function PastPeriods({ data, workTypes, onChanged }: { data: ClientDetail; workTypes: WorkType[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  // The client's own works first
  const ordered = [
    ...workTypes.filter((w) => data.subscriptions.some((s) => s.workTypeId === w.id)),
    ...workTypes.filter((w) => !data.subscriptions.some((s) => s.workTypeId === w.id)),
  ];
  return (
    <Box title="Past periods (with return PDF and JSON)" action={<Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Open"}</Button>}>
      {open ? (
        <OldPeriods clientId={data.client.id} workTypes={ordered} onChanged={onChanged} />
      ) : (
        <p className="text-xs text-muted-foreground">Enter the months or quarters before tracking started, each with its filing date, ARN and files.</p>
      )}
    </Box>
  );
}

function Documents({ data, onChanged }: { data: ClientDetail; onChanged: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [to, setTo] = useState(data.client.email ?? "");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = data.documents.filter((d) => !filter || `${d.fileName} ${d.work ?? ""}`.toLowerCase().includes(filter.toLowerCase()));

  const email = async () => {
    setSending(true);
    try {
      await axios.post("/api/compliance/documents/email", { docIds: selected, to, note: note.trim() || null });
      toast.success("Emailed");
      setSelected([]);
      setNote("");
      onChanged();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSending(false);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) await uploadComplianceFile(file, { clientId: data.client.id, itemId: null, kind: "OTHER" });
      toast.success("Added");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error && !axios.isAxiosError(error) ? error.message : apiError(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Box
      title={`Files (${data.documents.length})`}
      action={
        <>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />} Add a file
          </Button>
        </>
      }
    >
      <p className="text-xs text-muted-foreground">Any staff member can email files to the client from here. Large files are sent as download links.</p>
      {data.documents.length > 5 && <Input placeholder="Search files" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
          {visible.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <Checkbox checked={selected.includes(d.id)} onCheckedChange={(c) => setSelected((s) => (c === true ? [...s, d.id] : s.filter((id) => id !== d.id)))} />
              <span className="flex-1 truncate">
                <span className="text-muted-foreground">{d.work ? `${d.work} · ` : ""}{DOC_KIND_LABELS[d.kind]}:</span> {d.fileName}
                <span className="text-xs text-muted-foreground"> ({formatBytes(d.size)}, {longDate(d.createdAt)})</span>
              </span>
              <Button asChild size="sm" variant="ghost">
                <a href={`/api/compliance/documents/${d.id}`} target="_blank" rel="noreferrer" aria-label="Download"><Download className="h-4 w-4" /></a>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && (
        <div className="space-y-2 rounded-md bg-muted/40 p-2">
          <Input placeholder="Client email (several: separate with commas)" value={to} onChange={(e) => setTo(e.target.value)} />
          <Input placeholder="Note in the email (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={sending || !to.trim()} onClick={email}>
            {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Mail className="mr-1 h-4 w-4" />} Email {selected.length} file(s)
          </Button>
        </div>
      )}
    </Box>
  );
}
