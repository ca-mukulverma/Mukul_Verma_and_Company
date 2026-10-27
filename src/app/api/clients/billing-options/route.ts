import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSetTallyLedger } from "@/lib/connectors";

// GET /api/clients/billing-options – for the client form: the connectors, the
// Tally ledger names already in use (to pick from), and whether the user may
// set a client's ledger (billing managers and Admin only)
export async function GET() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [canSetLedger, connectors, clientLedgers, billLedgers] = await Promise.all([
    canSetTallyLedger(user.id),
    prisma.connector.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, tallyLedgerName: true },
    }),
    prisma.client.findMany({
      where: { tallyLedgerName: { not: null } },
      distinct: ["tallyLedgerName"],
      select: { tallyLedgerName: true },
    }),
    prisma.bill.findMany({
      where: { tallyLedgerName: { not: null } },
      distinct: ["tallyLedgerName"],
      select: { tallyLedgerName: true },
    }),
  ]);

  const names = new Set<string>();
  for (const row of [...clientLedgers, ...billLedgers]) if (row.tallyLedgerName) names.add(row.tallyLedgerName);
  for (const c of connectors) names.add(c.tallyLedgerName || c.name);

  return NextResponse.json({
    canSetLedger,
    connectors: connectors.map((c) => ({ id: c.id, name: c.name, ledgerName: c.tallyLedgerName || c.name })),
    ledgerNames: canSetLedger ? [...names].sort((a, b) => a.localeCompare(b)) : [],
  });
}
