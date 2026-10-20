import { ImapFlow } from "imapflow";
import { BillEmailStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBillingManagerIds, notifyBillingUsers } from "@/lib/billing";
import { BILLING_EMAIL_ADDRESS, billingEmailConfigured } from "@/lib/bill-email";

// Bill emails have Message-IDs like "<uuid>.bills@gmail.com" (newBillEmailMessageId)

// When a client's mail server refuses a bill email, Gmail sends a "Delivery
// Status Notification" from mailer-daemon to the billing mailbox, often minutes
// or hours after the email was accepted. These are read from the mailbox (IMAP,
// same app password), matched to the email by its Message-ID, and the reason
// is recorded on its bills (see docs/BILLING.md).

const MESSAGE_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bills@[a-z0-9.-]+/gi;

export interface BounceRecipient {
  recipient: string;
  action: "failed" | "delayed";
  status: string | null;
  diagnostic: string | null;
}

export interface ParsedBounce {
  messageIds: string[];
  recipients: BounceRecipient[];
}

// Reads a bounce notice; null if it is not one or not about a bill email
export function parseBounce(raw: string): ParsedBounce | null {
  // Undo quoted-printable soft line breaks and folded header lines
  const text = raw.replace(/=\r?\n/g, "").replace(/\r?\n[ \t]+/g, " ");
  const messageIds = [...new Set((text.match(MESSAGE_ID_PATTERN) ?? []).map((id) => id.toLowerCase()))];
  if (messageIds.length === 0) return null;

  // One block per recipient in the message/delivery-status part
  const recipients: BounceRecipient[] = [];
  for (const block of text.split(/^(?=Final-Recipient:)/im).slice(1)) {
    const field = (name: string) => block.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1].trim() ?? null;
    const action = field("Action")?.toLowerCase();
    if (action !== "failed" && action !== "delayed") continue;
    recipients.push({
      recipient: (field("Final-Recipient") ?? "").replace(/^rfc822;\s*/i, ""),
      action,
      status: field("Status"),
      diagnostic: field("Diagnostic-Code")?.replace(/^smtp;\s*/i, "") ?? null,
    });
  }

  // No delivery-status part: fall back on the subject and the failed-recipients header
  if (recipients.length === 0) {
    const subject = text.match(/^Subject:\s*(.+)$/im)?.[1] ?? "";
    const action = /\(Delay\)|delayed/i.test(subject) ? "delayed" : /\(Failure\)|undeliver|failure|returned/i.test(subject) ? "failed" : null;
    if (!action) return null;
    const failed = text.match(/^X-Failed-Recipients:\s*(.+)$/im)?.[1] ?? "";
    for (const recipient of failed.split(",").map((r) => r.trim()).filter(Boolean)) {
      recipients.push({ recipient, action, status: null, diagnostic: null });
    }
    if (recipients.length === 0) recipients.push({ recipient: "", action, status: null, diagnostic: null });
  }
  return { messageIds, recipients };
}

// The reason in plain words, from the status code (e.g. 5.1.1) or the server's text
export function bounceReason(r: Pick<BounceRecipient, "action" | "status" | "diagnostic">): string {
  if (r.action === "delayed") {
    return "The recipient's mail server is not accepting it yet. Gmail keeps trying for up to 2 days";
  }
  const status = r.status ?? r.diagnostic?.match(/\b([45]\.\d{1,3}\.\d{1,3})\b/)?.[1] ?? "";
  const text = r.diagnostic ?? "";
  if (status === "5.1.1" || /does not exist|user unknown|no such user|unknown user|recipient not found|address rejected|invalid recipient/i.test(text)) {
    return "The email address does not exist";
  }
  if (status === "5.1.2" || /NXDOMAIN|domain .*(not found|does not exist)|couldn't be found|host not found|no mx/i.test(text)) {
    return "The email domain does not exist (check the part after @)";
  }
  if (status === "5.2.2" || /quota|mailbox (is )?full|storage/i.test(text)) return "The recipient's mailbox is full";
  if (status === "5.2.1" || /disabled|inactive|suspended/i.test(text)) return "The recipient's mailbox is disabled";
  if (status === "5.3.4" || status === "5.2.3" || /too large|size limit/i.test(text)) {
    return "The email was too large for the recipient's mail server";
  }
  if (status.startsWith("5.7") || /spam|blocked|block list|blacklist|policy|denied|not authorized/i.test(text)) {
    return "The recipient's mail server refused it (blocked as spam or by its rules)";
  }
  if (status.startsWith("5.4") || /timed out|unreachable|connection refused/i.test(text)) {
    return "The recipient's mail server could not be reached";
  }
  return "The email could not be delivered";
}

const STATUS_RANK: Record<BillEmailStatus, number> = { sent: 0, delayed: 1, failed: 2 };

// Records one bounce notice on the bills of the email it is about. Returns how
// many bills changed. Safe to run twice for the same notice.
export async function applyBounce(bounce: ParsedBounce, receivedAt: Date): Promise<number> {
  const status: BillEmailStatus = bounce.recipients.some((r) => r.action === "failed") ? "failed" : "delayed";
  const relevant = bounce.recipients.filter((r) => r.action === status);
  const reason = relevant.map((r) => `${bounceReason(r)}${r.recipient ? ` – ${r.recipient}` : ""}`).join("; ");
  const details = relevant.map((r) => [r.recipient, r.status, r.diagnostic].filter(Boolean).join(" ")).join("\n");

  let changed = 0;
  for (const messageId of bounce.messageIds) {
    // The "emailed" history entries of this email: its bills and who sent it
    const sentEvents = await prisma.billEvent.findMany({
      where: { action: "emailed", details: { path: ["messageId"], equals: messageId } },
      select: { billId: true, userId: true },
    });
    if (sentEvents.length === 0) continue;
    const sentById = sentEvents[0].userId;
    const bills = await prisma.bill.findMany({
      where: { id: { in: sentEvents.map((e) => e.billId) } },
      select: { id: true, company: true, billNumber: true, emailMessageId: true, emailStatus: true, emailError: true, client: { select: { companyName: true, contactPerson: true } }, billToName: true },
    });

    const notify: typeof bills = [];
    for (const bill of bills) {
      const isLatest = bill.emailMessageId === messageId;
      const current = bill.emailStatus ?? "sent";
      // Already recorded, or a delay reported after the failure
      if (isLatest && (STATUS_RANK[status] < STATUS_RANK[current] || (current === status && bill.emailError === reason))) continue;
      const action = status === "failed" ? "email_failed" : "email_delayed";
      if (!isLatest) {
        // A bounce of an earlier email; the bill has been emailed again since
        const recorded = await prisma.billEvent.count({
          where: { billId: bill.id, action, details: { path: ["messageId"], equals: messageId } },
        });
        if (recorded > 0) continue;
      }

      await prisma.$transaction([
        ...(isLatest
          ? [prisma.bill.update({ where: { id: bill.id }, data: { emailStatus: status, emailError: reason, emailStatusAt: receivedAt } })]
          : []),
        prisma.billEvent.create({
          data: {
            billId: bill.id,
            action,
            userId: sentById,
            remark: isLatest ? reason : `Earlier email: ${reason}`,
            details: { messageId, report: details },
          },
        }),
      ]);
      changed++;
      if (isLatest && status === "failed") notify.push(bill);
    }

    if (notify.length > 0) {
      const party = notify[0].client?.companyName || notify[0].client?.contactPerson || notify[0].billToName || "the party";
      const numbers = notify.map((b) => b.billNumber).join(", ");
      const managerIds = await getBillingManagerIds(notify[0].company);
      await notifyBillingUsers([sentById, ...managerIds], {
        title: "Bill email not delivered",
        content: `The email of bill no. ${numbers} to ${party} was not delivered: ${reason}. Correct the address and email it again from the Billing List.`,
        sentById,
      });
    }
  }
  return changed;
}

export interface DeliveryCheckResult {
  configured: boolean;
  // false when another check ran a moment ago
  checked: boolean;
  updated: number;
  error?: string;
}

// Reads new bounce notices from the billing mailbox. Runs at most once every
// `minIntervalSeconds`, so opening the Billing List repeatedly does not log in
// to Gmail each time.
export async function checkBillEmailDelivery(minIntervalSeconds: number): Promise<DeliveryCheckResult> {
  if (!billingEmailConfigured()) return { configured: false, checked: false, updated: 0 };

  // Claims the check; a second request at the same moment gets count 0
  const now = new Date();
  const { count } = await prisma.billingEmailSetting.updateMany({
    where: {
      id: 1,
      OR: [{ bounceCheckedAt: null }, { bounceCheckedAt: { lt: new Date(now.getTime() - minIntervalSeconds * 1000) } }],
    },
    data: { bounceCheckedAt: now },
  });
  if (count === 0) return { configured: true, checked: false, updated: 0 };
  const settings = await prisma.billingEmailSetting.findUniqueOrThrow({ where: { id: 1 } });

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: BILLING_EMAIL_ADDRESS, pass: process.env.BILLING_EMAIL_PASSWORD! },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  let updated = 0;
  try {
    await client.connect();
    // "All Mail" also holds notices that were archived out of the inbox
    const mailboxes = await client.list();
    const path = mailboxes.find((m) => m.specialUse === "\\All")?.path ?? "INBOX";
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error("Could not open the mailbox");
      const validity = String(mailbox.uidValidity);
      const [savedValidity, savedUid] = (settings.bounceCheckpoint ?? "").split(":");
      const lastUid = savedValidity === validity ? Number(savedUid) || 0 : null;

      // First run (or the mailbox was rebuilt): the last 7 days only
      const found =
        (await client.search(
          lastUid !== null
            ? { from: "mailer-daemon", uid: `${lastUid + 1}:*` }
            : { from: "mailer-daemon", since: new Date(now.getTime() - 7 * 24 * 3600 * 1000) },
          { uid: true }
        )) || [];
      const uids = found.filter((uid) => lastUid === null || uid > lastUid).sort((a, b) => a - b);
      const batch = uids.slice(0, 200);

      if (batch.length > 0) {
        // The notice comes first; a copy of the bill email (with its PDFs) may follow
        const messages = await client.fetchAll(batch, { uid: true, internalDate: true, source: { maxLength: 200_000 } }, { uid: true });
        for (const message of messages) {
          // A server that sends nothing for the partial fetch: fetch the whole message
          const whole = message.source?.length ? null : await client.fetchOne(String(message.uid), { source: true }, { uid: true });
          const source = message.source?.length ? message.source : whole ? whole.source : undefined;
          const bounce = source ? parseBounce(source.toString("utf8")) : null;
          if (bounce) {
            const receivedAt = message.internalDate ? new Date(message.internalDate) : now;
            updated += await applyBounce(bounce, receivedAt);
          }
        }
      }

      // Everything up to here has been read, unless only a first batch was
      const lastRead = uids.length > batch.length ? batch[batch.length - 1] : Math.max(lastUid ?? 0, mailbox.uidNext - 1);
      await prisma.billingEmailSetting.update({
        where: { id: 1 },
        data: { bounceCheckpoint: `${validity}:${lastRead}`, bounceCheckError: null },
      });
    } finally {
      lock.release();
    }
    return { configured: true, checked: true, updated };
  } catch (error) {
    console.error("Failed to check bill email delivery:", error);
    const e = error as { authenticationFailed?: boolean; code?: string };
    const message = e.authenticationFailed
      ? "Gmail refused the login to the billing mailbox. Check that IMAP is on in its Gmail settings and that the app password is correct."
      : "Could not read the billing mailbox to check delivery. It will be tried again.";
    await prisma.billingEmailSetting.update({ where: { id: 1 }, data: { bounceCheckError: message } });
    return { configured: true, checked: true, updated, error: message };
  } finally {
    await client.logout().catch(() => client.close());
  }
}
