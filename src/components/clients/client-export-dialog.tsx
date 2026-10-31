"use client";

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { blobErrorMessage, downloadBillFile } from "@/components/billing/bill-types";

interface ClientOption {
  id: string;
  contactPerson: string;
  companyName: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  isGuest: boolean;
}

// Long lists are cut on screen; search to reach the rest
const SHOWN = 300;

// Admin and partners download the details of every client, or the ones ticked
export function ClientExportDialog() {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<"all" | "selected" | null>(null);

  const load = async () => {
    try {
      const response = await axios.get<{ clients: ClientOption[] }>("/api/clients/export");
      setClients(response.data.clients);
    } catch {
      toast.error("Could not load the clients");
    }
  };

  const matching = useMemo(() => {
    if (!clients) return [];
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return clients;
    return clients.filter((c) => {
      const text = [c.contactPerson, c.companyName, c.gstin, c.email, c.phone].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [clients, search]);

  const allMatchingSelected = matching.length > 0 && matching.every((c) => selected.has(c.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleMatching = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of matching) {
        if (allMatchingSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });

  const download = async (which: "all" | "selected") => {
    setBusy(which);
    try {
      await downloadBillFile({
        method: "post",
        url: "/api/clients/export",
        data: which === "all" ? {} : { ids: [...selected] },
      });
      setOpen(false);
    } catch (error) {
      toast.error(await blobErrorMessage(error, "Could not export the clients"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
        else {
          setSelected(new Set());
          setSearch("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="flex-1">
          <Download className="mr-2 h-4 w-4" />
          <span className="hidden xs:inline">Export to Excel</span>
          <span className="xs:hidden">Export</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export clients to Excel</DialogTitle>
          <DialogDescription>
            Download the details of all clients, or tick the ones you need. The file can be uploaded again in Import from
            Excel.
          </DialogDescription>
        </DialogHeader>

        {!clients ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, company, GSTIN, email or phone"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={allMatchingSelected} onCheckedChange={toggleMatching} disabled={!matching.length} />
                {search ? `Tick all ${matching.length} found` : `Tick all ${clients.length}`}
              </label>
              <span className="text-muted-foreground">
                {selected.size} selected
                {selected.size > 0 && (
                  <Button variant="link" size="sm" className="h-auto px-2" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                )}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              {matching.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">No clients found</p>
              ) : (
                matching.slice(0, SHOWN).map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
                  >
                    <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{c.companyName || c.contactPerson}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[c.companyName ? c.contactPerson : null, c.gstin, c.email || c.phone].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {c.isGuest && <span className="text-xs text-amber-600">Guest</span>}
                  </label>
                ))
              )}
              {matching.length > SHOWN && (
                <p className="p-2 text-center text-xs text-muted-foreground">
                  Showing {SHOWN} of {matching.length}. Search to find the others, or use Tick all.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => download("all")} disabled={!clients?.length || busy !== null}>
            {busy === "all" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Export all {clients?.length ?? ""}
          </Button>
          <Button onClick={() => download("selected")} disabled={selected.size === 0 || busy !== null}>
            {busy === "selected" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Export {selected.size} selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
