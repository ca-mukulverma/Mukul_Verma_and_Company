"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
}: {
  value: ClientOption | null;
  onChange: (client: ClientOption) => void;
  disabled?: boolean;
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? clientLabel(value) : "Search for a client"}
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
                <CommandEmpty>No clients found</CommandEmpty>
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
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
