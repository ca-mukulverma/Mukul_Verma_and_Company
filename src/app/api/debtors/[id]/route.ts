import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { debtorsUser, loadLedger, nameKey, notAllowed, partiesForLedgers } from "@/lib/tally-debtors";

export const dynamic = "force-dynamic";

// GET /api/debtors/[id] – one debtor's ledger (all entries kept), the party's
// details from the app, and the last downloads / sends
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  const { id } = await params;
  const ledger = await loadLedger(id);
  if (!ledger) return NextResponse.json({ error: "This ledger is no longer in the Tally data" }, { status: 404 });

  const [parties, events] = await Promise.all([
    partiesForLedgers([nameKey(ledger.name)]),
    prisma.tallyLedgerEvent.findMany({
      where: { entity: ledger.entity, ledgerName: ledger.name },
      orderBy: { at: "desc" },
      take: 10,
      select: { kind: true, at: true, recipient: true, periodFrom: true, periodTo: true, user: { select: { name: true } } },
    }),
  ]);

  return NextResponse.json({
    ledger,
    party: parties.get(nameKey(ledger.name)) ?? null,
    events: events.map((e) => ({
      kind: e.kind,
      at: e.at,
      by: e.user.name,
      recipient: e.recipient,
      from: e.periodFrom.toISOString().slice(0, 10),
      to: e.periodTo.toISOString().slice(0, 10),
    })),
  });
}
