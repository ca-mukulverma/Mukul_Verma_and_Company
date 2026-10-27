import nodemailer from "nodemailer";
import { Company } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BILLING_MAILBOXES, billingEmailConfigured, EmailPurpose, sendFailureReason, senderName } from "@/lib/bill-email";
import { todayIST } from "@/lib/compliance-periods";

// Reminders and documents are emailed from the same Gmail accounts as bills
// (see docs/BILLING.md): MVC work from the MVC mailbox, B Edge work from
// B Edge's, under their own names ("Reminder-CA Mukul Verma",
// "Document-CA Mukul Verma"). A free Gmail account sends about 500 emails a
// day, shared with the bill emails.

export const GMAIL_DAILY_LIMIT = 500;

export function firmName(company: Company) {
  return BILLING_MAILBOXES[company].signature;
}

export interface OutgoingEmail {
  to: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

// Sends the emails over one connection; never throws. Returns, per email,
// null when Gmail accepted it or the reason it failed.
export async function sendComplianceEmails(
  company: Company,
  purpose: Exclude<EmailPurpose, "Billing">,
  emails: OutgoingEmail[]
): Promise<(string | null)[]> {
  const mailbox = BILLING_MAILBOXES[company];
  if (!billingEmailConfigured(company)) {
    return emails.map(() => `The ${mailbox.brand} mailbox is not set up (${mailbox.passwordVariable})`);
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    pool: true,
    auth: { user: mailbox.address, pass: mailbox.password },
  });
  const results: (string | null)[] = [];
  try {
    for (const email of emails) {
      try {
        await transporter.sendMail({
          from: { name: senderName(mailbox, purpose), address: mailbox.address },
          to: email.to,
          subject: email.subject,
          text: email.text,
          html: textToHtml(email.text),
          attachments: email.attachments,
        });
        results.push(null);
      } catch (error) {
        console.error(`Failed to send compliance email to ${email.to.join(", ")}:`, error);
        results.push(sendFailureReason(error));
      }
    }
  } finally {
    transporter.close();
  }
  return results;
}

function textToHtml(text: string) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = escaped.replace(/(https:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${linked.replace(/\n/g, "<br>")}</div>`;
}

// Roughly how many emails went out today from the app (reminders, documents,
// Send to Client and bills), to warn before Gmail's daily limit is reached
export async function emailsSentToday(): Promise<number> {
  // Midnight in India
  const since = new Date(todayIST().getTime() - 330 * 60_000);
  const [reminders, documentEmails, dispatches, billEmails] = await Promise.all([
    prisma.complianceReminder.count({ where: { channel: "EMAIL", sentAt: { gte: since } } }),
    prisma.complianceEvent.count({ where: { action: "documents_emailed", createdAt: { gte: since } } }),
    prisma.clientDispatch.count({ where: { createdAt: { gte: since } } }),
    prisma.billEvent.count({ where: { action: "emailed", createdAt: { gte: since } } }),
  ]);
  return reminders + documentEmails + dispatches + billEmails;
}
