"use client";

import { useState } from "react";
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
import { ClientOption, ClientPicker } from "./client-picker";
import { apiErrorMessage, Bill, BillChanges } from "./bill-types";

export type ChangeKind = "edit" | "cancel" | "reissue";

const COPY: Record<ChangeKind, { title: string; description: string; button: string }> = {
  edit: {
    title: "Request edit",
    description: "The bill keeps its number. Admin must approve the change.",
    button: "Send edit request",
  },
  cancel: {
    title: "Request cancellation",
    description: "The bill number stays in the series, marked cancelled. Admin must approve.",
    button: "Send cancellation request",
  },
  reissue: {
    title: "Request reissue",
    description: "This bill is cancelled and a new bill with a new number is issued. Admin must approve.",
    button: "Send reissue request",
  },
};

// Billing manager asks Admin to edit, cancel or reissue an approved bill.
// Only values that differ from the bill are sent.
export function ChangeRequestDialog({
  bill,
  kind,
  onClose,
  onDone,
}: {
  bill: Bill;
  kind: ChangeKind;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(bill.amount !== null ? String(bill.amount) : "");
  const [description, setDescription] = useState(bill.description);
  const [workDate, setWorkDate] = useState(format(new Date(bill.workDate), "yyyy-MM-dd"));
  const [client, setClient] = useState<ClientOption | null>(bill.client);
  const [type, setType] = useState(bill.type === "GST" || bill.type === "NON_GST" ? bill.type : undefined);
  const [saving, setSaving] = useState(false);

  const changes: BillChanges = {};
  if (kind !== "cancel") {
    const newAmount = Number(amount);
    if (amount !== "" && newAmount > 0 && newAmount !== bill.amount) changes.amount = newAmount;
    if (description.trim() !== bill.description) changes.description = description.trim();
    if (workDate !== format(new Date(bill.workDate), "yyyy-MM-dd")) {
      changes.workDate = new Date(`${workDate}T12:00:00`).toISOString();
    }
    if (kind === "reissue") {
      if (client && client.id !== bill.client?.id) changes.clientId = client.id;
      if (type && type !== bill.type) changes.type = type;
    }
  }

  const amountValid = kind === "cancel" || (amount !== "" && Number(amount) > 0);
  const valid =
    reason.trim().length >= 3 &&
    amountValid &&
    (kind !== "edit" || Object.keys(changes).length > 0) &&
    (kind === "cancel" || description.trim().length >= 3);

  const submit = async () => {
    setSaving(true);
    try {
      await axios.post(`/api/bills/${bill.id}/change-requests`, {
        kind,
        reason: reason.trim(),
        ...(kind !== "cancel" && { changes }),
      });
      toast.success("Request sent to Admin");
      onDone();
      onClose();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{COPY[kind].title} – bill no. {bill.billNumber}</DialogTitle>
          <DialogDescription>{COPY[kind].description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {kind !== "cancel" && (
            <>
              {kind === "reissue" && (
                <>
                  <div className="space-y-2">
                    <Label>Client</Label>
                    <ClientPicker value={client} onChange={setClient} />
                  </div>
                  {bill.company === "MVC" && (
                    <div className="space-y-2">
                      <Label>Bill type</Label>
                      <Select value={type} onValueChange={(value) => setType(value as "GST" | "NON_GST")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GST">GST – MVC & Company</SelectItem>
                          <SelectItem value="NON_GST">Non-GST – CA Mukul Verma</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="change-amount">Fee (₹)</Label>
                <Input
                  id="change-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="change-description">Work done</Label>
                <Textarea id="change-description" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="change-date">Date of work</Label>
                <Input id="change-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="w-auto" />
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="change-reason">Reason*</Label>
            <Textarea id="change-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus={kind === "cancel"} />
          </div>
          {kind === "edit" && Object.keys(changes).length === 0 && (
            <p className="text-sm text-muted-foreground">Change at least one value.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={kind === "cancel" ? "destructive" : "default"} disabled={!valid || saving} onClick={submit}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {COPY[kind].button}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
