import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { putObject, r2Configured } from "@/lib/r2";
import { debtorsUser, loadLedger, newShareToken, notAllowed, saveShare, SHARE_DAYS, SHARE_PREFIX } from "@/lib/tally-debtors";
import { DAY_RE, ledgerFileName, statement } from "@/lib/tally-debtors-shared";
import { ledgerPdf } from "@/lib/tally-ledger-files";

export const dynamic = "force-dynamic";

const schema = z.object({
  from: z.string().regex(DAY_RE),
  to: z.string().regex(DAY_RE),
  narration: z.boolean().default(false),
  recipient: z.string().trim().regex(/^\d{10,15}$/).optional(),
  // "file": the PDF itself went on WhatsApp (made in the browser); only noted here
  as: z.enum(["link", "file"]).default("link"),
});

// POST /api/debtors/[id]/share – the ledger PDF kept for 7 days behind a link
// that can't be guessed, for a WhatsApp message. Answers { url, expiresAt }.
// With as: "file" the PDF was attached to the message itself: the send is
// only recorded, and the answer is { ok: true }.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "Choose a period" }, { status: 400 });
  const { from, to, narration, recipient } = parsed.data;
  const fileOnly = parsed.data.as === "file";
  if (!fileOnly && !r2Configured()) return NextResponse.json({ error: "File storage (Cloudflare R2) is not set up on the website" }, { status: 503 });
  const { id } = await params;
  const ledger = await loadLedger(id);
  if (!ledger) return NextResponse.json({ error: "This ledger is no longer in the Tally data" }, { status: 404 });
  if (from < ledger.periodFrom) return NextResponse.json({ error: `Entries are kept from ${ledger.periodFrom}` }, { status: 400 });

  const record = () =>
    prisma.tallyLedgerEvent.create({
      data: {
        entity: ledger.entity,
        ledgerName: ledger.name,
        kind: "whatsapp",
        periodFrom: new Date(`${from}T00:00:00Z`),
        periodTo: new Date(`${to}T00:00:00Z`),
        dataAsOf: ledger.readAt ? new Date(ledger.readAt) : null,
        recipient: recipient ?? null,
        userId: user.id,
      },
    });
  if (fileOnly) {
    await record();
    return NextResponse.json({ ok: true });
  }

  const pdf = ledgerPdf({ company: ledger.company, ledger: ledger.name, statement: statement(ledger, from, to), narration, readAt: ledger.readAt });
  const token = newShareToken();
  const key = `${SHARE_PREFIX}${new Date().toISOString().slice(0, 10)}/${token}.pdf`;
  await putObject(key, pdf, "application/pdf");
  await saveShare(token, { key, fileName: `${ledgerFileName(ledger.name, from, to)}.pdf` });
  await record();
  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  return NextResponse.json({ url: `${origin}/api/ledger-link/${token}`, expiresAt: new Date(Date.now() + SHARE_DAYS * 86_400_000).toISOString() });
}
