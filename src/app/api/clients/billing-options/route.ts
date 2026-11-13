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

  const canSetLedger = await canSetTallyLedger(user.id);
  const [connectors, clients, billLedgers] = await Promise.all([
    prisma.connector.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, tallyLedgerName: true },
    }),
    canSetLedger
      ? prisma.client.findMany({ select: { contactPerson: true, companyName: true, tallyLedgerName: true, connectorId: true } })
      : [],
    canSetLedger
      ? prisma.bill.findMany({
          where: { tallyLedgerName: { not: null } },
          distinct: ["tallyLedgerName"],
          select: { tallyLedgerName: true },
        })
      : [],
  ]);

  // Every party ledger in use, with who uses it: a client's own Tally name, or
  // its name when it has none (unless its bills go to a connector), the
  // connectors' ledgers and the ledgers on bills
  const ledgers = new Map<string, { name: string; clients: string[]; connector: string | null }>();
  const entry = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!ledgers.has(key)) ledgers.set(key, { name: name.trim(), clients: [], connector: null });
    return ledgers.get(key)!;
  };
  for (const c of clients) {
    const own = c.companyName || c.contactPerson;
    if (c.tallyLedgerName) entry(c.tallyLedgerName).clients.push(own);
    else if (!c.connectorId) entry(own).clients.push(own);
  }
  if (canSetLedger) for (const c of connectors) entry(c.tallyLedgerName || c.name).connector = c.name;
  for (const b of billLedgers) if (b.tallyLedgerName) entry(b.tallyLedgerName);

  return NextResponse.json({
    canSetLedger,
    connectors: connectors.map((c) => ({ id: c.id, name: c.name, ledgerName: c.tallyLedgerName || c.name })),
    ledgers: [...ledgers.values()]
      .map((l) => ({ name: l.name, clients: l.clients.sort((a, b) => a.localeCompare(b)), connector: l.connector }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}
