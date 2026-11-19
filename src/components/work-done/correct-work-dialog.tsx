"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClientOption, ClientPicker, clientLabel } from "@/components/billing/client-picker";
import { CompanySelect } from "@/components/billing/company-select";
import { apiError } from "@/components/compliance/types";
import type { CompanyValue } from "@/lib/billing-constants";
import type { CorrectionField, LoggedWorkEntry } from "@/lib/work-correction";

// Work done → Correct: Admin and the partners who see everyone's work fix
// logged work that was entered wrongly. They must say what is being changed
// and why, and on whose request. Earlier corrections are listed below.

type Requester = "staff" | "client" | "self";
const REQUESTER_LABELS: Record<Requester, string> = {
  staff: "A member of staff",
  client: "The client",
  self: "No one (I found the mistake)",
};
const FIELD_LABELS: Record<CorrectionField, string> = {
  doneBy: "Done by",
  company: "Firm",
  client: "Client",
  work: "Work",
  date: "Date",
  remark: "Remark",
};

interface Person {
  id: string;
  name: string;
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export function CorrectWorkDialog({
  billId,
  onClose,
  onSaved,
}: {
  billId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [entry, setEntry] = useState<LoggedWorkEntry | null>(null);
  const [staff, setStaff] = useState<Person[]>([]);
  const [saving, setSaving] = useState(false);

  // The form, starting from the entry as it is
  const [doneBy, setDoneBy] = useState("");
  const [company, setCompany] = useState<CompanyValue>("MVC");
  const [client, setClient] = useState<ClientOption | null>(null);
  const [description, setDescription] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [remark, setRemark] = useState("");
  const [reason, setReason] = useState("");
  const [requester, setRequester] = useState<Requester | "">("");
  const [requestedById, setRequestedById] = useState("");

  const fill = (e: LoggedWorkEntry) => {
    setEntry(e);
    setDoneBy(e.createdBy.id);
    setCompany(e.company);
    setClient(e.client);
    setDescription(e.description);
    setWorkDate(e.workDate);
    setRemark(e.remark ?? "");
    setReason("");
    setRequester("");
    setRequestedById("");
  };

  useEffect(() => {
    if (!billId) return;
    let cancelled = false;
    setEntry(null);
    axios
      .get<{ entry: LoggedWorkEntry; staff: Person[] }>(`/api/work-done/logged/${billId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setStaff(data.staff);
        fill(data.entry);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(apiError(error, "Could not open the logged work"));
        onClose();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId]);

  const changed =
    !!entry &&
    (doneBy !== entry.createdBy.id ||
      company !== entry.company ||
      (client?.id ?? null) !== (entry.client?.id ?? null) ||
      description.trim() !== entry.description ||
      workDate !== entry.workDate ||
      remark.trim() !== (entry.remark ?? ""));
  const valid =
    changed &&
    description.trim().length >= 3 &&
    !!workDate &&
    reason.trim().length >= 5 &&
    !!requester &&
    (requester !== "staff" || !!requestedById);

  const save = async () => {
    if (!entry || !valid) return;
    setSaving(true);
    try {
      const { data } = await axios.post<{ entry: LoggedWorkEntry }>(`/api/work-done/logged/${entry.id}`, {
        ...(doneBy !== entry.createdBy.id && { createdById: doneBy }),
        ...(company !== entry.company && { company }),
        ...(client && client.id !== entry.client?.id && { clientId: client.id }),
        ...(description.trim() !== entry.description && { description: description.trim() }),
        ...(workDate !== entry.workDate && { workDate }),
        ...(remark.trim() !== (entry.remark ?? "") && { remark: remark.trim() }),
        reason: reason.trim(),
        requester,
        requestedById: requester === "staff" ? requestedById : null,
      });
      fill(data.entry);
      toast.success("Logged work corrected");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, "Could not save the correction"));
    } finally {
      setSaving(false);
    }
  };

  // Someone no longer active can still be the one who logged it
  const staffOptions = entry && !staff.some((p) => p.id === entry.createdBy.id) ? [entry.createdBy, ...staff] : staff;
  const locked = !!entry && !entry.contentEditable;

  return (
    <Dialog open={!!billId} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Correct logged work</DialogTitle>
          <DialogDescription>
            Change what was logged wrongly. Say what is being changed and why, and on whose request; the person who logged it
            is told, and the change is kept in the history below and on the bill.
          </DialogDescription>
        </DialogHeader>

        {!entry ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {locked && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                This work is already {entry.billNumber ? `billed (bill ${entry.billNumber})` : entry.statusLabel.toLowerCase()}.
                Only who did it and the remark can be corrected here. For the firm, client, work or date, the billing manager
                asks for an edit of the bill.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Done by</Label>
                <Select value={doneBy} onValueChange={setDoneBy}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {staffOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cw-date">Date of work</Label>
                <Input id="cw-date" type="date" value={workDate} disabled={locked} onChange={(e) => setWorkDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Firm</Label>
                <div>
                  <CompanySelect value={company} onChange={setCompany} disabled={locked} />
                </div>
                {company !== entry.company && entry.status !== "not_billable" && (
                  <p className="text-xs text-muted-foreground">The bill goes back to draft for the other firm&apos;s billing manager.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Client</Label>
                <ClientPicker
                  value={client}
                  onChange={setClient}
                  disabled={locked}
                  label={!client && entry.billToName ? `${entry.billToName} (Other)` : client ? clientLabel(client) : null}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="cw-work">Work done</Label>
              <Textarea id="cw-work" rows={2} value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cw-remark">Remark</Label>
              <Input id="cw-remark" value={remark} maxLength={1000} onChange={(e) => setRemark(e.target.value)} />
            </div>

            <div className="space-y-3 rounded-md border bg-muted/40 p-3">
              <div className="space-y-1">
                <Label htmlFor="cw-reason">What is being changed and why *</Label>
                <Textarea
                  id="cw-reason"
                  rows={3}
                  maxLength={2000}
                  placeholder="e.g. Logged under Ramesh by mistake; the return was filed by Suresh. Date corrected to the filing date."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>On whose request *</Label>
                  <Select value={requester} onValueChange={(v) => setRequester(v as Requester)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(REQUESTER_LABELS) as Requester[]).map((r) => (
                        <SelectItem key={r} value={r}>
                          {REQUESTER_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {requester === "staff" && (
                  <div className="space-y-1">
                    <Label>Requested by *</Label>
                    <Select value={requestedById} onValueChange={setRequestedById}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose the person" />
                      </SelectTrigger>
                      <SelectContent>
                        {staff.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {entry.corrections.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1 text-sm font-medium">
                  <History className="h-4 w-4" /> Earlier corrections
                </p>
                <ul className="space-y-2">
                  {entry.corrections.map((c) => (
                    <li key={c.id} className="rounded-md border p-2 text-sm">
                      <p className="text-xs text-muted-foreground">
                        {fmtWhen(c.createdAt)} · by {c.correctedBy.name} ·{" "}
                        {c.requester === "staff"
                          ? `on request of ${c.requestedBy?.name ?? "a member of staff"}`
                          : c.requester === "client"
                            ? "on the client's request"
                            : "found by the corrector"}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {(Object.keys(c.changes) as CorrectionField[]).map((field) => (
                          <li key={field}>
                            <span className="font-medium">{FIELD_LABELS[field]}:</span>{" "}
                            <span className="text-muted-foreground line-through">{c.changes[field]!.from}</span> → {c.changes[field]!.to}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 whitespace-pre-wrap">
                        <span className="font-medium">Why:</span> {c.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
