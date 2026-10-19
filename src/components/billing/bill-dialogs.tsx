"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatRupees, gstAmount, GST_RATE_PERCENT } from "@/lib/billing-constants";
import { BillTo, BillToPicker, billToPayload, billToValid } from "./client-picker";
import { apiErrorMessage, Bill, BillAction, BillEvent, billParty, EVENT_LABELS, runBillAction } from "./bill-types";

export type BillDialog = "amount" | "request" | "send_back" | "not_billable" | "final_reject" | "details" | "history";

const REMARK_DIALOGS = {
  send_back: {
    title: "Send back to billing manager",
    description: "Say what is wrong or what you need to know. Admin and the billing manager will be notified.",
    required: true,
    button: "Send back",
    success: "Sent back",
  },
  not_billable: {
    title: "Mark as not billable",
    description: "The bill is set aside. You can reopen it later.",
    required: false,
    button: "Not billable",
    success: "Marked not billable",
  },
  final_reject: {
    title: "Return to billing manager",
    description: "The bill goes back to the billing manager without a number. Say what needs to change.",
    required: true,
    button: "Return",
    success: "Returned to billing manager",
  },
} as const;

interface DialogProps {
  bill: Bill;
  onClose: () => void;
  onDone: (bill: Bill) => void;
}

// Runs an action and reports the result; returns true when it worked
function useBillAction({ bill, onDone }: Pick<DialogProps, "bill" | "onDone">) {
  const [saving, setSaving] = useState(false);
  const run = async (action: BillAction, successMessage: string) => {
    setSaving(true);
    try {
      const updated = await runBillAction(bill.id, action);
      toast.success(successMessage);
      onDone(updated);
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { saving, run };
}

function BillSummary({ bill }: { bill: Bill }) {
  const client = billParty(bill) ?? "No client";
  return (
    <div className="rounded-md bg-muted/50 p-3 text-sm">
      <p className="font-medium">{client}</p>
      <p className="text-muted-foreground whitespace-pre-line line-clamp-3">{bill.description}</p>
    </div>
  );
}

export function EnterAmountDialog({ bill, onClose, onDone }: DialogProps) {
  const [value, setValue] = useState(bill.amount !== null ? String(bill.amount) : "");
  const { saving, run } = useBillAction({ bill, onDone });
  const amount = Number(value);
  const valid = value !== "" && Number.isFinite(amount) && amount > 0;
  const gst = bill.type === "GST" && valid ? gstAmount(amount) : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enter amount</DialogTitle>
          <DialogDescription>Professional fee for this work, before GST.</DialogDescription>
        </DialogHeader>
        <BillSummary bill={bill} />
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (valid && (await run({ action: "enter_amount", amount }, "Amount saved"))) onClose();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="bill-amount">Fee (₹)</Label>
            <Input
              id="bill-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          {bill.type === "GST" && valid && (
            <div className="text-sm space-y-1 rounded-md border p-3">
              <div className="flex justify-between"><span>Fee</span><span>{formatRupees(amount)}</span></div>
              <div className="flex justify-between"><span>GST @ {GST_RATE_PERCENT}%</span><span>{formatRupees(gst)}</span></div>
              <div className="flex justify-between font-medium border-t pt-1"><span>Total</span><span>{formatRupees(amount + gst)}</span></div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save amount
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RequestAmountDialog({ bill, onClose, onDone }: DialogProps) {
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [userId, setUserId] = useState(bill.amountRequestedFrom?.id || "");
  const { saving, run } = useBillAction({ bill, onDone });

  useEffect(() => {
    axios
      .get("/api/users", { params: { billAmounts: "1" } })
      .then((response) => setUsers(response.data.users || []))
      .catch(() => toast.error("Could not load partners"));
  }, []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send for amount</DialogTitle>
          <DialogDescription>
            The partner or admin you choose will see this bill on their dashboard and enter the amount. Only
            partners Admin has allowed to enter amounts are listed.
          </DialogDescription>
        </DialogHeader>
        <BillSummary bill={bill} />
        <div className="space-y-2">
          <Label>Send to</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger><SelectValue placeholder="Choose a partner or admin" /></SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name} {user.role === "ADMIN" ? "(Admin)" : "(Partner)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!userId || saving}
            onClick={async () => {
              if (await run({ action: "request_amount", userId }, "Sent for amount")) onClose();
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Actions that only need a remark: send back, not billable, Admin's return
export function RemarkDialog({ bill, onClose, onDone, kind }: DialogProps & { kind: keyof typeof REMARK_DIALOGS }) {
  const [remark, setRemark] = useState("");
  const { saving, run } = useBillAction({ bill, onDone });
  const config = REMARK_DIALOGS[kind];
  const valid = !config.required || remark.trim().length >= 3;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <BillSummary bill={bill} />
        <div className="space-y-2">
          <Label htmlFor="bill-remark">Remark{config.required ? "" : " (optional)"}</Label>
          <Textarea id="bill-remark" value={remark} onChange={(e) => setRemark(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={kind === "not_billable" ? "destructive" : "default"}
            disabled={!valid || saving}
            onClick={async () => {
              const action: BillAction =
                kind === "not_billable"
                  ? { action: "not_billable", remark: remark.trim() || undefined }
                  : { action: kind, remark: remark.trim() };
              if (await run(action, config.success)) onClose();
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {config.button}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditDetailsDialog({ bill, onClose, onDone }: DialogProps) {
  const [billTo, setBillTo] = useState<BillTo>({
    client: bill.client,
    other: !bill.client && bill.billToName
      ? { name: bill.billToName, address: bill.billToAddress ?? "", gstin: bill.billToGstin ?? "" }
      : null,
  });
  const [description, setDescription] = useState(bill.description);
  const [workDate, setWorkDate] = useState(format(new Date(bill.workDate), "yyyy-MM-dd"));
  const [remark, setRemark] = useState(bill.remark || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const response = await axios.patch<Bill>(`/api/bills/${bill.id}`, {
        // Leave the bill-to alone if nothing has been chosen yet
        ...(billToValid(billTo) && billToPayload(billTo)),
        description: description.trim(),
        workDate: new Date(`${workDate}T12:00:00`).toISOString(),
        remark: remark.trim() || null,
      });
      toast.success("Bill updated");
      onDone(response.data);
      onClose();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit bill details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Client</Label>
            <BillToPicker value={billTo} onChange={setBillTo} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bill-description">Work done</Label>
            <Textarea id="bill-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bill-date">Date of work</Label>
            <Input id="bill-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bill-edit-remark">Remark</Label>
            <Textarea id="bill-edit-remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || description.trim().length < 3 || !workDate || (!!billTo.other && !billToValid(billTo))}
            onClick={save}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HistoryDialog({ bill, onClose }: Pick<DialogProps, "bill" | "onClose">) {
  const [events, setEvents] = useState<BillEvent[] | null>(null);

  useEffect(() => {
    axios
      .get<{ events: BillEvent[] }>(`/api/bills/${bill.id}`)
      .then((response) => setEvents(response.data.events))
      .catch(() => setEvents([]));
  }, [bill.id]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bill history</DialogTitle>
        </DialogHeader>
        <BillSummary bill={bill} />
        {events === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history available.</p>
        ) : (
          <ol className="space-y-3 max-h-80 overflow-y-auto">
            {events.map((event) => (
              <li key={event.id} className="text-sm border-l-2 pl-3">
                <p className="font-medium">{EVENT_LABELS[event.action] || event.action}</p>
                {event.remark && <p className="whitespace-pre-line">{event.remark}</p>}
                <p className="text-xs text-muted-foreground">
                  {event.user.name} · {format(new Date(event.createdAt), "d MMM yyyy, h:mm a")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
