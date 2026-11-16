"use client";

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Pencil, Plus, Search, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "./bill-types";
import { IncomeLedger, IncomeLedgerPicker, reloadIncomeLedgers, useIncomeLedgers } from "./income-ledger-picker";

const SHOWN = 100;

// Billing → Tally → Services: the Tally income ledgers bills can go to, and
// the ledger each compliance work type's bills start with
export function TallyServices() {
  const { ledgers, workTypes, failed } = useIncomeLedgers();
  const [search, setSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<IncomeLedger | "new" | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await axios.post<{ added: number; updated: number; unchanged: number; hidden: number; errors: string[] }>(
        "/api/billing/tally/income-ledgers/file",
        form
      );
      toast.success(
        `${data.added} added, ${data.updated} updated, ${data.unchanged} unchanged` + (data.hidden ? ` (${data.hidden} hidden)` : "")
      );
      if (data.errors.length) toast.warning(`Skipped: ${data.errors.slice(0, 3).join("; ")}`);
      reloadIncomeLedgers();
    } catch (error) {
      toast.error(apiErrorMessage(error, "The file could not be loaded"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const toggle = async (ledger: IncomeLedger) => {
    try {
      await axios.patch(`/api/billing/tally/income-ledgers/${ledger.id}`, { active: !ledger.active });
      toast.success(ledger.active ? `${ledger.name} hidden` : `${ledger.name} shown again`);
      reloadIncomeLedgers();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const setDefault = async (workTypeId: string, incomeLedgerId: string | null) => {
    try {
      await axios.put("/api/billing/tally/income-ledgers/work-types", { workTypeId, incomeLedgerId });
      toast.success("Default ledger saved");
      reloadIncomeLedgers();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = (ledgers ?? []).filter(
    (l) =>
      (showHidden || l.active) &&
      words.every((w) => l.name.toLowerCase().includes(w) || (l.groupName ?? "").toLowerCase().includes(w))
  );
  const hiddenCount = (ledgers ?? []).filter((l) => !l.active).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Services (Tally income ledgers)</CardTitle>
        <CardDescription>
          Every bill goes to one of these income ledgers in Tally, with a line description. Names must be exactly as in
          Tally. Hidden ledgers can&apos;t be picked for bills but stay on bills that have them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {failed && <p className="text-sm text-destructive">The ledger list could not be loaded.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search ledgers or groups…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search income ledgers"
            />
          </div>
          {hiddenCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" />Add ledger
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            Load from Excel
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>Load from Excel</strong> takes the mapping sheet (or any sheet with a &quot;Tally income ledger&quot;
          column, and optionally &quot;Tally group&quot; and &quot;Show in app?&quot;). New ledgers are added and groups
          updated; nothing is removed.
        </p>

        {ledgers === null && !failed ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : ledgers && ledgers.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No income ledgers yet. Load the mapping sheet with <strong>Load from Excel</strong>.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto divide-y rounded-md border text-sm">
            {visible.slice(0, SHOWN).map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className={l.active ? "block truncate" : "block truncate text-muted-foreground line-through"}>{l.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{l.groupName ?? "No group"}</span>
                </span>
                {l.billCount > 0 && <Badge variant="secondary">{l.billCount} bill{l.billCount === 1 ? "" : "s"}</Badge>}
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Rename ${l.name}`} onClick={() => setEditing(l)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={l.active ? `Hide ${l.name}` : `Show ${l.name}`}
                  onClick={() => toggle(l)}
                >
                  {l.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-3 text-muted-foreground">No ledger matches.</li>}
            {visible.length > SHOWN && (
              <li className="px-3 py-2 text-xs text-muted-foreground">{visible.length - SHOWN} more – type to narrow the list</li>
            )}
          </ul>
        )}

        {ledgers && workTypes && workTypes.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium">Default ledger for compliance work</p>
            <p className="text-xs text-muted-foreground">
              Bills of completed compliance work start with this ledger and a line like &quot;GSTR-3B - Oct 2026&quot;.
              Both can be changed on each bill; changing a default here applies to bills made afterwards.
            </p>
            <div className="divide-y rounded-md border">
              {workTypes.map((w) => (
                <div key={w.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-[10rem] flex-1 text-sm">
                    {w.name}
                    {w.company === "BEDGE" && <span className="text-xs text-muted-foreground"> · B Edge</span>}
                  </span>
                  <div className="w-full sm:w-80">
                    {w.canEdit ? (
                      <IncomeLedgerPicker
                        value={w.incomeLedgerId}
                        onChange={(id) => id !== w.incomeLedgerId && setDefault(w.id, id)}
                        ledgers={ledgers}
                        allowNone
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {ledgers.find((l) => l.id === w.incomeLedgerId)?.name ?? "No default"}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      {editing && <LedgerDialog ledger={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

// Add a ledger, or rename one (after renaming it in Tally)
function LedgerDialog({ ledger, onClose }: { ledger: IncomeLedger | null; onClose: () => void }) {
  const [name, setName] = useState(ledger?.name ?? "");
  const [group, setGroup] = useState(ledger?.groupName ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const data = { name: name.trim(), groupName: group.trim() || null };
      if (ledger) await axios.patch(`/api/billing/tally/income-ledgers/${ledger.id}`, data);
      else await axios.post("/api/billing/tally/income-ledgers", data);
      toast.success(ledger ? "Ledger saved" : "Ledger added");
      reloadIncomeLedgers();
      onClose();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ledger ? "Rename ledger" : "Add ledger"}</DialogTitle>
          <DialogDescription>
            {ledger
              ? "Use the name exactly as it now is in Tally. Bills not yet in Tally go to the new name; bills already in Tally are not changed there."
              : "The ledger must already exist in Tally, under exactly this name."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="ledger-name">Ledger name in Tally</Label>
            <Input id="ledger-name" autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ledger-group">Group in Tally (optional)</Label>
            <Input id="ledger-group" maxLength={100} value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. Gst" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
