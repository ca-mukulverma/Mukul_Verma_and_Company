import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { allSyncStatus, debtorsUser, notAllowed, partiesForLedgers, toNumber } from "@/lib/tally-debtors";
import { DEBTOR_ENTITIES, keptPeriod } from "@/lib/tally-debtors-shared";

export const dynamic = "force-dynamic";

// GET /api/debtors – both firms' (MVC, B Edge) Sundry Debtors ledgers from
// Tally, each under its own Tally groups, with balances, the client or
// connector each belongs to, and when each firm's data was read from Tally.
// docs/TALLY_DEBTORS.md
export async function GET() {
  const user = await debtorsUser();
  if (!user) return notAllowed();

  const [syncs, ledgers, statuses] = await Promise.all([
    prisma.tallyDebtorSync.findMany(),
    prisma.tallyDebtorLedger.findMany({
      select: { id: true, entity: true, name: true, nameKey: true, groupName: true, closing: true, lastReceiptDate: true, lastReceiptAmt: true },
      orderBy: { name: "asc" },
    }),
    allSyncStatus(),
  ]);
  const parties = await partiesForLedgers([...new Set(ledgers.map((l) => l.nameKey))]);

  const firms = Object.fromEntries(
    DEBTOR_ENTITIES.map((entity) => {
      const sync = syncs.find((s) => s.entity === entity);
      return [
        entity,
        {
          status: statuses[entity],
          setup: sync ? { company: sync.company, connected: !!sync.keyHash, keyHint: sync.keyHint, connectedAt: sync.connectedAt, connectedBy: sync.connectedBy } : null,
          rootGroup: sync?.rootGroup ?? null,
          groups: (sync?.groups as { name: string; parent: string }[] | null) ?? [],
          period: {
            from: sync?.periodFrom?.toISOString().slice(0, 10) ?? keptPeriod().from,
            to: sync?.periodTo?.toISOString().slice(0, 10) ?? keptPeriod().to,
          },
        },
      ];
    })
  );

  return NextResponse.json({
    isAdmin: user.role === "ADMIN",
    firms,
    ledgers: ledgers.map((l) => {
      const party = parties.get(l.nameKey);
      return {
        id: l.id,
        entity: l.entity,
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
