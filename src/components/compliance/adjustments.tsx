"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { apiError } from "./types";

// Adjustments made in a return, in the staff's own words (docs/COMPLIANCE.md).
// Internal only: never sent to the client.

export interface Adjustment {
  id: string;
  itemId: string;
  body: string;
  followUp: boolean;
  createdAt: string;
  editedAt: string | null;
  author: string | null;
  editedBy: string | null;
  // The author on the day it was written; Admins and Partners at any time
  canChange: boolean;
}

export interface FollowUps {
  period: string;
  adjustments: Adjustment[];
}

export const ADJUSTMENT_MAX = 2000;

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export interface AdjustmentDraft {
  body: string;
  followUp: boolean;
}

export const emptyDraft: AdjustmentDraft = { body: "", followUp: false };

// The text box and the follow-up tick; used when marking a return filed, and
// to add or correct one later
export function AdjustmentFields({
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  value: AdjustmentDraft;
  onChange: (v: AdjustmentDraft) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Textarea
        rows={3}
        maxLength={ADJUSTMENT_MAX}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value.body}
        placeholder="What was adjusted and why, e.g. Invoice 556 of August (₹1,20,000) added this month as the client sent it late; ITC of ₹21,600 taken."
        onChange={(e) => onChange({ ...value, body: e.target.value })}
      />
      <label className="flex items-center gap-2 text-xs">
        <Checkbox checked={value.followUp} disabled={disabled} onCheckedChange={(c) => onChange({ ...value, followUp: c === true })} />
        Follow up in the next period (it is shown again when that period is opened)
      </label>
    </div>
  );
}

const draftPayload = (d: AdjustmentDraft) => ({ body: d.body.trim(), followUp: d.followUp });
export const draftReady = (d: AdjustmentDraft) => d.body.trim().length >= 3;

function AdjustmentRow({
  adjustment,
  readOnly,
  onChanged,
}: {
  adjustment: Adjustment;
  readOnly: boolean;
  onChanged: (list: Adjustment[]) => void;
}) {
  const [editing, setEditing] = useState<AdjustmentDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const { data } = await axios.patch(`/api/compliance/adjustments/${adjustment.id}`, draftPayload(editing));
      onChanged(data.adjustments);
      setEditing(null);
      toast.success("Adjustment saved");
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm("Delete this adjustment? The period's history keeps a line saying it was deleted.")) return;
    setBusy(true);
    try {
      const { data } = await axios.delete(`/api/compliance/adjustments/${adjustment.id}`);
      onChanged(data.adjustments);
      toast.success("Adjustment deleted");
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="space-y-2 rounded-md border p-2">
        <AdjustmentFields value={editing} onChange={setEditing} disabled={busy} autoFocus />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !draftReady(editing)} onClick={save}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="rounded-md border bg-muted/30 p-2 text-sm">
      <p className="whitespace-pre-wrap break-words">{adjustment.body}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          {adjustment.author ?? "Former staff"} · {when(adjustment.createdAt)}
          {adjustment.editedAt ? ` · changed${adjustment.editedBy ? ` by ${adjustment.editedBy}` : ""} ${when(adjustment.editedAt)}` : ""}
        </span>
        {adjustment.followUp && <span className="rounded border border-sky-300 px-1.5 text-sky-800 dark:text-sky-300">Follow up next period</span>}
        {adjustment.canChange && !readOnly && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2" disabled={busy} onClick={() => setEditing({ body: adjustment.body, followUp: adjustment.followUp })}>
              <Pencil className="mr-1 h-3 w-3" /> Change
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-destructive" disabled={busy} onClick={remove}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

export function AdjustmentList({
  adjustments,
  readOnly,
  onChanged,
}: {
  adjustments: Adjustment[];
  readOnly: boolean;
  onChanged: (list: Adjustment[]) => void;
}) {
  return (
    <ul className="space-y-2">
      {adjustments.map((a) => (
        <AdjustmentRow key={a.id} adjustment={a} readOnly={readOnly} onChanged={onChanged} />
      ))}
    </ul>
  );
}

// "+ Add adjustment" for a period, opening the text box in place
export function AddAdjustment({ itemId, onAdded }: { itemId: string; onAdded: (list: Adjustment[]) => void }) {
  const [draft, setDraft] = useState<AdjustmentDraft | null>(null);
  const [busy, setBusy] = useState(false);
  if (!draft) {
    return (
      <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft)}>
        <Plus className="mr-1 h-4 w-4" /> Add adjustment
      </Button>
    );
  }
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`/api/compliance/items/${itemId}/adjustments`, draftPayload(draft));
      onAdded(data.adjustments);
      setDraft(null);
      toast.success("Adjustment saved");
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <AdjustmentFields value={draft} onChange={setDraft} disabled={busy} autoFocus />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !draftReady(draft)} onClick={save}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save adjustment
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Last period's adjustments that were ticked "follow up next period"
export function FollowUpBanner({ followUps }: { followUps: FollowUps }) {
  return (
    <div className="rounded-md border border-sky-300 bg-sky-50 p-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
      <p className="font-medium">To follow up from {followUps.period}:</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {followUps.adjustments.map((a) => (
          <li key={a.id} className="whitespace-pre-wrap break-words">
            {a.body}
            <span className="text-xs opacity-75"> · {a.author ?? "Former staff"}, {when(a.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
