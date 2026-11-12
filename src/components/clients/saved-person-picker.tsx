"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Loader2, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "@/hooks/use-debounce";
import type { ClientPhone } from "@/lib/client-contacts";

// An owner or responsible person already saved on another client
export interface SavedPerson {
  key: string;
  name: string;
  phones: ClientPhone[];
  email: string | null;
  clients: string[];
}

// "Use saved details": finds an owner or responsible person of any saved
// client by name or mobile number, so their details are copied rather than
// typed again. An owner can be picked as a responsible person and the other
// way round.
export function SavedPersonPicker({
  onPick,
  label = "Use saved details",
  excludeClientId,
}: {
  onPick: (person: SavedPerson) => void;
  label?: string;
  // The client being edited, left out of the results
  excludeClientId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const [people, setPeople] = useState<SavedPerson[]>([]);
  const [loading, setLoading] = useState(false);
  // Inside a dialog the list must open within the dialog, or typing goes nowhere
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || debounced.trim().length < 2) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    axios
      .get<{ people: SavedPerson[] }>("/api/clients/people", {
        params: { q: debounced.trim(), ...(excludeClientId && { exclude: excludeClientId }) },
      })
      .then((response) => !cancelled && setPeople(response.data.people))
      .catch(() => !cancelled && setPeople([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, open, excludeClientId]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setContainer(trigger.current?.closest<HTMLElement>("[role=dialog]") ?? null);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 text-xs"
          ref={trigger}
        >
          <UserSearch className="mr-1 h-3.5 w-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] p-0" align="start" container={container ?? undefined}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Name or mobile number…" value={search} onValueChange={setSearch} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching…
              </div>
            ) : (
              <CommandEmpty>
                {search.trim().length < 2 ? "Type a name or mobile number of an owner or responsible person" : "No one saved by that name or number"}
              </CommandEmpty>
            )}
            {!loading && people.length > 0 && (
              <CommandGroup heading="Saved owners and responsible persons">
                {people.map((person) => (
                  <CommandItem
                    key={person.key}
                    value={person.key}
                    onSelect={() => {
                      onPick(person);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{person.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[person.phones.map((p) => p.number).join(", "), person.email].filter(Boolean).join(" · ") || "No number or email"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{person.clients.join("; ")}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// The phones of a picked person, as the owner's numbers (the first one is the
// main number)
export function ownerPhonesOf(person: SavedPerson): ClientPhone[] {
  return person.phones.map((p, i) => ({ ...p, label: i === 0 ? "Owner" : p.label }));
}

// The number to use for a picked person as the responsible person: the first
// WhatsApp number, else the first number
export function responsiblePhoneOf(person: SavedPerson): string {
  return (person.phones.find((p) => p.whatsapp) ?? person.phones[0])?.number ?? "";
}
