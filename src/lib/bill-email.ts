import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { Company, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BillingAccess } from "@/lib/billing";
import { BillDocument, billFileName, loadBillDocuments } from "@/lib/bill-document";
import { renderBillsPdf } from "@/lib/bill-pdf";
import { formatIndianDate, formatRupees } from "@/lib/billing-constants";

// Approved bills are emailed to the party from the company's billing mailbox,
// a Gmail account signed in with an App Password (see docs/BILLING.md): MVC
// bills from one mailbox, B Edge bills from another. Each party gets one email
// with all of its selected bills attached as PDFs.

export interface BillingMailbox {
  company: Company;
  // The name the email shows as "From"
  name: string;
  address: string;
  password: string | undefined;
  // The server setting that holds the password
  passwordVariable: string;
}

export const BILLING_MAILBOXES: Record<Company, BillingMailbox> = {
  MVC: {
    company: "MVC",
    name: "Billing - CA Mukul Verma",
    address: process.env.BILLING_EMAIL_USER || "billing.camukulverma@gmail.com",
    password: process.env.BILLING_EMAIL_PASSWORD,
    passwordVariable: "BILLING_EMAIL_PASSWORD",
  },
  BEDGE: {
    company: "BEDGE",
    name: "Billing - B Edge",
    address: process.env.BEDGE_BILLING_EMAIL_USER || "billing.bedge@gmail.com",
    password: process.env.BEDGE_BILLING_EMAIL_PASSWORD,
    passwordVariable: "BEDGE_BILLING_EMAIL_PASSWORD",
  },
};

export const BILLING_COMPANIES: Company[] = ["MVC", "BEDGE"];

// "Billing - CA Mukul Verma <billing.camukulverma@gmail.com>"
export const mailboxLabel = (mailbox: BillingMailbox) => `${mailbox.name} <${mailbox.address}>`;

export function billingEmailConfigured(company: Company) {
  return !!BILLING_MAILBOXES[company].password;
}

// Where clients should write instead of the billing mailbox. While replies
// are off, it is also the email's Reply-To (a Reply-To that cannot receive
// mail makes Gmail and other providers treat the email as spam).
export const BILLING_CONTACT_ADDRESS = "camukulverma@gmail.com";

// The brand an email goes out under when its bills come from more than one
// entity of the same company
const COMPANY_SENDERS: Record<Company, string> = { MVC: "MVC & Company", BEDGE: "B Edge" };

// Every bill email gets a Message-ID of this form, so a bounce can be matched
// to it: "<uuid>.bills@gmail.com"
export function newBillEmailMessageId(uuid: string, mailbox: BillingMailbox) {
  return `${uuid}.bills@${mailbox.address.split("@")[1]}`;
}
// Reason for an email Gmail did not accept at all while sending
export function sendFailureReason(error: unknown): string {
  const e = error as { code?: string; responseCode?: number; response?: string; message?: string };
  const response = e.response || e.message || "";
  if (e.code === "EAUTH") return "Gmail refused the billing mailbox's login (check the app password)";
  if (/daily.*limit|5\.4\.5/i.test(response)) return "Gmail's daily sending limit has been reached. Try again tomorrow";
  if (e.code === "EENVELOPE" || e.responseCode === 553 || e.responseCode === 550) {
    return `Gmail refused the address${response ? `: ${response.slice(0, 200)}` : ""}`;
  }
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(e.code ?? "")) return "Could not connect to Gmail. Try again in a while";
  return `The email could not be sent${response ? `: ${response.slice(0, 200)}` : ""}`;
}

export async function getBillEmailSettings() {
  return prisma.billingEmailSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// "a@b.com, c@d.com" → ["a@b.com", "c@d.com"]; null if any address is invalid
export function parseEmailList(input: string): string[] | null {
  const addresses = [...new Set(input.split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (addresses.length === 0 || addresses.length > 5) return null;
  return addresses.every((a) => z.string().email().max(75).safeParse(a).success) ? addresses : null;
}

export interface BillEmailGroup {
  // Same key for the same party, so the browser can give one address per party
  key: string;
  company: Company;
  partyName: string;
  contactPerson: string | null;
  clientId: string | null;
  // The client's saved email, if any
  savedEmail: string | null;
  docs: BillDocument[];
}

// The approved bills among `ids` that the user may email, one group per party
// (and company: MVC and B Edge bills never share an email)
export async function loadBillEmailGroups(ids: string[], access: BillingAccess) {
  const [bills, docs] = await Promise.all([
    prisma.bill.findMany({
      where: { id: { in: ids }, status: "approved", company: { in: access.listCompanies } },
      select: {
        id: true,
        company: true,
        clientId: true,
        billToName: true,
        billToGstin: true,
        client: { select: { contactPerson: true, companyName: true, email: true } },
      },
    }),
    loadBillDocuments(ids, access),
  ]);

  const groups = new Map<string, BillEmailGroup>();
  const sorted = docs
    .filter((doc) => !doc.cancelled)
    .sort((a, b) => a.billDate.getTime() - b.billDate.getTime() || a.billNumber.localeCompare(b.billNumber));
  for (const doc of sorted) {
    const bill = bills.find((b) => b.id === doc.id);
    if (!bill) continue;
    const party = bill.clientId
      ? `client:${bill.clientId}`
      : `other:${(bill.billToName || "").trim().toLowerCase()}:${bill.billToGstin || ""}`;
    const key = `${bill.company}:${party}`;
    const group = groups.get(key) ?? {
      key,
      company: bill.company,
      partyName: doc.client.name,
      contactPerson: bill.client?.contactPerson || null,
      clientId: bill.clientId,
      savedEmail: bill.client?.email?.trim() || null,
      docs: [],
    };
    group.docs.push(doc);
    groups.set(key, group);
  }
  return [...groups.values()];
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// e.g. "20 Oct 2026"
const billDateText = (date: Date) => formatIndianDate(date, "medium");

function numberList(docs: BillDocument[]) {
  const numbers = docs.map((d) => d.billNumber);
  return numbers.length <= 4 ? numbers.join(", ") : `${numbers.slice(0, 3).join(", ")} and ${numbers.length - 3} more`;
}

export interface BillEmailContent {
  subject: string;
  html: string;
  text: string;
}

// The email for one party: a short covering letter, a table of the bills and
// the total, payment details, and who to contact
export function buildBillEmail(group: BillEmailGroup, options: { allowReplies: boolean; note?: string | null }): BillEmailContent {
  const { docs } = group;
  const entities = [...new Set(docs.map((d) => d.entity.name).filter(Boolean))];
  const sender = entities.length === 1 ? entities[0] : COMPANY_SENDERS[group.company];
  // Payment details only when every bill is paid into the same account
  const bank = entities.length === 1 && docs[0].entity.bankAccount ? docs[0].entity : null;
  const contactEntity = docs.find((d) => d.entity.phone || d.entity.email)?.entity;
  const contact = [contactEntity?.phone && `Phone: ${contactEntity.phone}`, contactEntity?.email && `Email: ${contactEntity.email}`]
    .filter(Boolean)
    .join(" | ");
  const total = Math.round(docs.reduce((sum, d) => sum + d.total, 0) * 100) / 100;
  const single = docs.length === 1;
  const first = docs[0];

  const subject = single
    ? `${first.isGst ? "Tax Invoice" : "Bill"} No. ${first.billNumber} dated ${billDateText(first.billDate)} – ${sender}`
    : `${docs.length} bills from ${sender} – Nos. ${numberList(docs)}`;
  const greeting = `Dear ${group.contactPerson || "Sir/Madam"},`;
  const intro = single
    ? `Please find attached our ${first.isGst ? "tax invoice" : "bill"} no. ${first.billNumber} dated ${billDateText(first.billDate)} for the professional services rendered to ${group.partyName}.`
    : `Please find attached our ${docs.length} bills for the professional services rendered to ${group.partyName}. The details are given below.`;
  const paymentLine = `Kindly arrange the payment at your earliest convenience and quote the bill ${single ? "number" : "numbers"} when making the payment.`;
  const mailbox = BILLING_MAILBOXES[group.company];
  const replyLine = options.allowReplies
    ? "For any query about this bill, please reply to this email."
    : `Please do not send any email to this ID (${mailbox.address}), as it is used only for sending bills. In case of any problem, you may send the mail to ${BILLING_CONTACT_ADDRESS}.`;
  const note = options.note?.trim() || null;
  const bankLines = bank
    ? [
        ["Account name", bank.name],
        ["Bank", [bank.bankName, bank.bankBranch].filter(Boolean).join(", ")],
        ["Account no.", bank.bankAccount],
        ["IFSC", bank.bankIfsc],
      ].filter((row): row is [string, string] => !!row[1])
    : [];

  const cell = "padding:8px 10px;border:1px solid #d9dde3;font-size:13px;";
  const head = `${cell}background:#f3f5f8;text-align:left;font-weight:600;`;
  const rows = docs
    .map(
      (d) => `<tr>
        <td style="${cell}white-space:nowrap;">${escapeHtml(d.billNumber)}</td>
        <td style="${cell}white-space:nowrap;">${billDateText(d.billDate)}</td>
        <td style="${cell}">${escapeHtml(d.description.split("\n")[0])}</td>
        <td style="${cell}text-align:right;white-space:nowrap;">${formatRupees(d.total)}</td>
      </tr>`
    )
    .join("");
  const paragraph = (text: string) => `<p style="margin:0 0 14px;">${escapeHtml(text)}</p>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:14px;line-height:1.55;">
  <div style="background:#ffffff;border:1px solid #e3e6ea;border-radius:6px;padding:28px 24px;">
    <p style="margin:0 0 18px;font-size:18px;font-weight:600;color:#12324f;">${escapeHtml(sender)}</p>
    ${paragraph(greeting)}
    ${paragraph(`Greetings from ${sender}.`)}
    ${paragraph(intro)}
    ${note ? `<p style="margin:0 0 14px;white-space:pre-line;">${escapeHtml(note)}</p>` : ""}
    <table role="presentation" style="border-collapse:collapse;width:100%;margin:4px 0 18px;">
      <thead><tr>
        <th style="${head}">Bill no.</th>
        <th style="${head}">Date</th>
        <th style="${head}">Particulars</th>
        <th style="${head}text-align:right;">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="3" style="${cell}font-weight:600;">Total amount payable</td>
        <td style="${cell}text-align:right;font-weight:600;white-space:nowrap;">${formatRupees(total)}</td>
      </tr></tfoot>
    </table>
    ${paragraph(paymentLine)}
    ${
      bankLines.length > 0
        ? `<table role="presentation" style="border-collapse:collapse;margin:0 0 18px;font-size:13px;">${bankLines
            .map(
              ([label, value]) =>
                `<tr><td style="padding:2px 16px 2px 0;color:#52606d;">${escapeHtml(label)}</td><td style="padding:2px 0;">${escapeHtml(value)}</td></tr>`
            )
            .join("")}</table>`
        : ""
    }
    <p style="margin:0 0 14px;padding:10px 12px;background:#f3f5f8;border-radius:4px;">${escapeHtml(replyLine)}</p>
    ${paragraph("We thank you for your continued trust and look forward to serving you.")}
    <p style="margin:18px 0 0;">Warm regards,<br>Accounts Team<br><strong>${escapeHtml(sender)}</strong>${
      contact ? `<br><span style="color:#52606d;font-size:13px;">${escapeHtml(contact)}</span>` : ""
    }</p>
  </div>
</div>
</body></html>`;

  const text = [
    greeting,
    "",
    `Greetings from ${sender}.`,
    "",
    intro,
    ...(note ? ["", note] : []),
    "",
    ...docs.map((d) => `Bill no. ${d.billNumber} dated ${billDateText(d.billDate)}: ${formatRupees(d.total)}`),
    `Total amount payable: ${formatRupees(total)}`,
    "",
    paymentLine,
    ...(bankLines.length > 0 ? ["", ...bankLines.map(([label, value]) => `${label}: ${value}`)] : []),
    "",
    replyLine,
    "",
    "We thank you for your continued trust and look forward to serving you.",
    "",
    "Warm regards,",
    "Accounts Team",
    sender,
    ...(contact ? [contact] : []),
  ].join("\n");

  return { subject, html, text };
}

export interface BillEmailResult {
  key: string;
  partyName: string;
  to: string[];
  ok: boolean;
  error?: string;
}

// Sends one email per group and records it on each bill. Never throws for a
// failed email; the result says which parties were not sent.
export async function sendBillEmails(
  sends: { group: BillEmailGroup; to: string[] }[],
  options: { note?: string | null; userId: string }
): Promise<BillEmailResult[]> {
  const settings = await getBillEmailSettings();
  // One connection per company's mailbox, opened when first needed
  const transporters = new Map<Company, ReturnType<typeof nodemailer.createTransport>>();
  const transporterFor = (mailbox: BillingMailbox) => {
    let transporter = transporters.get(mailbox.company);
    if (!transporter) {
      transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true,
        auth: { user: mailbox.address, pass: mailbox.password },
      });
      transporters.set(mailbox.company, transporter);
    }
    return transporter;
  };

  const results: BillEmailResult[] = [];
  try {
    for (const { group, to } of sends) {
      const mailbox = BILLING_MAILBOXES[group.company];
      const content = buildBillEmail(group, { allowReplies: settings.allowReplies, note: options.note });
      const billIds = group.docs.map((d) => d.id);
      const emailedTo = to.join(", ").slice(0, 400);
      const messageId = newBillEmailMessageId(randomUUID(), mailbox);
      try {
        await transporterFor(mailbox).sendMail({
          messageId: `<${messageId}>`,
          from: { name: mailbox.name, address: mailbox.address },
          to,
          ...(settings.copyTo && { bcc: settings.copyTo }),
          // Replies off: to the firm's contact address. On: to the reply address, or the billing mailbox
          replyTo: settings.allowReplies ? settings.replyTo || mailbox.address : BILLING_CONTACT_ADDRESS,
          subject: content.subject,
          html: content.html,
          text: content.text,
          // Tells Exchange/Outlook servers not to send out-of-office replies
          headers: { "X-Auto-Response-Suppress": "All" },
          attachments: group.docs.map((doc) => ({
            filename: billFileName(doc, "pdf"),
            content: renderBillsPdf([doc]),
            contentType: "application/pdf",
          })),
        });
      } catch (error) {
        // Not accepted by Gmail at all: recorded on the bills with the reason
        console.error(`Failed to email bills to ${to.join(", ")}:`, error);
        const reason = sendFailureReason(error);
        const now = new Date();
        await prisma.$transaction([
          prisma.bill.updateMany({
            where: { id: { in: billIds } },
            data: { emailedAt: now, emailedTo, emailStatus: "failed", emailError: reason, emailStatusAt: now, emailMessageId: null },
          }),
          prisma.billEvent.createMany({
            data: billIds.map((billId) => ({ billId, action: "email_failed", userId: options.userId, remark: `${reason} – ${emailedTo}` })),
          }),
        ]);
        results.push({ key: group.key, partyName: group.partyName, to, ok: false, error: reason });
        continue;
      }

      const now = new Date();
      await prisma.$transaction([
        prisma.bill.updateMany({
          where: { id: { in: billIds } },
          data: { emailedAt: now, emailedTo, emailStatus: "sent", emailError: null, emailStatusAt: now, emailMessageId: messageId },
        }),
        prisma.billEvent.createMany({
          data: billIds.map((billId) => ({
            billId,
            action: "emailed",
            userId: options.userId,
            remark: `Emailed to ${emailedTo}`,
            // messageId lets a later bounce notice be matched to this email
            details: { to, messageId, billNumbers: group.docs.map((d) => d.billNumber) } as Prisma.InputJsonValue,
          })),
        }),
      ]);
      results.push({ key: group.key, partyName: group.partyName, to, ok: true });
    }
  } finally {
    for (const transporter of transporters.values()) transporter.close();
  }
  return results;
}
