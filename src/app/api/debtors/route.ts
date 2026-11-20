import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { debtorsUser, notAllowed, partiesForLedgers, syncStatus, toNumber } from "@/lib/tally-debtors";
import { keptPeriod } from "@/lib/tally-debtors-shared";

export const dynamic = "force-dynamic";

// GET /api/debtors – the Sundry Debtors ledgers from Tally under Tally's
// groups, with their balances and the client or connector each belongs to,
// and when the data was read from Tally. docs/TALLY_DEBTORS.md
export async function GET() {
  const user = await debtorsUser();
  if (!user) return notAllowed();

  const [sync, ledgers, status] = await Promise.all([
    prisma.tallyDebtorSync.findUnique({ where: { id: 1 } }),
    prisma.tallyDebtorLedger.findMany({
      select: { id: true, name: true, nameKey: true, groupName: true, closing: true, lastReceiptDate: true, lastReceiptAmt: true },
      orderBy: { name: "asc" },
    }),
    syncStatus(),
  ]);
  const parties = await partiesForLedgers(ledgers.map((l) => l.nameKey));

  return NextResponse.json({
    isAdmin: user.role === "ADMIN",
    status,
    setup: sync ? { company: sync.company, connected: !!sync.keyHash, keyHint: sync.keyHint, connectedAt: sync.connectedAt, connectedBy: sync.connectedBy } : null,
    rootGroup: sync?.rootGroup ?? null,
    groups: (sync?.groups as { name: string; parent: string }[] | null) ?? [],
    period: {
      from: sync?.periodFrom?.toISOString().slice(0, 10) ?? keptPeriod().from,
      to: sync?.periodTo?.toISOString().slice(0, 10) ?? keptPeriod().to,
    },
    ledgers: ledgers.map((l) => {
      const party = parties.get(l.nameKey);
      return {
        id: l.id,
        name: l.name,
        group: l.groupName,
        closing: toNumber(l.closing),
        lastReceiptDate: l.lastReceiptDate?.toISOString().slice(0, 10) ?? null,
        lastReceiptAmt: l.lastReceiptAmt == null ? null : toNumber(l.lastReceiptAmt),
        party: party ? { kind: party.kind, id: party.id, name: party.companyName || party.name } : null,
      };
    }),
  });
}
