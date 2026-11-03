"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkType } from "./setup";
import { apiError, currentMonthKey } from "./types";

// Recurring compliance work chosen while creating a client (Admins and
// Partners). It is set up right after the client is saved, the same way as
// Compliance → Clients → Add work.

export interface ClientWorksValue {
  workTypeIds: string[];
  quarterly: boolean;
  startPeriod: string;
  fees: Record<string, { nonNil: string; nil: string }>;
}

export const emptyClientWorks = (): ClientWorksValue => ({
  workTypeIds: [],
  quarterly: false,
  startPeriod: currentMonthKey(),
  fees: {},
});

const num = (v: string | undefined) => (!v || v.trim() === "" ? null : Number(v));

// Loads the active works once (null while loading or when not allowed)
export function useComplianceWorkTypes(enabled: boolean) {
  const [workTypes, setWorkTypes] = useState<WorkType[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    axios
      .get<{ workTypes: WorkType[] }>("/api/compliance/work-types")
      .then(({ data }) => setWorkTypes(data.workTypes.filter((w) => w.active)))
      .catch(() => setWorkTypes([]));
  }, [enabled]);
  return workTypes;
}

export function ClientWorksFields({
  workTypes,
  value,
  onChange,
}: {
  workTypes: WorkType[];
  value: ClientWorksValue;
  onChange: (value: ClientWorksValue) => void;
}) {
  if (workTypes.length === 0) return null;
  const chosen = workTypes.filter((w) => value.workTypeIds.includes(w.id));
  const set = (patch: Partial<ClientWorksValue>) => onChange({ ...value, ...patch });
  const toggle = (id: string, on: boolean) =>
    set({ workTypeIds: on ? [...value.workTypeIds, id] : value.workTypeIds.filter((x) => x !== id) });
  const fee = (id: string) => value.fees[id] ?? { nonNil: "", nil: "" };
  const setFee = (id: string, patch: Partial<{ nonNil: string; nil: string }>) =>
    set({ fees: { ...value.fees, [id]: { ...fee(id), ...patch } } });

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">Recurring work (Compliance)</p>
        <p className="text-xs text-muted-foreground">Optional. Tick the works to track for this client; they appear in the GST, TDS and Other work sheets.</p>
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        {workTypes.map((w) => (
          <label key={w.id} className="flex cursor-pointer items-center gap-2 rounded p-1 text-sm hover:bg-muted/50">
            <Checkbox checked={value.workTypeIds.includes(w.id)} onCheckedChange={(c) => toggle(w.id, c === true)} />
            {w.name}
          </label>
        ))}
      </div>
      {chosen.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {chosen.some((w) => w.allowQuarterly) && (
              <div className="space-y-1">
                <Label className="text-xs">GST filing frequency</Label>
                <Select value={value.quarterly ? "QUARTERLY" : "MONTHLY"} onValueChange={(v) => set({ quarterly: v === "QUARTERLY" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="QUARTERLY">Quarterly (QRMP)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">First period to track</Label>
              <Input type="month" value={value.startPeriod} onChange={(e) => set({ startPeriod: e.target.value })} />
            </div>
          </div>
          {chosen.some((w) => w.billable) && (
            <div className="space-y-2">
              <Label className="text-xs">Fees (non-nil / nil; empty uses the work&apos;s default)</Label>
              {chosen.filter((w) => w.billable).map((w) => (
                <div key={w.id} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2">
                  <span className="truncate text-sm">{w.name}</span>
                  <Input type="number" min={0} aria-label={`${w.name} fee (non-nil)`} placeholder={w.defaultFeeNonNil !== null ? `${w.defaultFeeNonNil}` : "Non-nil"} value={fee(w.id).nonNil} onChange={(e) => setFee(w.id, { nonNil: e.target.value })} />
                  <Input type="number" min={0} aria-label={`${w.name} fee (nil)`} placeholder={w.defaultFeeNil !== null ? `${w.defaultFeeNil}` : "Nil"} value={fee(w.id).nil} onChange={(e) => setFee(w.id, { nil: e.target.value })} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// What's wrong with the choice, if anything (checked before the client is saved)
export function clientWorksProblem(value: ClientWorksValue): string | null {
  if (value.workTypeIds.length > 0 && !/^\d{4}-\d{2}$/.test(value.startPeriod)) return "Choose the first period to track";
  return null;
}

// Sets up the chosen works for the new client, one at a time so GSTR-1 and
// GSTR-3B are checked against each other. Returns the works added and any
// problems (the client itself is already saved).
export async function saveClientWorks(
  clientId: string,
  workTypes: WorkType[],
  value: ClientWorksValue
): Promise<{ added: string[]; problems: string[] }> {
  const added: string[] = [];
  const problems: string[] = [];
  for (const w of workTypes.filter((w) => value.workTypeIds.includes(w.id))) {
    try {
      const { data } = await axios.post("/api/compliance/subscriptions", {
        clientIds: [clientId],
        workTypeId: w.id,
        frequency: w.allowQuarterly && value.quarterly ? "QUARTERLY" : w.frequency,
        startPeriod: value.startPeriod,
        feeNonNil: num(value.fees[w.id]?.nonNil),
        feeNil: num(value.fees[w.id]?.nil),
      });
      if (data.added) added.push(w.name);
      if (data.skipped?.length) problems.push(`${w.name}: ${data.skipped[0].reason}`);
    } catch (error) {
      problems.push(`${w.name}: ${apiError(error)}`);
    }
  }
  return { added, problems };
}
