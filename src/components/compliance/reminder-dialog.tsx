"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Loader2, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiError } from "./types";

export interface ReminderTarget {
  clientId: string;
  clientName: string;
  itemIds: string[];
}

interface Result {
  clientId: string;
  name: string;
  ok: boolean;
  error?: string;
  phone?: string;
  text?: string;
}

// Reminders for one or many clients. WhatsApp: the app prepares one message
// per client and opens each chat in turn (you press Send in WhatsApp). Email:
// sent straight away from the company's Gmail.
export function ReminderDialog({
  targets,
  template,
  onClose,
  onSent,
}: {
  targets: ReminderTarget[];
  // The work's message, with {client}, {period}… still in it
  template: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [message, setMessage] = useState(template ?? "");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [opened, setOpened] = useState<string[]>([]);

  const send = async () => {
    setSending(true);
    try {
      const { data } = await axios.post("/api/compliance/reminders", {
        itemIds: targets.flatMap((t) => t.itemIds),
        channel,
        message: message.trim() && message.trim() !== template?.trim() ? message.trim() : null,
      });
      setResults(data.results);
      onSent();
      if (channel === "EMAIL") {
        const sent = data.results.filter((r: Result) => r.ok).length;
        toast.success(`${sent} email${sent === 1 ? "" : "s"} sent`);
      }
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSending(false);
    }
  };

  // One browser tab named "whatsapp" is reused for every chat
  const openChat = (r: Result) => {
    window.open(`https://wa.me/${r.phone}?text=${encodeURIComponent(r.text ?? "")}`, "whatsapp");
    setOpened((o) => [...o, r.clientId]);
  };
  const next = results?.find((r) => r.ok && r.phone && !opened.includes(r.clientId));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Send reminder{targets.length > 1 ? `s to ${targets.length} clients` : ` to ${targets[0]?.clientName}`}</DialogTitle>
          <DialogDescription>One message per client, covering all of its selected work.</DialogDescription>
        </DialogHeader>

        {!results ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["WHATSAPP", "EMAIL"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-md border p-3 text-sm",
                    channel === c ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
                  )}
                >
                  {c === "WHATSAPP" ? <MessageCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                  {c === "WHATSAPP" ? "WhatsApp (free, you press Send)" : "Email (sent automatically)"}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="reminder-message">Message</Label>
              <Textarea id="reminder-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                {"{client}"}, {"{work}"}, {"{period}"}, {"{due}"}, {"{taxPayable}"} and {"{firm}"} are filled in for each client.
              </p>
            </div>
            {targets.length > 1 && (
              <p className="max-h-24 overflow-y-auto text-xs text-muted-foreground">{targets.map((t) => t.clientName).join(", ")}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {channel === "WHATSAPP" && (
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                {next ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Next: <b>{next.name}</b></span>
                    <Button size="sm" onClick={() => openChat(next)}>
                      <MessageCircle className="mr-1 h-4 w-4" /> Open WhatsApp
                    </Button>
                  </div>
                ) : (
                  <span>All chats opened. Press Send in each WhatsApp chat.</span>
                )}
              </div>
            )}
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {results.map((r) => (
                <li key={r.clientId} className="flex items-center gap-2">
                  {r.ok ? <Check className="h-4 w-4 text-emerald-600" /> : <span className="h-4 w-4 text-center text-red-600">!</span>}
                  <span className="flex-1">
                    {r.name}
                    {!r.ok && <span className="text-red-600"> – {r.error}</span>}
                  </span>
                  {channel === "WHATSAPP" && r.ok && (
                    <Button size="sm" variant={opened.includes(r.clientId) ? "ghost" : "outline"} onClick={() => openChat(r)}>
                      {opened.includes(r.clientId) ? "Open again" : "Open"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{results ? "Done" : "Cancel"}</Button>
          {!results && (
            <Button onClick={send} disabled={sending || targets.length === 0}>
              {sending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {channel === "WHATSAPP" ? "Prepare WhatsApp messages" : `Send ${targets.length} email${targets.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
