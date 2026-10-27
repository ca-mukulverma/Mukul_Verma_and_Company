"use client";

import { useEffect, useId, useState } from "react";
import axios from "axios";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientPhone, PHONE_LABELS, clientPhones } from "@/lib/client-contacts";

// Parts of the client form (create and edit): the owner's mobile numbers, the
// responsible person, the connector and the Tally ledger (see docs/BILLING.md)

export interface ContactsValue {
  phones: ClientPhone[];
  ownerIsResponsible: boolean;
  responsibleName: string;
  responsiblePhone: string;
  responsibleEmail: string;
}

export function emptyContacts(): ContactsValue {
  return {
    phones: [{ number: "", label: "Owner", whatsapp: true }],
    ownerIsResponsible: true,
    responsibleName: "",
    responsiblePhone: "",
    responsibleEmail: "",
  };
}

// From a client as the API returns it
export function contactsOf(client: {
  phone: string | null;
  phones?: unknown;
  ownerIsResponsible?: boolean;
  responsibleName?: string | null;
  responsiblePhone?: string | null;
  responsibleEmail?: string | null;
}): ContactsValue {
  const phones = clientPhones({ phone: client.phone, phones: client.phones });
  return {
    phones: phones.length ? phones : emptyContacts().phones,
    ownerIsResponsible: client.ownerIsResponsible ?? true,
    responsibleName: client.responsibleName ?? "",
    responsiblePhone: client.responsiblePhone ?? "",
    responsibleEmail: client.responsibleEmail ?? "",
  };
}

// What the client API takes
export function contactsPayload(value: ContactsValue) {
  return {
    phones: value.phones.filter((p) => p.number.trim()).map((p) => ({ ...p, number: p.number.trim() })),
    ownerIsResponsible: value.ownerIsResponsible,
    responsibleName: value.ownerIsResponsible ? null : value.responsibleName.trim() || null,
    responsiblePhone: value.ownerIsResponsible ? null : value.responsiblePhone.trim() || null,
    responsibleEmail: value.ownerIsResponsible ? null : value.responsibleEmail.trim() || null,
  };
}

// An error to show before saving, or null
export function contactsProblem(value: ContactsValue): string | null {
  if (!value.ownerIsResponsible && !value.responsibleName.trim()) {
    return "Enter the responsible person's name, or tick that the owner is responsible";
  }
  return null;
}

export function ClientContactsFields({ value, onChange }: { value: ContactsValue; onChange: (v: ContactsValue) => void }) {
  const id = useId();
  const setPhone = (i: number, patch: Partial<ClientPhone>) =>
    onChange({ ...value, phones: value.phones.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Mobile numbers</Label>
        {value.phones.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-40 flex-1"
              placeholder="98260 12345"
              inputMode="tel"
              maxLength={15}
              value={p.number}
              onChange={(e) => setPhone(i, { number: e.target.value })}
            />
            <Select value={p.label} onValueChange={(label) => setPhone(i, { label })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PHONE_LABELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1 text-sm">
              <Checkbox checked={p.whatsapp} onCheckedChange={(c) => setPhone(i, { whatsapp: c === true })} /> WhatsApp
            </label>
            {value.phones.length > 1 && (
              <Button type="button" variant="ghost" size="icon" aria-label="Remove number" onClick={() => onChange({ ...value, phones: value.phones.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {value.phones.length < 10 && (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, phones: [...value.phones, { number: "", label: "Other", whatsapp: false }] })}>
            <Plus className="mr-1 h-4 w-4" /> Add another number
          </Button>
        )}
        <p className="text-xs text-muted-foreground">The first number is the main one. Email or a phone number is required.</p>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <label htmlFor={`${id}-owner`} className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            id={`${id}-owner`}
            checked={value.ownerIsResponsible}
            onCheckedChange={(c) => onChange({ ...value, ownerIsResponsible: c === true })}
          />
          The owner is the responsible person
        </label>
        <p className="text-xs text-muted-foreground">
          Compliance reminders (WhatsApp and email) go to the responsible person. Untick if someone else, e.g. the accountant, handles it.
        </p>
        {!value.ownerIsResponsible && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Responsible person *</Label>
              <Input maxLength={50} value={value.responsibleName} onChange={(e) => onChange({ ...value, responsibleName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">WhatsApp / mobile</Label>
              <Input inputMode="tel" maxLength={15} value={value.responsiblePhone} onChange={(e) => onChange({ ...value, responsiblePhone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input type="email" maxLength={75} value={value.responsibleEmail} onChange={(e) => onChange({ ...value, responsibleEmail: e.target.value })} />
            </div>
            {!value.responsiblePhone.trim() && (
              <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-3">
                Without a WhatsApp number, reminders can&apos;t be sent to them on WhatsApp.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export interface BillingOptions {
  canSetLedger: boolean;
  connectors: { id: string; name: string; ledgerName: string }[];
  ledgerNames: string[];
}

export function useBillingOptions() {
  const [options, setOptions] = useState<BillingOptions | null>(null);
  useEffect(() => {
    axios
      .get<BillingOptions>("/api/clients/billing-options")
      .then(({ data }) => setOptions(data))
      .catch(() => setOptions({ canSetLedger: false, connectors: [], ledgerNames: [] }));
  }, []);
  return options;
}

export interface BillingValue {
  connectorId: string | null;
  tallyLedgerName: string;
}

const NO_CONNECTOR = "none";

export function ClientBillingFields({
  value,
  onChange,
  options,
  clientName,
}: {
  value: BillingValue;
  onChange: (v: BillingValue) => void;
  options: BillingOptions | null;
  clientName: string;
}) {
  const listId = useId();
  if (!options) return null;
  const connector = options.connectors.find((c) => c.id === value.connectorId) ?? null;
  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="space-y-1">
        <Label>Connector</Label>
        <Select value={value.connectorId ?? NO_CONNECTOR} onValueChange={(v) => onChange({ ...value, connectorId: v === NO_CONNECTOR ? null : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CONNECTOR}>None (the client pays directly)</SelectItem>
            {options.connectors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          A connector&apos;s clients are billed in their own name, but the bills go to the connector&apos;s ledger in Tally. Connectors are added in Billing → Connectors.
        </p>
      </div>
      {options.canSetLedger && (
        <div className="space-y-1">
          <Label htmlFor={`${listId}-ledger`}>Tally ledger name</Label>
          {connector ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{connector.ledgerName} <span className="text-muted-foreground">(connector&apos;s ledger)</span></p>
          ) : (
            <>
              <Input
                id={`${listId}-ledger`}
                list={`${listId}-names`}
                maxLength={100}
                placeholder={clientName || "Same as the client's name"}
                value={value.tallyLedgerName}
                onChange={(e) => onChange({ ...value, tallyLedgerName: e.target.value })}
              />
              <datalist id={`${listId}-names`}>
                {options.ledgerNames.map((n) => <option key={n} value={n} />)}
              </datalist>
              <p className="text-xs text-muted-foreground">Pick a ledger already in use or type a new one. Leave empty to use the client&apos;s name.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
