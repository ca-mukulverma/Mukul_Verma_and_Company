"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface QuickClient {
  id: string;
  contactPerson: string;
  companyName: string | null;
}

interface Similar extends QuickClient {
  isGuest: boolean;
  why: string[];
}

// Adds a client without leaving the page (Create Task): the few details
// needed now; the rest is filled in later on the client's page. Looks for a
// client that seems to be the same one first, so it isn't added twice.
export function QuickClientDialog({
  initialName,
  onClose,
  onCreated,
}: {
  initialName: string;
  onClose: () => void;
  // The new client, or the existing one chosen instead
  onCreated: (client: QuickClient) => void;
}) {
  // What was typed in the client search starts as the company name
  const [form, setForm] = useState({
    contactPerson: "",
    companyName: initialName.trim(),
    mobile: "",
    whatsapp: true,
    email: "",
    gstin: "",
    pan: "",
    isGuest: false,
  });
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState<Similar[] | null>(null);
  const set = (changes: Partial<typeof form>) => {
    setForm({ ...form, ...changes });
    setSimilar(null);
  };

  const problem = !form.contactPerson.trim()
    ? "Enter the owner's name"
    : !form.mobile.trim() && !form.email.trim()
      ? "Enter a mobile number or an email"
      : form.mobile.trim() && form.mobile.replace(/\D/g, "").length < 10
        ? "Enter the mobile number with 10 digits"
        : null;

  const create = async () => {
    setSaving(true);
    try {
      const mobile = form.mobile.trim();
      const { data } = await axios.post<{ client: QuickClient }>("/api/clients", {
        contactPerson: form.contactPerson.trim(),
        companyName: form.companyName.trim() || undefined,
        email: form.email.trim(),
        phones: mobile ? [{ number: mobile, label: "Owner", whatsapp: form.whatsapp }] : [],
        gstin: form.gstin.trim().toUpperCase() || undefined,
        pan: form.pan.trim().toUpperCase() || null,
        isGuest: form.isGuest,
      });
      toast.success(`${data.client.companyName || data.client.contactPerson} added as a client`);
      onCreated(data.client);
    } catch (error) {
      const message = axios.isAxiosError(error) && typeof error.response?.data?.error === "string" ? error.response.data.error : "The client could not be added";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (problem) return toast.error(problem);
    // Already checked and the user chose to add anyway
    if (similar) return create();
    setSaving(true);
    try {
      const { data } = await axios.get<{ matches: Similar[] }>("/api/clients/similar", {
        params: {
          name: form.contactPerson,
          company: form.companyName,
          phone: form.mobile,
          email: form.email,
          gstin: form.gstin,
          pan: form.pan,
        },
      });
      if (data.matches.length) {
        setSimilar(data.matches);
        setSaving(false);
        return;
      }
    } catch {
      // The check is a help only: go on and add
    }
    await create();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> New client
          </DialogTitle>
          <DialogDescription>
            The details needed now; the rest can be filled in later on the client&apos;s page. You become the client&apos;s manager.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="qc-owner">Owner&apos;s name *</Label>
              <Input id="qc-owner" autoFocus maxLength={50} value={form.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qc-company">Company / firm name</Label>
              <Input id="qc-company" maxLength={75} value={form.companyName} onChange={(e) => set({ companyName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qc-mobile">Mobile</Label>
              <Input id="qc-mobile" inputMode="tel" maxLength={15} placeholder="98260 12345" value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={form.whatsapp} onCheckedChange={(v) => set({ whatsapp: v === true })} /> On WhatsApp
              </label>
            </div>
            <div className="space-y-1">
              <Label htmlFor="qc-email">Email</Label>
              <Input id="qc-email" type="email" maxLength={75} value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qc-gstin">GSTIN</Label>
              <Input id="qc-gstin" maxLength={15} value={form.gstin} onChange={(e) => set({ gstin: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qc-pan">PAN</Label>
              <Input id="qc-pan" maxLength={10} value={form.pan} onChange={(e) => set({ pan: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.isGuest} onCheckedChange={(v) => set({ isGuest: v === true })} />
            Guest client (temporary, for 30 days)
          </label>
          <p className="text-xs text-muted-foreground">* Owner&apos;s name, and a mobile number or an email, are needed.</p>

          {similar && (
            <div className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-50">
              <p className="font-semibold">This may already be a client:</p>
              {similar.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span>
                    {c.companyName ? `${c.companyName} (${c.contactPerson})` : c.contactPerson}
                    {c.isGuest ? " · guest" : ""} <span className="text-xs opacity-80">– {c.why.join(", ")}</span>
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => onCreated(c)}>
                    Use this one
                  </Button>
                </div>
              ))}
              <p className="text-xs">If it is a different client, press &quot;Add as new client&quot; again.</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {similar ? "Add as new client" : "Add client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
