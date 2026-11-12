"use client";

import { useEffect, useId, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientPhone, PHONE_LABELS, clientPhones } from "@/lib/client-contacts";
import { REGISTRATION_FIELDS, RegistrationValues } from "@/lib/client-documents";
import { SavedPersonPicker, responsiblePhoneOf } from "./saved-person-picker";

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

export function ClientContactsFields({
  value,
  onChange,
  clientId,
}: {
  value: ContactsValue;
  onChange: (v: ContactsValue) => void;
  // The client being edited, left out of "Use saved details"
  clientId?: string;
}) {
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
          <SavedPersonPicker
            label="Use a saved owner or responsible person"
            excludeClientId={clientId}
            onPick={(person) =>
              onChange({
                ...value,
                responsibleName: person.name.slice(0, 50),
                responsiblePhone: responsiblePhoneOf(person).slice(0, 15),
                responsibleEmail: person.email ?? "",
              })
            }
          />
        )}
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
const ADD_CONNECTOR = "add";

type ConnectorOption = BillingOptions["connectors"][number];

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
  // Connectors added from this form, until the options are loaded again
  const [added, setAdded] = useState<ConnectorOption[]>([]);
  const [adding, setAdding] = useState(false);
  if (!options) return null;
  const connectors = [...options.connectors, ...added.filter((a) => !options.connectors.some((c) => c.id === a.id))].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const connector = connectors.find((c) => c.id === value.connectorId) ?? null;
  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="space-y-1">
        <Label>Connector</Label>
        <Select
          value={value.connectorId ?? NO_CONNECTOR}
          onValueChange={(v) => {
            if (v === ADD_CONNECTOR) setAdding(true);
            else onChange({ ...value, connectorId: v === NO_CONNECTOR ? null : v });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CONNECTOR}>None (the client pays directly)</SelectItem>
            {connectors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            <SelectItem value={ADD_CONNECTOR} className="font-medium text-primary">+ Add a connector…</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          A connector&apos;s clients are billed in their own name, but the bills go to the connector&apos;s ledger in Tally. Not in the list? Choose
          &quot;Add a connector&quot; to add them here.
        </p>
        <AddConnectorDialog
          open={adding}
          onOpenChange={setAdding}
          canSetLedger={options.canSetLedger}
          onAdded={(c) => {
            setAdded((list) => [...list, c]);
            onChange({ ...value, connectorId: c.id });
          }}
        />
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

// Adds a connector from the client form and picks it for the client
function AddConnectorDialog({
  open,
  onOpenChange,
  canSetLedger,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canSetLedger: boolean;
  onAdded: (c: ConnectorOption) => void;
}) {
  const id = useId();
  const empty = { name: "", phone: "", email: "", tallyLedgerName: "" };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const close = (o: boolean) => {
    if (!o) setForm(empty);
    onOpenChange(o);
  };

  const save = async (e: React.FormEvent) => {
    // The dialog sits inside the client form: don't submit that too
    e.preventDefault();
    e.stopPropagation();
    if (form.name.trim().length < 2) return;
    setSaving(true);
    try {
      const { data } = await axios.post<{ id: string; name: string; ledgerName: string }>("/api/billing/connectors", {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        ...(canSetLedger && { tallyLedgerName: form.tallyLedgerName.trim() || null }),
      });
      onAdded({ id: data.id, name: data.name, ledgerName: data.ledgerName });
      toast.success(`${data.name} added as the connector`);
      close(false);
    } catch (error) {
      const message = axios.isAxiosError(error) ? (error.response?.data as { error?: string } | undefined)?.error : undefined;
      toast.error(message || "Could not add the connector");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a connector</DialogTitle>
            <DialogDescription>They&apos;re added to Billing → Connectors and chosen for this client.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label htmlFor={`${id}-name`}>Name *</Label>
              <Input id={`${id}-name`} autoFocus maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`${id}-phone`}>Mobile</Label>
                <Input id={`${id}-phone`} inputMode="tel" maxLength={15} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-email`}>Email (bills are sent here)</Label>
                <Input id={`${id}-email`} type="email" maxLength={75} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            {canSetLedger && (
              <div className="space-y-1">
                <Label htmlFor={`${id}-ledger`}>Tally ledger name</Label>
                <Input
                  id={`${id}-ledger`}
                  maxLength={100}
                  placeholder={form.name || "Same as the name"}
                  value={form.tallyLedgerName}
                  onChange={(e) => setForm({ ...form, tallyLedgerName: e.target.value })}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || form.name.trim().length < 2}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Add and choose
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// PAN, TAN, CIN, Udyam and IEC, sent to the client on request (Send to Client)
export function ClientRegistrationFields({ value, onChange }: { value: RegistrationValues; onChange: (v: RegistrationValues) => void }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label>Registration numbers</Label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REGISTRATION_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`${id}-${f.key}`} className="text-xs">{f.label}</Label>
            <Input
              id={`${id}-${f.key}`}
              placeholder={f.placeholder}
              maxLength={f.maxLength}
              className="uppercase"
              value={value[f.key]}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value.toUpperCase() })}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Optional. Used when the client asks for their details (Send to Client).</p>
    </div>
  );
}
