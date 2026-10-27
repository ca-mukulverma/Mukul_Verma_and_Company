"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkType } from "./setup";
import { apiError, currentMonthKey } from "./types";

// After a registration (GST, company, partnership, TAN…) is done, puts the
// client straight into Compliance: the works to track, monthly or quarterly
// (QRMP), and the first period. Monthly RCM/TDS payments are added later on
// the client's compliance page.

// Registration tasks, from their title; their completion opens this dialog
export function isRegistrationTask(title: string) {
  return /regist|incorporat|partnership|\bllp\b|\bgstin?\b|\btan\b|udyam|msme/i.test(title);
}

// Works ticked to begin with, from what was registered
function suggested(title: string, workTypes: WorkType[]) {
  const t = title.toLowerCase();
  const kinds = new Set<string>();
  if (/\bgst|gstin/.test(t)) ["GSTR1", "GSTR3B"].forEach((k) => kinds.add(k));
  if (/\btan\b|\btds\b/.test(t)) ["TDS_PAYMENT", "TDS_RETURN"].forEach((k) => kinds.add(k));
  return workTypes.filter((w) => kinds.has(w.kind)).map((w) => w.id);
}

export function StartComplianceDialog({
  client,
  taskTitle,
  onClose,
}: {
  client: { id: string; name: string };
  taskTitle: string;
  onClose: () => void;
}) {
  const [workTypes, setWorkTypes] = useState<WorkType[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [quarterly, setQuarterly] = useState(false);
  const [startPeriod, setStartPeriod] = useState(currentMonthKey());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  // Loads once, whatever the parent re-renders
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    axios
      .get<{ workTypes: WorkType[] }>("/api/compliance/work-types")
      .then(({ data }) => {
        const active = data.workTypes.filter((w) => w.active);
        setWorkTypes(active);
        setPicked(suggested(taskTitle, active));
      })
      .catch((error) => {
        toast.error(apiError(error, "Could not load compliance work"));
        onCloseRef.current();
      });
  }, [taskTitle]);

  const anyQuarterly = workTypes?.some((w) => picked.includes(w.id) && w.allowQuarterly);

  const save = async () => {
    if (!workTypes) return;
    setSaving(true);
    const problems: string[] = [];
    let added = 0;
    try {
      for (const w of workTypes.filter((w) => picked.includes(w.id))) {
        const frequency = w.allowQuarterly && quarterly ? "QUARTERLY" : w.frequency;
        try {
          const { data } = await axios.post("/api/compliance/subscriptions", { clientIds: [client.id], workTypeId: w.id, frequency, startPeriod });
          added += data.added;
          if (data.skipped.length) problems.push(`${w.name}: ${data.skipped[0].reason}`);
        } catch (error) {
          problems.push(`${w.name}: ${apiError(error)}`);
        }
      }
      if (added) toast.success(`${client.name} added to Compliance (${added} work${added === 1 ? "" : "s"})`);
      for (const p of problems) toast.error(p);
      if (added) setDone(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start compliance for {client.name}?</DialogTitle>
          <DialogDescription>
            The registration is done. Choose the recurring work to track from now on; it appears in the Compliance sheets from the first period.
          </DialogDescription>
        </DialogHeader>
        {!workTypes ? (
          <Loader2 className="mx-auto my-6 h-6 w-6 animate-spin" />
        ) : done ? (
          <div className="space-y-3 text-sm">
            <p>Done. Monthly RCM or TDS payments, fees and past periods can be added on the client&apos;s compliance page.</p>
            <Button asChild size="sm">
              <Link href={`/dashboard/compliance?tab=clients&client=${client.id}`}>Open the client in Compliance</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Work to track</Label>
              <div className="grid gap-1 sm:grid-cols-2">
                {workTypes.map((w) => (
                  <label key={w.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={picked.includes(w.id)}
                      onCheckedChange={(c) => setPicked((p) => (c === true ? [...p, w.id] : p.filter((id) => id !== w.id)))}
                    />
                    {w.name}
                  </label>
                ))}
              </div>
            </div>
            {anyQuarterly && (
              <div className="space-y-1">
                <Label>GST filing</Label>
                <Select value={quarterly ? "QUARTERLY" : "MONTHLY"} onValueChange={(v) => setQuarterly(v === "QUARTERLY")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="QUARTERLY">Quarterly (QRMP)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>First period to track</Label>
              <Input type="month" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} />
              <p className="text-xs text-muted-foreground">Usually the month the registration is effective from.</p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{done ? "Close" : "Not now"}</Button>
          {!done && (
            <Button disabled={saving || !workTypes || picked.length === 0 || !startPeriod} onClick={save}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Add to Compliance
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
