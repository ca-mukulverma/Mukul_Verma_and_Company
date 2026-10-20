"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRupees } from "@/lib/billing-constants";
import { apiErrorMessage } from "./bill-types";

// Bills can be emailed this many at a time (the server's limit)
export const MAX_EMAIL_BILLS = 30;

interface EmailPreview {
  configured: boolean;
  sender: string;
  allowReplies: boolean;
  skipped: number;
  groups: {
    key: string;
    partyName: string;
    savedEmail: string | null;
    isClient: boolean;
    bills: { id: string; billNumber: string; total: number }[];
  }[];
}

interface EmailResult {
  key: string;
  partyName: string;
  to: string[];
  ok: boolean;
  error?: string;
}

// Emails approved bills to their parties: one email per party, with all of
// its selected bills attached
export function EmailBillsDialog({ billIds, onClose, onSent }: { billIds: string[]; onClose: () => void; onSent: () => void }) {
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [saveToClient, setSaveToClient] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  // The preview loads once per set of bills, whatever the parent re-renders
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    axios
      .post<EmailPreview>("/api/bills/email", { mode: "preview", ids: billIds })
      .then(({ data }) => {
        setPreview(data);
        setRecipients(Object.fromEntries(data.groups.map((g) => [g.key, g.savedEmail ?? ""])));
        setSaveToClient(new Set(data.groups.filter((g) => g.isClient && !g.savedEmail).map((g) => g.key)));
      })
      .catch((error) => {
        toast.error(apiErrorMessage(error, "Could not prepare the emails"));
        onCloseRef.current();
      });
  }, [billIds]);

  const missing = preview?.groups.filter((g) => !recipients[g.key]?.trim()) ?? [];
  const canSend = !!preview && preview.configured && preview.groups.length > 0 && missing.length === 0 && !sending;

  const send = async () => {
    if (!preview) return;
    setSending(true);
    try {
      const { data } = await axios.post<{ results: EmailResult[] }>("/api/bills/email", {
        mode: "send",
        ids: billIds,
        recipients,
        saveToClient: [...saveToClient],
        note: note.trim() || null,
      });
      const sent = data.results.filter((r) => r.ok);
      const failed = data.results.filter((r) => !r.ok);
      if (sent.length > 0) {
        toast.success(
          sent.length === 1 ? `Emailed to ${sent[0].partyName} (${sent[0].to.join(", ")})` : `${sent.length} emails sent`
        );
      }
      if (failed.length > 0) {
        for (const r of failed) toast.error(`Not sent to ${r.partyName}: ${r.error ?? "the email could not be sent"}`);
      }
      onSent();
      if (failed.length === 0) onClose();
    } catch (error) {
      toast.error(apiErrorMessage(error, "The emails could not be sent"));
    } finally {
      setSending(false);
    }
  };

  const emailCount = preview?.groups.length ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Email {billIds.length === 1 ? "bill" : "bills"} to {emailCount === 1 ? "the party" : "the parties"}</DialogTitle>
          <DialogDescription>
            Each party gets one email with its bills attached as PDFs and a covering letter.
          </DialogDescription>
        </DialogHeader>

        {preview === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            {!preview.configured && (
              <div className="flex gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>Bill emails are not set up yet. Ask Admin to add the billing mailbox&apos;s app password to the server settings.</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              From {preview.sender}.{" "}
              {preview.allowReplies ? "Clients can reply to these emails." : "Clients can't reply to these emails."}
            </p>
            {preview.skipped > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {preview.skipped} selected bill{preview.skipped === 1 ? " is" : "s are"} cancelled and won&apos;t be emailed.
              </p>
            )}
            {preview.groups.length === 0 && (
              <p className="text-sm text-muted-foreground">None of the selected bills can be emailed. Only approved bills can.</p>
            )}

            {preview.groups.map((group) => {
              const total = group.bills.reduce((sum, b) => sum + b.total, 0);
              return (
                <div key={group.key} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium break-words">{group.partyName}</p>
                    <p className="text-sm font-medium whitespace-nowrap">{formatRupees(total)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {group.bills.map((b) => (
                      <Badge key={b.id} variant="secondary" className="font-mono">{b.billNumber}</Badge>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`email-${group.key}`} className="text-xs">Email to</Label>
                    <Input
                      id={`email-${group.key}`}
                      type="text"
                      inputMode="email"
                      placeholder="name@example.com (separate several with commas)"
                      value={recipients[group.key] ?? ""}
                      onChange={(e) => setRecipients({ ...recipients, [group.key]: e.target.value })}
                      className={!recipients[group.key]?.trim() ? "border-amber-500" : undefined}
                    />
                  </div>
                  {group.isClient && !group.savedEmail && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={saveToClient.has(group.key)}
                        onCheckedChange={(checked) => {
                          const next = new Set(saveToClient);
                          if (checked) next.add(group.key);
                          else next.delete(group.key);
                          setSaveToClient(next);
                        }}
                      />
                      Save this address on the client
                    </label>
                  )}
                </div>
              );
            })}

            {preview.groups.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="email-note" className="text-xs">Message (optional, added to {emailCount === 1 ? "the email" : "every email"})</Label>
                <Textarea id="email-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={sending} onClick={onClose}>Cancel</Button>
          <Button disabled={!canSend} onClick={send}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Send {emailCount > 1 ? `${emailCount} emails` : "email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
