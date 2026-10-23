"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiErrorMessage } from "./bill-types";

interface EmailSettingsData {
  mailboxes: {
    company: string;
    name: string;
    address: string;
    passwordVariable: string;
    contactAddress: string | null;
    configured: boolean;
  }[];
  allowReplies: boolean;
  replyTo: string | null;
  copyTo: string | null;
  bounceCheckedAt: string | null;
  bounceCheckError: string | null;
}

// Admin decides whether clients can reply to bill emails, and who gets a copy
export function EmailSettings() {
  const [settings, setSettings] = useState<EmailSettingsData | null>(null);
  const [allowReplies, setAllowReplies] = useState(false);
  const [replyTo, setReplyTo] = useState("");
  const [copyTo, setCopyTo] = useState("");
  const [saving, setSaving] = useState(false);

  const apply = (data: EmailSettingsData) => {
    setSettings(data);
    setAllowReplies(data.allowReplies);
    setReplyTo(data.replyTo ?? "");
    setCopyTo(data.copyTo ?? "");
  };

  useEffect(() => {
    axios
      .get<EmailSettingsData>("/api/billing/email-settings")
      .then((response) => apply(response.data))
      .catch((error) => toast.error(apiErrorMessage(error, "Could not load email settings")));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const response = await axios.put<EmailSettingsData>("/api/billing/email-settings", {
        allowReplies,
        replyTo: replyTo.trim() || null,
        copyTo: copyTo.trim() || null,
      });
      apply(response.data);
      toast.success("Email settings saved");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  const addresses = settings.mailboxes.map((m) => m.address).join(" and ");
  // The switch only matters for a mailbox clients are asked not to write to
  const noReplyMailbox = settings.mailboxes.find((m) => m.contactAddress);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Bill emails</CardTitle>
        <CardDescription>
          Approved bills are emailed to clients with the bills attached as PDFs. Billing managers, Admin and partners
          allowed to see the Billing List can send them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1 text-sm">
          {settings.mailboxes.map((m) => (
            <p key={m.company}>
              {m.company === "BEDGE" ? "B Edge" : "MVC"} bills: from{" "}
              <span className="font-medium">{m.name}</span> &lt;{m.address}&gt;;{" "}
              {m.contactAddress ? `clients write to ${m.contactAddress}` : "clients can reply to it"}
            </p>
          ))}
        </div>
        {settings.mailboxes
          .filter((m) => !m.configured)
          .map((m) => (
            <div
              key={m.company}
              className="flex gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                Not set up yet: add a Gmail app password for {m.address} to the server as {m.passwordVariable}. Until
                then {m.company === "BEDGE" ? "B Edge" : "MVC"} bills can&apos;t be emailed.
              </p>
            </div>
          ))}

        {noReplyMailbox && (
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="allow-replies">Clients can reply to the B Edge mailbox</Label>
              <p className="text-sm text-muted-foreground">
                {allowReplies
                  ? "Replies go to the address below, or to the billing mailbox if it is empty."
                  : "Off: the email asks clients not to write to the billing mailbox and, in case of any problem, to write to the company's contact address above. A client who still clicks Reply reaches the billing mailbox, so forward that mailbox to the contact address in Gmail."}
              </p>
            </div>
            <Switch id="allow-replies" checked={allowReplies} onCheckedChange={setAllowReplies} />
          </div>
        )}

        {noReplyMailbox && allowReplies && (
          <div className="space-y-2">
            <Label htmlFor="reply-to">Send replies to</Label>
            <Input
              id="reply-to"
              type="email"
              placeholder="the billing mailbox"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="copy-to">Send a hidden copy of every bill email to (optional)</Label>
          <Input
            id="copy-to"
            type="email"
            placeholder="e.g. the office email"
            value={copyTo}
            onChange={(e) => setCopyTo(e.target.value)}
          />
        </div>

        <div className="space-y-1 rounded-md border p-3 text-sm">
          <p className="font-medium">Delivery check</p>
          <p className="text-muted-foreground">
            Failed deliveries are read from the billing mailboxes&apos; bounce notices and shown against the bills. This
            needs IMAP turned on in each of those Gmail accounts (Settings → Forwarding and POP/IMAP → Enable IMAP).
          </p>
          <p className="text-muted-foreground">
            Last checked:{" "}
            {settings.bounceCheckedAt
              ? new Date(settings.bounceCheckedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
              : "never"}
          </p>
          {settings.bounceCheckError && (
            <p className="text-red-700 dark:text-red-400">{settings.bounceCheckError}</p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Clients can still write to {addresses} directly. To keep a mailbox empty, add a Gmail filter
          there that deletes incoming mail, except the bounce notices from mailer-daemon that the delivery check
          reads (see the billing guide).
        </p>

        <div className="flex justify-end">
          <Button disabled={saving} onClick={save}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
