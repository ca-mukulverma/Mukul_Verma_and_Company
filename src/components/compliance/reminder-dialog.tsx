"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Download, Loader2, Mail, MessageCircle, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiError } from "./types";
import {
  type ChatMode,
  downloadExtension,
  extensionInstalled,
  type ExtensionJob,
  onExtensionProgress,
  openChat as openWhatsApp,
  saveChatMode,
  savedChatMode,
  sendAllWithExtension,
  stopExtension,
} from "./whatsapp-send";

export interface ReminderTarget {
  clientId: string;
  clientName: string;
  itemIds: string[];
}

interface Result {
  // One per client and person (the responsible person, or the owner too)
  key: string;
  clientId: string;
  name: string;
  ok: boolean;
  error?: string;
  phone?: string;
  text?: string;
}

const MODES: { mode: ChatMode; label: string }[] = [
  { mode: "web", label: "WhatsApp Web (window beside this one)" },
  { mode: "desktop", label: "WhatsApp app on this computer" },
  { mode: "phone", label: "Phone" },
];

// Reminders for one or many clients. WhatsApp: the app prepares one message
// per client and opens each chat in turn (in WhatsApp Web beside the app, the
// WhatsApp desktop app or a phone; you press Send), or the firm's browser
// extension sends them all through WhatsApp Web. Email: sent straight away
// from the company's Gmail.
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
  const [alsoOwner, setAlsoOwner] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const [mode, setMode] = useState<ChatMode>("web");
  const [hasExtension, setHasExtension] = useState(false);
  const [job, setJob] = useState<ExtensionJob | null>(null);

  useEffect(() => {
    setMode(savedChatMode());
    setHasExtension(extensionInstalled());
    return onExtensionProgress(setJob);
  }, []);

  const send = async () => {
    setSending(true);
    try {
      const { data } = await axios.post("/api/compliance/reminders", {
        itemIds: targets.flatMap((t) => t.itemIds),
        channel,
        alsoOwner,
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

  const openChat = (r: Result) => {
    openWhatsApp(mode, r.phone!, r.text ?? "");
    setOpened((o) => [...o, r.key]);
  };
  const chooseMode = (m: ChatMode) => {
    setMode(m);
    saveChatMode(m);
  };
  const next = results?.find((r) => r.ok && r.phone && !opened.includes(r.key));
  const sendable = results?.filter((r) => r.ok && r.phone) ?? [];
  const jobStatus = (key: string) => job?.messages.find((m) => m.key === key);
  const sendAll = () => {
    setJob(null);
    sendAllWithExtension(sendable.map((r) => ({ key: r.key, phone: r.phone!, text: r.text ?? "" })));
    setOpened(sendable.map((r) => r.key));
  };
  const getExtension = async () => {
    try {
      await downloadExtension();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The extension couldn't be downloaded");
    }
  };

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
            <label className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={alsoOwner} onCheckedChange={(c) => setAlsoOwner(c === true)} />
              <span>
                Also send to the owner
                <span className="block text-xs text-muted-foreground">
                  Reminders go to each client&apos;s responsible person. Tick this to send them to the owner as well, where someone else is responsible.
                </span>
              </span>
            </label>
            {targets.length > 1 && (
              <p className="max-h-24 overflow-y-auto text-xs text-muted-foreground">{targets.map((t) => t.clientName).join(", ")}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {channel === "WHATSAPP" && (
              <div className="space-y-2 rounded-md bg-muted/50 p-3 text-sm">
                {sendable.length > 1 && (
                  <div className="space-y-1 border-b pb-2">
                    {hasExtension ? (
                      job && !job.done ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
                            Sending through WhatsApp Web: {job.messages.filter((m) => m.status === "sent").length} of {job.messages.length} sent
                          </span>
                          <Button size="sm" variant="outline" onClick={stopExtension}><Square className="mr-1 h-3 w-3" /> Stop</Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {job
                              ? `${job.note ?? "Finished"}: ${job.messages.filter((m) => m.status === "sent").length} sent, ${job.messages.filter((m) => m.status === "failed").length} not sent.`
                              : "Send all of them through WhatsApp Web, one at a time with a short pause."}
                          </span>
                          <Button size="sm" onClick={sendAll}><Send className="mr-1 h-4 w-4" /> {job ? "Send all again" : `Send all ${sendable.length} automatically`}</Button>
                        </div>
                      )
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        To send them all with one click, install the firm&apos;s WhatsApp extension in Chrome or Edge on this computer:{" "}
                        <button type="button" className="inline-flex items-center gap-0.5 text-primary underline" onClick={getExtension}>
                          <Download className="h-3 w-3" /> download it
                        </button>
                        , unzip it, open chrome://extensions, turn on Developer mode, choose &quot;Load unpacked&quot; and pick the unzipped folder. Then
                        reload this page.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Open chats in</span>
                  <div className="flex flex-wrap gap-1">
                    {MODES.map((m) => (
                      <button
                        key={m.mode}
                        type="button"
                        onClick={() => chooseMode(m.mode)}
                        className={cn("rounded border px-2 py-0.5 text-xs", mode === m.mode ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted")}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                {next ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Next: <b>{next.name}</b></span>
                    <Button size="sm" onClick={() => openChat(next)} autoFocus>
                      <MessageCircle className="mr-1 h-4 w-4" /> Open WhatsApp
                    </Button>
                  </div>
                ) : (
                  <span>All chats opened. Press Send in each WhatsApp chat.</span>
                )}
                {mode === "web" && next && (
                  <p className="text-xs text-muted-foreground">WhatsApp Web opens in a window on the right. Press Enter there to send, then click Open WhatsApp here for the next client.</p>
                )}
              </div>
            )}
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {results.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  {r.ok ? <Check className="h-4 w-4 text-emerald-600" /> : <span className="h-4 w-4 text-center text-red-600">!</span>}
                  <span className="flex-1">
                    {r.name}
                    {!r.ok && <span className="text-red-600"> – {r.error}</span>}
                  </span>
                  {channel === "WHATSAPP" && jobStatus(r.key) && (
                    <span className={cn("text-xs", jobStatus(r.key)!.status === "failed" ? "text-red-600" : "text-muted-foreground")}>
                      {jobStatus(r.key)!.status === "sent" ? "Sent" : jobStatus(r.key)!.status === "failed" ? jobStatus(r.key)!.error ?? "Not sent" : jobStatus(r.key)!.status === "sending" ? "Sending…" : "Waiting"}
                    </span>
                  )}
                  {channel === "WHATSAPP" && r.ok && (
                    <Button size="sm" variant={opened.includes(r.key) ? "ghost" : "outline"} onClick={() => openChat(r)}>
                      {opened.includes(r.key) ? "Open again" : "Open"}
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
