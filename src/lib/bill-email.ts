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
  // Where clients should write instead of the billing mailbox. While replies
  // are off, it is also the email's Reply-To (a Reply-To that cannot receive
  // mail makes Gmail and other providers treat the email as spam).
  contactAddress: string;
  // Who signs the email
  signature: string;
}

export const BILLING_MAILBOXES: Record<Company, BillingMailbox> = {
  MVC: {
    company: "MVC",
    name: "Billing-CA Mukul Verma",
    address: process.env.BILLING_EMAIL_USER || "billing.camukulverma@gmail.com",
    password: process.env.BILLING_EMAIL_PASSWORD,
    passwordVariable: "BILLING_EMAIL_PASSWORD",
    contactAddress: "camukulverma@gmail.com",
    signature: "CA Mukul Verma",
  },
  BEDGE: {
    company: "BEDGE",
    name: "Billing-B Edge",
    address: process.env.BEDGE_BILLING_EMAIL_USER || "billing.bedge@gmail.com",
    password: process.env.BEDGE_BILLING_EMAIL_PASSWORD,
    passwordVariable: "BEDGE_BILLING_EMAIL_PASSWORD",
    contactAddress: "bedgebusinessconsultants@gmail.com",
    signature: "B Edge Business Consultants",
  },
};

export const BILLING_COMPANIES: Company[] = ["MVC", "BEDGE"];

// "Billing-CA Mukul Verma <billing.camukulverma@gmail.com>"
export const mailboxLabel = (mailbox: BillingMailbox) => `${mailbox.name} <${mailbox.address}>`;

export function billingEmailConfigured(company: Company) {
  return !!BILLING_MAILBOXES[company].password;
}

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

// The email for one party: a short, plain note with the bills attached. It is
// kept like an email a person would type (no letterhead layout, styled tables
// or bank details), because the usual invoice-email template is what fake
// invoice spam looks like, and Gmail files emails similar to spam as spam.
export function buildBillEmail(group: BillEmailGroup, options: { allowReplies: boolean; note?: string | null }): BillEmailContent {
  const { docs } = group;
  const mailbox = BILLING_MAILBOXES[group.company];
  const contactEntity = docs.find((d) => d.entity.phone)?.entity;
  const total = Math.round(docs.reduce((sum, d) => sum + d.total, 0) * 100) / 100;
  const single = docs.length === 1;
  const first = docs[0];

  const subject = single
    ? `Bill no. ${first.billNumber} – ${group.partyName}`
    : `Bills for ${group.partyName} – Nos. ${numberList(docs)}`;
  const work = first.description.split("\n")[0].trim().replace(/\.$/, "");
  const greeting = `Dear ${group.contactPerson || "Sir/Madam"},`;
  const intro = single
    ? `Please find attached bill no. ${first.billNumber} dated ${billDateText(first.billDate)} for ${formatRupees(first.total)}${work ? `, for ${work}` : ""}.`
    : `Please find attached ${docs.length} bills for ${group.partyName}, totalling ${formatRupees(total)}:`;
  const billLines = single
    ? []
    : docs.map((d) => `Bill no. ${d.billNumber} dated ${billDateText(d.billDate)} – ${formatRupees(d.total)}`);
  const paymentLine = `The bank details for payment are given on the ${single ? "bill" : "bills"}. Please mention the bill ${single ? "number" : "numbers"} when you make the payment.`;
  const replyLine = options.allowReplies
    ? "For any query about this bill, please reply to this email."
    : `Please do not send any email to this ID (${mailbox.address}), as it is used only for sending bills. In case of any problem, you may send the mail to ${mailbox.contactAddress}.`;
  const note = options.note?.trim() || null;
  const signature = [mailbox.signature, ...(contactEntity?.phone ? [`Phone: ${contactEntity.phone}`] : [])];

  const lines = (items: string[]) => items.map(escapeHtml).join("<br>");
  const paragraph = (html: string) => `<p>${html}</p>`;
  const html = `<!doctype html>
<html><body>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;">
${paragraph(escapeHtml(greeting))}
${paragraph(escapeHtml(intro) + (billLines.length > 0 ? `<br>${lines(billLines)}` : ""))}
${note ? paragraph(lines(note.split("\n"))) : ""}
${paragraph(escapeHtml(paymentLine))}
${paragraph(escapeHtml(replyLine))}
${paragraph("Thank you.")}
${paragraph(`Regards,<br>${lines(signature)}`)}
</div>
</body></html>`;

  const text = [
    greeting,
    "",
    intro,
    ...billLines,
    ...(note ? ["", note] : []),
    "",
    paymentLine,
    "",
    replyLine,
    "",
    "Thank you.",
    "",
    "Regards,",
    ...signature,
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
          // Replies off: to the company's contact address. On: to the reply address, or the billing mailbox
          replyTo: settings.allowReplies ? settings.replyTo || mailbox.address : mailbox.contactAddress,
          subject: content.subject,
          html: content.html,
          text: content.text,
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
