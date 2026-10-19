"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Check, ChevronsUpDown, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";

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
    // modal: inside a dialog the list would otherwise not take clicks or typing,
    // because the dialog keeps focus and pointer events to itself
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
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
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
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
                {onOther && (
                  <CommandGroup>
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
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
