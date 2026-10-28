"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiError, rupees } from "./types";
import { SwingSetting } from "./gst-working";

export interface WorkType {
  id: string;
  name: string;
  kind: string;
  frequency: "MONTHLY" | "QUARTERLY" | "YEARLY";
  allowQuarterly: boolean;
  company: "MVC" | "BEDGE";
  dueDay: number;
  dueMonthOffset: number;
  quarterlyDueDay: number | null;
  quarterlyDueMonthOffset: number | null;
  leadDays: number;
  returnType: string | null;
  certificateRule: string;
  requirePdf: boolean;
  requireJson: boolean;
  billable: boolean;
  defaultFeeNil: number | null;
  defaultFeeNonNil: number | null;
  reminderSubject: string;
  reminderMessage: string;
  sortOrder: number;
  active: boolean;
  system: boolean;
  team: { id: string; name: string }[];
  clients: number;
}

const FREQUENCY_LABELS = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", YEARLY: "Yearly" };

function dueText(day: number, offset: number) {
  if (offset === 0) return `${day}th of the period's last month`;
  return `${day}th, ${offset} month${offset === 1 ? "" : "s"} after the period`;
}

export function ComplianceSetup({ workTypes, onChanged }: { workTypes: WorkType[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<WorkType | null>(null);
  const [adding, setAdding] = useState(false);
  const [staff, setStaff] = useState<{ id: string; name: string; role: string }[]>([]);

  useEffect(() => {
    axios.get("/api/compliance/staff").then(({ data }) => setStaff(data.users)).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Each work has a team (any member can update it), due dates, the files needed to complete it, and whether it is billed.
        </p>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add work
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs">
            <tr>
              {["Work", "Frequency", "Due", "Team", "Clients", "Files to complete", "Billing", ""].map((h) => (
                <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workTypes.map((wt) => (
              <tr key={wt.id} className={`border-t ${wt.active ? "" : "opacity-50"}`}>
                <td className="p-2 font-medium">{wt.name}{!wt.active && " (stopped)"}</td>
                <td className="p-2">{FREQUENCY_LABELS[wt.frequency]}{wt.allowQuarterly ? " / quarterly" : ""}</td>
                <td className="p-2 text-xs">{dueText(wt.dueDay, wt.dueMonthOffset)}</td>
                <td className="p-2 text-xs">{wt.team.length ? wt.team.map((t) => t.name).join(", ") : <span className="text-muted-foreground">Everyone</span>}</td>
                <td className="p-2">{wt.clients}</td>
                <td className="p-2 text-xs">
                  {[wt.requirePdf && "PDF", wt.requireJson && "JSON", wt.certificateRule !== "NONE" && "Form 16/16A"].filter(Boolean).join(" + ") || "None"}
                </td>
                <td className="p-2 text-xs">
                  {wt.billable
                    ? `Billed${wt.defaultFeeNonNil !== null ? ` · ${rupees(wt.defaultFeeNonNil)}` : ""}${wt.defaultFeeNil !== null ? ` (nil ${rupees(wt.defaultFeeNil)})` : ""}`
                    : "Not billed"}
                </td>
                <td className="p-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(wt)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SwingSetting />
      {editing && <EditWorkType workType={editing} staff={staff} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
      {adding && <AddWorkType onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />}
    </div>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

function EditWorkType({
  workType,
  staff,
  onClose,
  onSaved,
}: {
  workType: WorkType;
  staff: { id: string; name: string; role: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: workType.name,
    company: workType.company,
    dueDay: String(workType.dueDay),
    dueMonthOffset: String(workType.dueMonthOffset),
    quarterlyDueDay: workType.quarterlyDueDay !== null ? String(workType.quarterlyDueDay) : "",
    quarterlyDueMonthOffset: workType.quarterlyDueMonthOffset !== null ? String(workType.quarterlyDueMonthOffset) : "",
    leadDays: String(workType.leadDays),
    requirePdf: workType.requirePdf,
    requireJson: workType.requireJson,
    billable: workType.billable,
    defaultFeeNil: workType.defaultFeeNil !== null ? String(workType.defaultFeeNil) : "",
    defaultFeeNonNil: workType.defaultFeeNonNil !== null ? String(workType.defaultFeeNonNil) : "",
    reminderSubject: workType.reminderSubject,
    reminderMessage: workType.reminderMessage,
    active: workType.active,
  });
  const [team, setTeam] = useState<string[]>(workType.team.map((t) => t.id));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`/api/compliance/work-types/${workType.id}`, {
        name: form.name.trim(),
        company: form.company,
        dueDay: Number(form.dueDay),
        dueMonthOffset: Number(form.dueMonthOffset),
        ...(workType.allowQuarterly && {
          quarterlyDueDay: num(form.quarterlyDueDay),
          quarterlyDueMonthOffset: num(form.quarterlyDueMonthOffset),
        }),
        leadDays: Number(form.leadDays),
        requirePdf: form.requirePdf,
        requireJson: form.requireJson,
        billable: form.billable,
        defaultFeeNil: num(form.defaultFeeNil),
        defaultFeeNonNil: num(form.defaultFeeNonNil),
        reminderSubject: form.reminderSubject,
        reminderMessage: form.reminderMessage,
        active: form.active,
        teamUserIds: team,
      });
      toast.success("Saved");
      onSaved();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{workType.name}</DialogTitle>
          <DialogDescription>
            Changes to due dates apply to periods that appear from now on. A team change applies today; the history of who was on the team is kept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Company (bills and emails)</Label>
              <Select value={form.company} onValueChange={(v) => set({ company: v as "MVC" | "BEDGE" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MVC">MVC</SelectItem>
                  <SelectItem value="BEDGE">B Edge</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-semibold">Team</p>
            <p className="text-xs text-muted-foreground">Anyone ticked can update this work for every client. With nobody ticked, all staff can.</p>
            <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
              {staff.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={team.includes(u.id)} onCheckedChange={(c) => setTeam((t) => (c === true ? [...t, u.id] : t.filter((id) => id !== u.id)))} />
                  {u.name}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-semibold">Due date</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Day of month</Label>
                <Input type="number" min={1} max={31} value={form.dueDay} onChange={(e) => set({ dueDay: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Months after the period ends</Label>
                <Input type="number" min={0} max={12} value={form.dueMonthOffset} onChange={(e) => set({ dueMonthOffset: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Show in the sheet (days before)</Label>
                <Input type="number" min={0} max={90} value={form.leadDays} onChange={(e) => set({ leadDays: e.target.value })} />
              </div>
            </div>
            {workType.allowQuarterly && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Quarterly filers: day</Label>
                  <Input type="number" min={1} max={31} value={form.quarterlyDueDay} onChange={(e) => set({ quarterlyDueDay: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Quarterly: months after</Label>
                  <Input type="number" min={0} max={12} value={form.quarterlyDueMonthOffset} onChange={(e) => set({ quarterlyDueMonthOffset: e.target.value })} />
                </div>
                {workType.kind === "GSTR3B" && <p className="text-xs text-muted-foreground sm:col-span-1">Quarterly GSTR-3B is set to the 22nd or 24th from the client&apos;s GSTIN state.</p>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">For a one-off government extension, change the date here and change it back afterwards.</p>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-semibold">Completed when (after filing)</p>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.requirePdf} onCheckedChange={(c) => set({ requirePdf: c === true })} /> Return PDF is attached</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.requireJson} onCheckedChange={(c) => set({ requireJson: c === true })} /> Return JSON is attached</label>
            {workType.certificateRule !== "NONE" && <p className="text-xs text-muted-foreground">Form 16/16A must also be requested, attached and emailed ({workType.certificateRule === "Q4_ONLY" ? "Q4 only" : "every quarter"}).</p>}
            {workType.kind === "GSTR3B" && <p className="text-xs text-muted-foreground">All RCM lines must also be confirmed or skipped.</p>}
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-semibold"><Checkbox checked={form.billable} onCheckedChange={(c) => set({ billable: c === true })} /> Bill this work when completed</label>
            {form.billable && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Default fee (non-nil)</Label>
                  <Input type="number" min={0} value={form.defaultFeeNonNil} onChange={(e) => set({ defaultFeeNonNil: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Default fee (nil return)</Label>
                  <Input type="number" min={0} value={form.defaultFeeNil} onChange={(e) => set({ defaultFeeNil: e.target.value })} />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">A client&apos;s own fee (Compliance → Clients) is used before these. The billing manager always checks the fee before the bill is approved.</p>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-semibold">Reminder message</p>
            <Input value={form.reminderSubject} onChange={(e) => set({ reminderSubject: e.target.value })} />
            <Textarea rows={4} value={form.reminderMessage} onChange={(e) => set({ reminderMessage: e.target.value })} />
            <p className="text-xs text-muted-foreground">{"{client}"}, {"{work}"}, {"{period}"}, {"{due}"}, {"{taxPayable}"} and {"{firm}"} are filled in for each client.</p>
          </div>

          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.active} onCheckedChange={(c) => set({ active: c === true })} /> Active (untick to stop creating new periods)</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddWorkType({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: "",
    frequency: "MONTHLY" as "MONTHLY" | "QUARTERLY" | "YEARLY",
    company: "MVC" as "MVC" | "BEDGE",
    dueDay: "15",
    dueMonthOffset: "1",
    leadDays: "7",
    requirePdf: true,
    billable: false,
    defaultFeeNonNil: "",
    defaultFeeNil: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    setSaving(true);
    try {
      await axios.post("/api/compliance/work-types", {
        ...form,
        name: form.name.trim(),
        dueDay: Number(form.dueDay),
        dueMonthOffset: Number(form.dueMonthOffset),
        leadDays: Number(form.leadDays),
        defaultFeeNonNil: num(form.defaultFeeNonNil),
        defaultFeeNil: num(form.defaultFeeNil),
      });
      toast.success("Work added. Set its team and add clients to it");
      onSaved();
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
          <DialogTitle>Add a recurring work</DialogTitle>
          <DialogDescription>For example PF return, ESI, ROC, GSTR-9 or a professional tax return.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="PF Return" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => set({ frequency: v as typeof form.frequency })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="QUARTERLY">Quarterly (Apr–Jun…)</SelectItem>
                  <SelectItem value="YEARLY">Yearly (financial year)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Company</Label>
              <Select value={form.company} onValueChange={(v) => set({ company: v as "MVC" | "BEDGE" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MVC">MVC</SelectItem>
                  <SelectItem value="BEDGE">B Edge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Due day of month</Label>
              <Input type="number" min={1} max={31} value={form.dueDay} onChange={(e) => set({ dueDay: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Months after the period ends</Label>
              <Input type="number" min={0} max={12} value={form.dueMonthOffset} onChange={(e) => set({ dueMonthOffset: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.requirePdf} onCheckedChange={(c) => set({ requirePdf: c === true })} /> Completed only when the return PDF is attached</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.billable} onCheckedChange={(c) => set({ billable: c === true })} /> Bill this work when completed</label>
          {form.billable && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input type="number" placeholder="Default fee (non-nil)" value={form.defaultFeeNonNil} onChange={(e) => set({ defaultFeeNonNil: e.target.value })} />
              <Input type="number" placeholder="Default fee (nil)" value={form.defaultFeeNil} onChange={(e) => set({ defaultFeeNil: e.target.value })} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || form.name.trim().length < 2}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
