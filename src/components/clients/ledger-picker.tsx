"use client";

import { useRef, useState } from "react";
import { Check, ChevronsUpDown, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface LedgerOption {
  name: string;
  clients: string[]; // clients whose bills go to it
  connector: string | null; // the connector whose ledger it is
}

const SHOWN = 50;

export function ledgerUsers(ledger: LedgerOption) {
  const parts: string[] = [];
  if (ledger.connector) parts.push(`connector ${ledger.connector}`);
  if (ledger.clients.length) {
    parts.push(ledger.clients.slice(0, 2).join(", ") + (ledger.clients.length > 2 ? ` +${ledger.clients.length - 2} more` : ""));
  }
  return parts.join("; ") || "on earlier bills";
}

// The client's Tally party ledger: one already in use, a new name typed in,
// or (empty) the client's own name
export function LedgerPicker({
  id,
  value,
  onChange,
  ledgers,
  clientName,
}: {
  id?: string;
  value: string;
  onChange: (name: string) => void;
  ledgers: LedgerOption[];
  clientName: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  // Inside a dialog the list must open within the dialog to get typing and clicks
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const typed = search.trim();
  const query = typed.toLowerCase();
  const matches = query ? ledgers.filter((l) => l.name.toLowerCase().includes(query) || l.clients.some((c) => c.toLowerCase().includes(query))) : ledgers;
  const exact = ledgers.some((l) => l.name.toLowerCase() === query);
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setContainer(trigger.current?.closest<HTMLElement>("[role=dialog]") ?? null);
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          ref={trigger}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || `Client's name${clientName ? ` (${clientName})` : ""}`}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0" align="start" container={container}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search ledgers or type a new name..." value={search} onValueChange={setSearch} maxLength={100} />
          <CommandList>
            {typed && !exact && (
              <CommandGroup>
                <CommandItem value="__new" onSelect={() => pick(typed)}>
                  <PenLine className="h-4 w-4" />
                  <span className="truncate">
                    Use new ledger &quot;<strong>{typed}</strong>&quot;
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {!typed && (
              <CommandGroup>
                <CommandItem value="__own" onSelect={() => pick("")}>
                  <span className="truncate">Client&apos;s name{clientName ? ` (${clientName})` : ""}</span>
                  {!value && <Check className="ml-auto h-4 w-4" />}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandEmpty>No ledger in use matches</CommandEmpty>
            {matches.length > 0 && (
              <CommandGroup heading="Ledgers already in use">
                {matches.slice(0, SHOWN).map((l) => (
                  <CommandItem key={l.name} value={l.name} onSelect={() => pick(l.name)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{l.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{ledgerUsers(l)}</span>
                    </span>
                    {value === l.name && <Check className="h-4 w-4" />}
                  </CommandItem>
                ))}
                {matches.length > SHOWN && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {matches.length - SHOWN} more – type to narrow the list
                  </p>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
