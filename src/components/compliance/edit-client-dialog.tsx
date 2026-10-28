"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BillingValue,
  ClientBillingFields,
  ClientContactsFields,
  ClientRegistrationFields,
  ContactsValue,
  contactsOf,
  contactsPayload,
  contactsProblem,
  emptyContacts,
  useBillingOptions,
} from "@/components/clients/client-extra-fields";
import { RegistrationValues, emptyRegistrations, registrationsOf, registrationsPayload, registrationsProblem } from "@/lib/client-documents";
import { GSTIN_PATTERN } from "@/lib/gst-states";
import { apiError } from "./types";

// Edit a client's details from Compliance → Clients (the same fields as
// Clients → Edit), so a new number, email or registration is saved wherever
// staff notice it. For a party with GSTINs in several states, the name and
// contacts can be copied to the other GSTINs too.

interface Form {
  contactPerson: string;
  companyName: string;
  email: string;
  gstin: string;
  address: string;
  notes: string;
}

export function EditClientDialog({
  clientId,
  otherGstins,
  onClose,
  onSaved,
}: {
  clientId: string;
  // The party's other registrations (other states' GSTINs)
  otherGstins: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [contacts, setContacts] = useState<ContactsValue>(emptyContacts);
  const [registrations, setRegistrations] = useState<RegistrationValues>(emptyRegistrations);
  const [billing, setBilling] = useState<BillingValue>({ connectorId: null, tallyLedgerName: "" });
  const [copyToOthers, setCopyToOthers] = useState(true);
  const [saving, setSaving] = useState(false);
  const billingOptions = useBillingOptions();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    axios
      .get(`/api/clients/${clientId}`)
      .then(({ data }) => {
        setForm({
          contactPerson: data.contactPerson ?? "",
          companyName: data.companyName ?? "",
          email: data.email ?? "",
          gstin: data.gstin ?? "",
          address: data.address ?? "",
          notes: data.notes ?? "",
        });
        setContacts(contactsOf(data));
        setRegistrations(registrationsOf(data));
        setBilling({ connectorId: data.connectorId ?? null, tallyLedgerName: data.tallyLedgerName ?? "" });
      })
      .catch((error) => {
        toast.error(apiError(error, "Could not load the client"));
        close.current();
      });
  }, [clientId]);

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = async () => {
    if (!form) return;
    const contactsData = contactsPayload(contacts);
    const gstin = form.gstin.trim().toUpperCase();
    const problem =
      (form.contactPerson.trim().length < 2 && "Enter the owner's name") ||
      (!form.email.trim() && contactsData.phones.length === 0 && "Enter an email or a phone number") ||
      (gstin && !GSTIN_PATTERN.test(gstin) && "Check the GSTIN: it should look like 27AAACM1234A1Z5") ||
      contactsProblem(contacts) ||
      registrationsProblem(registrations);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const shared = {
        contactPerson: form.contactPerson.trim(),
        companyName: form.companyName.trim() || null,
        email: form.email.trim() || null,
        ...contactsData,
        phone: contactsData.phones[0]?.number ?? null,
      };
      await axios.patch(`/api/clients/${clientId}`, {
        ...shared,
        gstin: gstin || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        ...registrationsPayload(registrations),
        connectorId: billing.connectorId,
        ...(billingOptions?.canSetLedger && { tallyLedgerName: billing.tallyLedgerName.trim() || null }),
      });
      if (copyToOthers) for (const id of otherGstins) await axios.patch(`/api/clients/${id}`, shared);
      toast.success(copyToOthers && otherGstins.length ? `Saved, with the ${otherGstins.length} other GSTIN(s)` : "Saved");
      onSaved();
    } catch (error) {
      toast.error(apiError(error, "Could not save the client"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
          <DialogDescription>The same details as Clients → Edit. Changes show everywhere the client appears.</DialogDescription>
        </DialogHeader>
        {!form ? (
          <Loader2 className="mx-auto my-8 h-6 w-6 animate-spin" />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Owner name *</Label>
                <Input value={form.contactPerson} maxLength={50} onChange={(e) => set({ contactPerson: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Company name</Label>
                <Input value={form.companyName} maxLength={75} onChange={(e) => set({ companyName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={form.email} maxLength={75} placeholder="client@example.com" onChange={(e) => set({ email: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>GSTIN</Label>
                <Input className="uppercase" value={form.gstin} maxLength={15} placeholder="27AAACM1234A1Z5" onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <ClientRegistrationFields value={registrations} onChange={setRegistrations} />
            <ClientContactsFields value={contacts} onChange={setContacts} />
            <ClientBillingFields value={billing} onChange={setBilling} options={billingOptions} clientName={form.companyName || form.contactPerson} />
            <div className="space-y-1">
              <Label>Address</Label>
              <Textarea className="resize-none" value={form.address} maxLength={150} onChange={(e) => set({ address: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>
            {otherGstins.length > 0 && (
              <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <Checkbox checked={copyToOthers} onCheckedChange={(c) => setCopyToOthers(c === true)} />
                <span>
                  Use the same name, email and phone numbers for the party&apos;s {otherGstins.length} other GSTIN(s)
                  <span className="block text-xs text-muted-foreground">Their GSTIN, address, registrations and billing stay as they are.</span>
                </span>
              </label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
