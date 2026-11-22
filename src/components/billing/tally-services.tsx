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
import { IncomeLedger, IncomeLedgerPicker, LedgerFirm, reloadIncomeLedgers, useIncomeLedgers } from "./income-ledger-picker";

const FIRM_LABELS: Record<LedgerFirm, string> = { MVC: "MVC (Mukul Verma & Co.)", BEDGE: "B Edge" };

const SHOWN = 100;

// Billing → Tally → Services: each firm's Tally income ledgers bills can go
// to (MVC's for MVC bills, B Edge's for B Edge bills), and the ledger each
// compliance work type's bills start with. The MVC billing manager sees MVC's,
// the B Edge billing manager B Edge's, Admin both.
export function TallyServices() {
  const { firms, ledgers: allLedgers, workTypes: allWorkTypes, failed } = useIncomeLedgers();
  const [chosenFirm, setChosenFirm] = useState<LedgerFirm | null>(null);
  const firm: LedgerFirm = chosenFirm && firms?.includes(chosenFirm) ? chosenFirm : (firms?.[0] ?? "MVC");
  const ledgers = allLedgers?.filter((l) => l.entity === firm) ?? null;
  const workTypes = allWorkTypes?.filter((w) => w.company === firm) ?? null;
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
      form.append("entity", firm);
      const { data } = await axios.post<{ added: number; updated: number; unchanged: number; hidden: number; errors: string[] }>(
        "/api/billing/tally/income-ledgers/file",
        form
      );
      toast.success(
        `${FIRM_LABELS[firm]}: ${data.added} added, ${data.updated} updated, ${data.unchanged} unchanged` + (data.hidden ? ` (${data.hidden} hidden)` : "")
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
  const fromTally = (ledgers ?? []).filter((l) => l.inTally === true).length;
  const notInTally = (ledgers ?? []).filter((l) => l.inTally === false).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Services (Tally income ledgers)</CardTitle>
        <CardDescription>
          Every bill goes to one of its firm&apos;s income ledgers in Tally, with a line description: MVC bills (GST and the
          Non-GST names) to MVC&apos;s, B Edge bills to B Edge&apos;s. Names must be exactly as in that firm&apos;s Tally. Hidden
          ledgers can&apos;t be picked for bills but stay on bills that have them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {firms && firms.length > 1 && (
          <div className="flex w-fit items-center gap-1 rounded-lg border p-1" role="radiogroup" aria-label="Firm">
            {firms.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={firm === f}
                onClick={() => setChosenFirm(f)}
                className={
                  firm === f
                    ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                    : "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                }
              >
                {FIRM_LABELS[f]}
              </button>
            ))}
          </div>
        )}
        <p className="rounded-md bg-muted/50 p-3 text-sm">
          <strong>From Tally on its own:</strong> at each update of Debtors from {FIRM_LABELS[firm]}&apos;s Tally PC (11:30, 1:00, 4:00,
          7:00 and Refresh now), the ledgers under Sales Accounts there are added here, with their groups and spelling; a
          ledger no longer in Tally can&apos;t be picked for new bills.{" "}
          {ledgers && (fromTally > 0 ? `${fromTally} ${fromTally === 1 ? "is" : "are"} in its Tally.` : "Nothing has come from Tally yet (it needs the Tally extension 1.3.0 or later on that PC).")}
          {notInTally > 0 && ` ${notInTally} ${notInTally === 1 ? "is" : "are"} no longer in Tally.`}
        </p>
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
            No income ledgers for {FIRM_LABELS[firm]} yet. They come from its Tally at the next update, or load them with{" "}
            <strong>Load from Excel</strong>.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto divide-y rounded-md border text-sm">
            {visible.slice(0, SHOWN).map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className={l.active ? "block truncate" : "block truncate text-muted-foreground line-through"}>{l.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{l.groupName ?? "No group"}</span>
                </span>
                {l.inTally === false && <Badge variant="destructive">Not in Tally</Badge>}
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
            <p className="font-medium">Default ledger for {FIRM_LABELS[firm]} compliance work</p>
            <p className="text-xs text-muted-foreground">
              Bills of completed compliance work start with this ledger and a line like &quot;GSTR-3B - Oct 2026&quot;.
              Both can be changed on each bill; changing a default here applies to bills made afterwards.
            </p>
            <div className="divide-y rounded-md border">
              {workTypes.map((w) => (
                <div key={w.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-[10rem] flex-1 text-sm">{w.name}</span>
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
      {editing && <LedgerDialog firm={firm} ledger={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

// Add a ledger, or rename one (after renaming it in Tally)
function LedgerDialog({ firm, ledger, onClose }: { firm: LedgerFirm; ledger: IncomeLedger | null; onClose: () => void }) {
  const [name, setName] = useState(ledger?.name ?? "");
  const [group, setGroup] = useState(ledger?.groupName ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const data = { name: name.trim(), groupName: group.trim() || null };
      if (ledger) await axios.patch(`/api/billing/tally/income-ledgers/${ledger.id}`, data);
      else await axios.post("/api/billing/tally/income-ledgers", { ...data, entity: firm });
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
          <DialogTitle>{ledger ? "Rename ledger" : `Add ledger – ${FIRM_LABELS[firm]}`}</DialogTitle>
          <DialogDescription>
            {ledger
              ? "Use the name exactly as it now is in Tally. Bills not yet in Tally go to the new name; bills already in Tally are not changed there."
              : `The ledger must already exist in ${FIRM_LABELS[firm]}'s Tally, under exactly this name.`}
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
