"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Command as CommandPrimitive } from "cmdk";
import { Briefcase, ClipboardList, Loader2, Plus, Receipt, Search, User } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useDebounce } from "@/hooks/use-debounce";
import { useLanguage } from "@/components/language-provider";
import { navItems } from "@/components/layouts/nav-config";

interface Hit {
  id: string;
  detail: string;
}
interface Results {
  clients: (Hit & { name: string })[];
  tasks: (Hit & { title: string })[];
  bills: (Hit & { number: string | null; company: string })[];
  users: (Hit & { name: string })[];
}
const EMPTY: Results = { clients: [], tasks: [], bills: [], users: [] };

// Ctrl+K / "/" anywhere: find a client (name, PAN, GSTIN, email, phone), a
// task, a bill number or a colleague, or jump to a page.
export function GlobalSearch({ open, onOpenChange, role }: { open: boolean; onOpenChange: (open: boolean) => void; role: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query.trim(), 250);
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults(EMPTY);
      return;
    }
    let cancelled = false;
    setLoading(true);
    axios
      .get<Results>("/api/search", { params: { q: debounced } })
      .then((response) => !cancelled && setResults(response.data))
      .catch(() => !cancelled && setResults(EMPTY))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const lower = query.trim().toLowerCase();
  const pages = navItems(role).filter((item) => !lower || t(item.title).toLowerCase().includes(lower) || item.title.toLowerCase().includes(lower));
  const isManager = role === "ADMIN" || role === "PARTNER";
  const actions = [
    ...(isManager ? [{ label: t("New task"), href: "/dashboard/tasks/create", shortcut: "N" }] : []),
    { label: t("Log work for billing"), href: "/dashboard/billing?tab=log", shortcut: "" },
  ].filter((a) => !lower || a.label.toLowerCase().includes(lower));
  const nothing =
    !loading &&
    debounced.length >= 2 &&
    !results.clients.length &&
    !results.tasks.length &&
    !results.bills.length &&
    !results.users.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">{t("Search")}</DialogTitle>
        <DialogDescription className="sr-only">{t("Search clients, PAN, GSTIN, tasks, bills…")}</DialogDescription>
        {/* Results come from the server already matched, so cmdk must not filter them again */}
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("Search clients, PAN, GSTIN, tasks, bills…")} autoFocus />
          <CommandList className="max-h-[60vh]">
            {loading && (
              <CommandPrimitive.Loading>
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Searching…
                </div>
              </CommandPrimitive.Loading>
            )}
            {nothing && <CommandEmpty>Nothing found for “{debounced}”.</CommandEmpty>}

            {results.clients.length > 0 && (
              <CommandGroup heading={t("Clients")}>
                {results.clients.map((c) => (
                  <CommandItem key={c.id} value={`client-${c.id}`} onSelect={() => go(`/dashboard/clients/${c.id}`)}>
                    <Briefcase className="text-muted-foreground" />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{c.detail}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.tasks.length > 0 && (
              <CommandGroup heading={t("Tasks")}>
                {results.tasks.map((task) => (
                  <CommandItem key={task.id} value={`task-${task.id}`} onSelect={() => go(`/dashboard/tasks/${task.id}`)}>
                    <ClipboardList className="text-muted-foreground" />
                    <span className="flex-1 truncate">{task.title}</span>
                    <span className="truncate text-xs capitalize text-muted-foreground">{task.detail}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.bills.length > 0 && (
              <CommandGroup heading="Bills">
                {results.bills.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`bill-${b.id}`}
                    onSelect={() => go(`/dashboard/billing?tab=list&q=${encodeURIComponent(b.number ?? "")}`)}
                  >
                    <Receipt className="text-muted-foreground" />
                    <span className="flex-1 truncate">{b.number}</span>
                    <span className="truncate text-xs text-muted-foreground">{b.detail}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.users.length > 0 && (
              <CommandGroup heading={t("Users")}>
                {results.users.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={`user-${u.id}`}
                    onSelect={() => go(role === "ADMIN" ? `/dashboard/admin/users/${u.id}` : `/dashboard/partner/users/${u.id}`)}
                  >
                    <User className="text-muted-foreground" />
                    <span className="flex-1 truncate">{u.name}</span>
                    <span className="truncate text-xs capitalize text-muted-foreground">{u.detail}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {actions.length > 0 && (
              <CommandGroup heading="Quick actions">
                {actions.map((a) => (
                  <CommandItem key={a.href} value={`action-${a.href}`} onSelect={() => go(a.href)}>
                    <Plus className="text-muted-foreground" />
                    {a.label}
                    {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {pages.length > 0 && (
              <CommandGroup heading="Go to">
                {pages.map((item) => (
                  <CommandItem key={item.href} value={`page-${item.href}`} onSelect={() => go(item.href)}>
                    <item.icon className="text-muted-foreground" />
                    {t(item.title)}
                    {item.shortcut && <CommandShortcut>G {item.shortcut.toUpperCase()}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// The search field in the header, which opens the dialog
export function SearchButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center gap-2 rounded-full border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted ${className ?? ""}`}
    >
      <Search className="h-4 w-4" />
      <span className="truncate">{t("Search clients, PAN, GSTIN, tasks, bills…")}</span>
      <kbd className="ml-auto hidden rounded border bg-background px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
    </button>
  );
}
