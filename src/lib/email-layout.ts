import { BillType, Company } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BILLING_MAILBOXES } from "@/lib/bill-email";

// One professional layout for every email that goes to a client: reminders,
// documents, GST working, Send to Client and bills. Plain and light on
// purpose (no images or heavy letterhead), as heavily designed mail from a
// Gmail account is more likely to be filed as spam.
//
//   [Firm name]
//   ───────────
//   Dear Mr. Sharma,
//   paragraphs, then titled sections (lines or a table)
//   Thanking you,
//   Yours sincerely,
//   CA Mukul Verma · address · phone · email   (Billing → Company profiles)
//   confidentiality note

export interface EmailTable {
  head: string[];
  rows: string[][];
  // Columns aligned right (amounts)
  right?: number[];
  // A last row in bold, e.g. ["Total", "", "", "₹ 10,000"]
  total?: string[];
}

export interface EmailSection {
  title: string;
  lines?: string[];
  // Numbered instead of plain lines
  numbered?: boolean;
  table?: EmailTable;
}

export interface EmailContent {
  // Who the email is to, e.g. "Shweta Shrivastava"; "Sir/Madam" when unknown
  greetingName?: string | null;
  paragraphs: string[];
  sections?: EmailSection[];
  // Paragraphs after the sections (the staff member's note, links …)
  after?: string[];
}

export interface FirmSignature {
  name: string;
  lines: string[];
}

// The company profile whose contact details sign each mailbox's emails
const SIGNATURE_PROFILE: Record<Company, BillType> = { MVC: "NON_GST", BEDGE: "BEDGE" };

export async function firmSignature(company: Company): Promise<FirmSignature> {
  const name = BILLING_MAILBOXES[company].signature;
  const profile = await prisma.billingEntity
    .findUnique({ where: { type: SIGNATURE_PROFILE[company] }, select: { address: true, phone: true, email: true } })
    .catch(() => null);
  const lines = [
    ...(profile?.address ? profile.address.split("\n").map((l) => l.trim()).filter(Boolean) : []),
    ...(profile?.phone ? [`Phone: ${profile.phone}`] : []),
    `Email: ${profile?.email || BILLING_MAILBOXES[company].address}`,
  ];
  return { name, lines };
}

const CONFIDENTIAL =
  "This email and any attachments are confidential and meant only for the person they are addressed to. If you have received it by mistake, please let us know and delete it.";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Escapes, keeps line breaks and turns https links into links
const richText = (value: string) =>
  escapeHtml(value)
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1a56db;">$1</a>')
    .replace(/\n/g, "<br>");

const P = "margin:0 0 14px 0;";
const CELL = "border:1px solid #d9d9d9;padding:6px 10px;vertical-align:top;";

function tableHtml(table: EmailTable) {
  const align = (i: number) => (table.right?.includes(i) ? "text-align:right;" : "text-align:left;");
  const row = (cells: string[], tag: "td" | "th", bold = false) =>
    `<tr>${cells
      .map((c, i) => `<${tag} style="${CELL}${align(i)}${tag === "th" ? "background:#f5f5f5;" : ""}">${bold ? `<b>${escapeHtml(c)}</b>` : escapeHtml(c)}</${tag}>`)
      .join("")}</tr>`;
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin:0 0 14px 0;">
${row(table.head, "th")}
${table.rows.map((r) => row(r, "td")).join("\n")}
${table.total ? row(table.total, "td", true) : ""}
</table>`;
}

function tableText(table: EmailTable) {
  return [...table.rows, ...(table.total ? [table.total] : [])].map((r) => r.filter(Boolean).join(" | ")).join("\n");
}

export function renderEmail(content: EmailContent, signature: FirmSignature): { html: string; text: string } {
  const greeting = `Dear ${content.greetingName?.trim() || "Sir/Madam"},`;
  const sections = content.sections ?? [];
  const after = (content.after ?? []).filter((p) => p.trim());

  const sectionHtml = (s: EmailSection) => {
    const title = `<p style="margin:0 0 6px 0;"><b>${escapeHtml(s.title)}</b></p>`;
    if (s.table) return title + tableHtml(s.table);
    const lines = s.lines ?? [];
    const list = s.numbered
      ? `<ol style="margin:0 0 14px 0;padding-left:22px;">${lines.map((l) => `<li>${richText(l)}</li>`).join("")}</ol>`
      : `<p style="${P}">${lines.map(richText).join("<br>")}</p>`;
    return title + list;
  };

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:640px;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#222222;">
<p style="margin:0 0 16px 0;padding-bottom:8px;border-bottom:2px solid #1f3a5f;font-size:16px;font-weight:bold;color:#1f3a5f;">${escapeHtml(signature.name)}</p>
<p style="${P}">${escapeHtml(greeting)}</p>
${content.paragraphs.map((p) => `<p style="${P}">${richText(p)}</p>`).join("\n")}
${sections.map(sectionHtml).join("\n")}
${after.map((p) => `<p style="${P}">${richText(p)}</p>`).join("\n")}
<p style="${P}">Thanking you,</p>
<p style="margin:0 0 18px 0;">Yours sincerely,<br><b>${escapeHtml(signature.name)}</b><br><span style="color:#555555;font-size:13px;">${signature.lines
    .map(escapeHtml)
    .join("<br>")}</span></p>
<p style="margin:0;padding-top:8px;border-top:1px solid #e5e5e5;color:#888888;font-size:11px;">${escapeHtml(CONFIDENTIAL)}</p>
</div>
</body></html>`;

  const sectionText = (s: EmailSection) =>
    `${s.title}\n` +
    (s.table ? tableText(s.table) : (s.lines ?? []).map((l, i) => (s.numbered ? `${i + 1}. ${l}` : l)).join("\n"));
  const text = [
    greeting,
    ...content.paragraphs,
    ...sections.map(sectionText),
    ...after,
    "Thanking you,",
    ["Yours sincerely,", signature.name, ...signature.lines].join("\n"),
    "--",
    CONFIDENTIAL,
  ].join("\n\n");

  return { html, text };
}

export async function composeEmail(company: Company, content: EmailContent) {
  return renderEmail(content, await firmSignature(company));
}

// Subjects read the same everywhere: "GSTR-3B for Sep 2026 – CITY MOTORS | CA Mukul Verma"
export function emailSubject(what: string, party: string | null, company: Company) {
  return `${what}${party ? ` – ${party}` : ""} | ${BILLING_MAILBOXES[company].signature}`;
}
