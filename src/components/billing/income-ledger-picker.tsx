"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// The Tally income ledgers (services) bills go to; see Billing → Tally → Services.
// Each firm has its own: MVC bills go to MVC's ledgers, B Edge bills to B Edge's.

export type LedgerFirm = "MVC" | "BEDGE";

export interface IncomeLedger {
  id: string;
  entity: LedgerFirm;
  // false: not under Sales Accounts at the firm's last update from Tally
  inTally: boolean | null;
  name: string;
  groupName: string | null;
  active: boolean;
  billCount: number;
  lastUsedAt: string | null;
}

export interface WorkTypeDefault {
  id: string;
  name: string;
  company: "MVC" | "BEDGE";
  incomeLedgerId: string | null;
  canEdit: boolean;
}

interface LedgerData {
  firms: LedgerFirm[];
  ledgers: IncomeLedger[];
  workTypes: WorkTypeDefault[];
}

// Loaded once per page and shared by every picker on it
let cache: Promise<LedgerData> | null = null;
const listeners = new Set<() => void>();

function fetchLedgers() {
  cache ??= axios
    .get<LedgerData>("/api/billing/tally/income-ledgers")
    .then((r) => r.data)
    .catch((error) => {
      cache = null;
      throw error;
    });
  return cache;
}

// After a change in the list: every picker loads it again
export function reloadIncomeLedgers() {
  cache = null;
  listeners.forEach((listener) => listener());
}

export function useIncomeLedgers() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    fetchLedgers()
      .then((d) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, [load]);
  return { firms: data?.firms ?? null, ledgers: data?.ledgers ?? null, workTypes: data?.workTypes ?? null, failed };
}

const SHOWN = 60;

// A search box over the income ledgers: typing any part of the name or the
// group narrows the list; the most recently used come first
export function IncomeLedgerPicker({
  id,
  value,
  onChange,
  ledgers,
  placeholder = "Search the Tally income ledger…",
  allowNone,
}: {
  id?: string;
  value: string | null;
  onChange: (ledgerId: string | null) => void;
  ledgers: IncomeLedger[];
  placeholder?: string;
  // Offers "No default" (work type defaults)
  allowNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  // Inside a dialog the list must open within the dialog to get typing and clicks
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const selected = ledgers.find((l) => l.id === value) ?? null;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Hidden ledgers, and ledgers no longer in Tally, can't be picked, but the
  // one already chosen stays visible
  const matches = ledgers.filter(
    (l) =>
      ((l.active && l.inTally !== false) || l.id === value) &&
      words.every((w) => l.name.toLowerCase().includes(w) || (l.groupName ?? "").toLowerCase().includes(w))
  );
  const pick = (ledgerId: string | null) => {
    onChange(ledgerId);
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
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : allowNone && value === null ? "No default" : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[20rem] p-0" align="start" container={container}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type to search, e.g. gst, audit, itr" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {ledgers.length === 0
                ? "No income ledgers for this firm yet: they come from its Tally, or load them in Billing → Tally → Services"
                : "No ledger matches. Ledgers are added in Billing → Tally → Services."}
            </CommandEmpty>
            {allowNone && words.length === 0 && (
              <CommandGroup>
                <CommandItem value="__none" onSelect={() => pick(null)}>
                  <span className="truncate text-muted-foreground">No default</span>
                  {value === null && <Check className="ml-auto h-4 w-4" />}
                </CommandItem>
              </CommandGroup>
            )}
            {matches.length > 0 && (
              <CommandGroup>
                {matches.slice(0, SHOWN).map((l) => (
                  <CommandItem key={l.id} value={l.id} onSelect={() => pick(l.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{l.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[l.groupName, !l.active && "hidden", l.inTally === false && "not in Tally", l.billCount > 0 && `${l.billCount} bill${l.billCount === 1 ? "" : "s"}`]
                          .filter(Boolean)
                          .join(" · ") || " "}
                      </span>
                    </span>
                    {value === l.id && <Check className="h-4 w-4" />}
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

// The ledger and the description on its line, as on the amount screen and
// the bill's "Tally ledger" window
export function IncomeLedgerFields({
  entity,
  ledgerId,
  onLedgerChange,
  description,
  onDescriptionChange,
  descriptionPlaceholder,
}: {
  // The bill's firm: only its ledgers are offered
  entity: LedgerFirm;
  ledgerId: string | null;
  onLedgerChange: (id: string | null) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  descriptionPlaceholder: string;
}) {
  const { ledgers: all, failed } = useIncomeLedgers();
  const ledgers = all?.filter((l) => l.entity === entity) ?? null;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-2">
        <Label htmlFor="income-ledger">Tally income ledger (service) – {entity === "BEDGE" ? "B Edge" : "MVC"}</Label>
        {ledgers ? (
          <IncomeLedgerPicker id="income-ledger" value={ledgerId} onChange={onLedgerChange} ledgers={ledgers} />
        ) : (
          <p className="text-sm text-muted-foreground">{failed ? "The ledger list could not be loaded." : "Loading ledgers…"}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="income-ledger-line">Line description in Tally</Label>
        <Input
          id="income-ledger-line"
          value={description}
          maxLength={250}
          placeholder={descriptionPlaceholder}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Left empty, the bill&apos;s work is used.</p>
      </div>
    </div>
  );
}
