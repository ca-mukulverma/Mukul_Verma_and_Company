import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { debtorsUser, loadLedger, notAllowed } from "@/lib/tally-debtors";
import { DAY_RE, ledgerFileName, statement } from "@/lib/tally-debtors-shared";
import { ledgerExcel, ledgerPdf } from "@/lib/tally-ledger-files";

export const dynamic = "force-dynamic";

// GET /api/debtors/[id]/file?format=pdf|xlsx&from=&to=&narration=1 – the
// ledger for the period as PDF or Excel, as Tally shows it. &forSend=1: the
// PDF made ready to attach on WhatsApp, not recorded as a download (the send
// is recorded by /share)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  const { id } = await params;
  const q = new URL(request.url).searchParams;
  const format = q.get("format");
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  if ((format !== "pdf" && format !== "xlsx") || !DAY_RE.test(from) || !DAY_RE.test(to) || from > to) {
    return NextResponse.json({ error: "Choose PDF or Excel and a period" }, { status: 400 });
  }
  const ledger = await loadLedger(id);
  if (!ledger) return NextResponse.json({ error: "This ledger is no longer in the Tally data" }, { status: 404 });
  if (from < ledger.periodFrom) return NextResponse.json({ error: `Entries are kept from ${ledger.periodFrom}` }, { status: 400 });

  const input = { company: ledger.company, ledger: ledger.name, statement: statement(ledger, from, to), narration: q.get("narration") === "1", readAt: ledger.readAt };
  const body = format === "pdf" ? ledgerPdf(input) : await ledgerExcel(input);
  if (q.get("forSend") !== "1") await prisma.tallyLedgerEvent.create({
    data: {
      entity: ledger.entity,
      ledgerName: ledger.name,
      kind: format === "pdf" ? "pdf" : "excel",
      periodFrom: new Date(`${from}T00:00:00Z`),
      periodTo: new Date(`${to}T00:00:00Z`),
      dataAsOf: ledger.readAt ? new Date(ledger.readAt) : null,
      userId: user.id,
    },
  });
  const fileName = `${ledgerFileName(ledger.name, from, to)}.${format}`;
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
