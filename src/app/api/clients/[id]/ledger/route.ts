import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { connectorLedger } from "@/lib/connectors";
import { debtorsUser, nameKey, notAllowed } from "@/lib/tally-debtors";

export const dynamic = "force-dynamic";

// GET /api/clients/[id]/ledger – the client's Sundry Debtors ledgers from
// Tally, one per firm (MVC, B Edge) where the client has one, by the Tally
// ledger linked to the client (else its name). A connector's client: its
// bills go to the connector's ledger, which holds other clients too, so that
// is only linked, not shown here.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    select: { contactPerson: true, companyName: true, tallyLedgerName: true, connector: { select: { name: true, tallyLedgerName: true } } },
  });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const ownName = client.tallyLedgerName || client.companyName || client.contactPerson;
  const connectorName = client.connector ? connectorLedger(client.connector) : null;
  const select = { id: true, name: true, entity: true } as const;
  const [own, viaConnector] = await Promise.all([
    prisma.tallyDebtorLedger.findMany({ where: { nameKey: nameKey(ownName) }, select, orderBy: { entity: "asc" } }),
    connectorName ? prisma.tallyDebtorLedger.findMany({ where: { nameKey: nameKey(connectorName) }, select, orderBy: { entity: "asc" } }) : [],
  ]);
  return NextResponse.json({
    ledgerName: ownName,
    linked: !!client.tallyLedgerName,
    ledgers: own,
    connector: client.connector ? { name: client.connector.name, ledgers: viaConnector } : null,
  });
}
