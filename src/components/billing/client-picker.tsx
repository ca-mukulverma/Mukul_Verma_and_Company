"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2, PenLine, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "./bill-types";

export interface ClientOption {
  id: string;
  contactPerson: string;
  companyName?: string | null;
}

export function clientLabel(client: ClientOption) {
  return client.companyName ? `${client.companyName} (${client.contactPerson})` : client.contactPerson;
}

// Client search that asks the server as you type, so every client can be found
export function ClientPicker({
  value,
  onChange,
  disabled,
  onOther,
  label,
}: {
  value: ClientOption | null;
  onChange: (client: ClientOption) => void;
  disabled?: boolean;
  // When given, the list ends with "Other – enter the name"
  onOther?: () => void;
  // Shown on the button instead of the client, e.g. the Other name
  label?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [options, setOptions] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);
  // Admins and partners may add clients to the client master
  const { data: session } = useSession();
  const canAddClient = session?.user?.role === "ADMIN" || session?.user?.role === "PARTNER";
  // Name typed in the search when "Add new client" was chosen
  const [adding, setAdding] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Inside a dialog the list must open within the dialog, or the dialog keeps
  // the typing cursor and clicks to itself
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    axios
      .get<{ clients: ClientOption[] }>("/api/clients", { params: { search: debouncedSearch, limit: 20 } })
      .then((response) => {
        if (!cancelled) setOptions(response.data.clients || []);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, open]);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setContainer(trigger.current?.closest<HTMLElement>("[role=dialog]") ?? null);
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !value && !label && "text-muted-foreground")}>
              {label || (value ? clientLabel(value) : "Search for a client")}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" container={container}>
          <Command shouldFilter={false}>
            <CommandInput placeholder="Type a name..." value={search} onValueChange={setSearch} />
            <CommandList>
              {loading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                <>
                  <CommandEmpty>{onOther ? "No saved client found" : "No clients found"}</CommandEmpty>
                  <CommandGroup>
                    {options.map((client) => (
                      <CommandItem
                        key={client.id}
                        value={client.id}
                        onSelect={() => {
                          onChange(client);
                          setOpen(false);
                        }}
                      >
                        <span className="truncate">{clientLabel(client)}</span>
                        {value?.id === client.id && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {(canAddClient || onOther) && (
                    <CommandGroup>
                      {canAddClient && (
                        <CommandItem
                          value="__add__"
                          onSelect={() => {
                            setAdding(search.trim());
                            setOpen(false);
                          }}
                        >
                          <UserPlus className="h-4 w-4" />
                          Add new client{search.trim() ? `: "${search.trim()}"` : ""}
                        </CommandItem>
                      )}
                      {onOther && (
                        <CommandItem
                          value="__other__"
                          onSelect={() => {
                            onOther();
                            setOpen(false);
                          }}
                        >
                          <PenLine className="h-4 w-4" />
                          Other – enter the name
                        </CommandItem>
                      )}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {adding !== null && (
        <AddClientDialog
          initialName={adding}
          onClose={() => setAdding(null)}
          onAdded={(client) => {
            setAdding(null);
            onChange(client);
          }}
        />
      )}
    </>
  );
}

// Adds a client to the client master from billing, then selects it
function AddClientDialog({
  initialName,
  onClose,
  onAdded,
}: {
  initialName: string;
  onClose: () => void;
  onAdded: (client: ClientOption) => void;
}) {
  const [form, setForm] = useState({
    contactPerson: initialName.slice(0, 50),
    companyName: "",
    email: "",
    phone: "",
    address: "",
    gstin: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const gstin = form.gstin.trim().toUpperCase();
  const gstinValid = gstin === "" || /^\d{2}[A-Z0-9]{13}$/.test(gstin);
  const valid =
    form.contactPerson.trim().length > 0 && (form.email.trim() !== "" || form.phone.trim() !== "") && gstinValid;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const response = await axios.post<{ client: ClientOption }>("/api/clients", {
        contactPerson: form.contactPerson.trim(),
        companyName: form.companyName.trim() || undefined,
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        gstin: gstin || undefined,
        isGuest: false,
      });
      toast.success("Client added to the client master");
      onAdded(response.data.client);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not add the client"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add new client</DialogTitle>
          <DialogDescription>
            The client is saved in the client master and selected for this bill.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="new-client-name">Contact person*</Label>
            <Input id="new-client-name" autoFocus maxLength={50} value={form.contactPerson} onChange={set("contactPerson")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-client-company">Company / firm name</Label>
            <Input id="new-client-company" maxLength={75} value={form.companyName} onChange={set("companyName")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="new-client-email">Email</Label>
              <Input id="new-client-email" type="email" maxLength={75} value={form.email} onChange={set("email")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-client-phone">Phone</Label>
              <Input id="new-client-phone" type="tel" maxLength={15} value={form.phone} onChange={set("phone")} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Enter an email or a phone number (or both).</p>
          <div className="space-y-1">
            <Label htmlFor="new-client-address">Address</Label>
            <Textarea id="new-client-address" className="min-h-[60px]" maxLength={150} value={form.address} onChange={set("address")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-client-gstin">GSTIN</Label>
            <Input id="new-client-gstin" maxLength={15} value={form.gstin} onChange={set("gstin")} />
            {!gstinValid && (
              <p className="text-xs text-destructive">GSTIN should be 15 characters starting with the state code</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add client
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface OtherParty {
  name: string;
  address: string;
  gstin: string;
}

export interface BillTo {
  client: ClientOption | null;
  // Set when billing someone who is not a saved client
  other: OtherParty | null;
}

export function billToPayload(value: BillTo) {
  if (value.other) {
    return {
      other: {
        name: value.other.name.trim(),
        address: value.other.address.trim() || null,
        gstin: value.other.gstin.trim().toUpperCase() || null,
      },
    };
  }
  return { clientId: value.client?.id ?? null };
}

export function billToValid(value: BillTo) {
  return value.other ? value.other.name.trim().length >= 2 : !!value.client;
}

// A saved client, or "Other" with the name (and optionally address and GSTIN)
// typed in for work that is not for a saved client
export function BillToPicker({ value, onChange }: { value: BillTo; onChange: (value: BillTo) => void }) {
  const other = value.other;
  const useOther = () => onChange({ client: null, other: other ?? { name: "", address: "", gstin: "" } });
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Bill to" className="inline-flex rounded-md border p-1 gap-1">
        {[
          { key: "client", label: "Saved client", active: !other, onClick: () => onChange({ client: value.client, other: null }) },
          { key: "other", label: "Other (not a saved client)", active: !!other, onClick: useOther },
        ].map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={option.active}
            onClick={option.onClick}
            className={cn(
              "px-3 py-1 text-sm rounded transition-colors",
              option.active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {!other && (
        <ClientPicker
          value={value.client}
          onChange={(client) => onChange({ client, other: null })}
          onOther={useOther}
        />
      )}
      {other && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="other-name">Name to bill*</Label>
            <Input
              id="other-name"
              autoFocus
              placeholder="Person or firm the bill is made out to"
              value={other.name}
              onChange={(e) => onChange({ client: null, other: { ...other, name: e.target.value } })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="other-address">Address (optional)</Label>
            <Textarea
              id="other-address"
              className="min-h-[60px]"
              value={other.address}
              onChange={(e) => onChange({ client: null, other: { ...other, address: e.target.value } })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="other-gstin">GSTIN (optional)</Label>
            <Input
              id="other-gstin"
              value={other.gstin}
              onChange={(e) => onChange({ client: null, other: { ...other, gstin: e.target.value } })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
