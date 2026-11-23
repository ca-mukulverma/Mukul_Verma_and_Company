import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseEmailList } from "@/lib/bill-email";
import { sendComplianceEmails } from "@/lib/compliance-email";
import { composeEmail, emailSubject } from "@/lib/email-layout";
import { debtorsUser, loadLedger, nameKey, notAllowed, partiesForLedgers } from "@/lib/tally-debtors";
import { amount, asOfText, balance, DAY_RE, ledgerFileName, longDate, statement } from "@/lib/tally-debtors-shared";
import { ledgerExcel, ledgerPdf } from "@/lib/tally-ledger-files";

export const dynamic = "force-dynamic";

const schema = z.object({
  from: z.string().regex(DAY_RE),
  to: z.string().regex(DAY_RE),
  narration: z.boolean().default(false),
  // "a@b.com, c@d.com" (up to 5)
  recipients: z.string().trim().min(3).max(400),
  note: z.string().trim().max(2000).optional().nullable(),
  excel: z.boolean().default(false),
});

// POST /api/debtors/[id]/email – emails the ledger for the period to the party
// as a PDF (and Excel if asked), from the firm's Gmail (MVC's ledgers from the
// MVC mailbox, B Edge's from B Edge's), and records the send
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "Choose a period and an email address" }, { status: 400 });
  const { from, to, narration, note, excel } = parsed.data;
  const recipients = parseEmailList(parsed.data.recipients);
  if (!recipients) return NextResponse.json({ error: "Enter up to 5 valid email addresses, separated by commas" }, { status: 400 });

  const { id } = await params;
  const ledger = await loadLedger(id);
  if (!ledger) return NextResponse.json({ error: "This ledger is no longer in the Tally data" }, { status: 404 });
  if (from < ledger.periodFrom) return NextResponse.json({ error: `Entries are kept from ${ledger.periodFrom}` }, { status: 400 });

  const party = (await partiesForLedgers([nameKey(ledger.name)])).get(nameKey(ledger.name)) ?? null;
  const st = statement(ledger, from, to);
  const input = { company: ledger.company, ledger: ledger.name, statement: st, narration, readAt: ledger.readAt };
  const fileName = ledgerFileName(ledger.name, from, to);
  const attachments = [{ filename: `${fileName}.pdf`, content: ledgerPdf(input), contentType: "application/pdf" }];
  if (excel) {
    attachments.push({ filename: `${fileName}.xlsx`, content: await ledgerExcel(input), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  const period = `${longDate(from)} to ${longDate(to)}`;
  const { html, text } = await composeEmail(ledger.entity, {
    greetingName: party?.name ?? null,
    paragraphs: [`Please find attached your ledger account with ${ledger.company} for ${period}${excel ? ", in PDF and Excel" : ""}.`],
    sections: [
      {
        title: "Summary",
        table: {
          head: ["Particulars", "Amount (Rs.)"],
          rows: [
            ["Opening balance", balance(st.opening)],
            ["Debits in the period", amount(st.totalDr) || "0.00"],
            ["Credits in the period", amount(st.totalCr) || "0.00"],
          ],
          right: [1],
          total: ["Closing balance", balance(st.closing)],
        },
      },
    ],
    after: [
      note ?? "",
      ledger.readAt ? `The balance is as per our books as on ${asOfText(ledger.readAt)}.` : "",
      st.closing > 0
        ? "Kindly arrange the payment of the balance due. If you have already paid, please share the payment details so that we can update our records."
        : "Please let us know if any entry needs a correction.",
    ],
  });

  const [failure] = await sendComplianceEmails(ledger.entity, "Billing", [
    { to: recipients, subject: emailSubject(`Ledger account for ${period}`, ledger.name, ledger.entity), text, html, attachments },
  ]);
  if (failure) return NextResponse.json({ error: `The email was not sent: ${failure}` }, { status: 400 });

  await prisma.tallyLedgerEvent.create({
    data: {
      entity: ledger.entity,
      ledgerName: ledger.name,
      kind: "email",
      periodFrom: new Date(`${from}T00:00:00Z`),
      periodTo: new Date(`${to}T00:00:00Z`),
      dataAsOf: ledger.readAt ? new Date(ledger.readAt) : null,
      recipient: recipients.join(", "),
      userId: user.id,
    },
  });
  return NextResponse.json({ ok: true, to: recipients });
}
