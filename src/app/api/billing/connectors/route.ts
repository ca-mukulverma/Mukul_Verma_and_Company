import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSetTallyLedger, connectorAccess, connectorLedger, connectorSchema } from "@/lib/connectors";

// GET /api/billing/connectors – every connector with their clients and bills
// (numbered bills of their clients, with the total per financial year)
export async function GET() {
  const { error } = await connectorAccess();
  if (error) return error;
  const connectors = await prisma.connector.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      clients: { select: { id: true, contactPerson: true, companyName: true }, orderBy: { contactPerson: "asc" } },
      bills: {
        where: { status: "approved", billNumber: { not: null } },
        orderBy: [{ billDate: "desc" }, { sequence: "desc" }],
        select: {
          id: true,
          billNumber: true,
          billDate: true,
          financialYear: true,
          amount: true,
          type: true,
          description: true,
          emailedAt: true,
          client: { select: { contactPerson: true, companyName: true } },
        },
      },
    },
  });
  return NextResponse.json({
    connectors: connectors.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      tallyLedgerName: c.tallyLedgerName,
      ledgerName: connectorLedger(c),
      active: c.active,
      clients: c.clients.map((cl) => ({ id: cl.id, name: cl.companyName || cl.contactPerson })),
      bills: c.bills.map((b) => ({
        id: b.id,
        billNumber: b.billNumber,
        billDate: b.billDate,
        financialYear: b.financialYear,
        fee: b.amount !== null ? Number(b.amount) : 0,
        type: b.type,
        work: b.description.split("\n")[0],
        client: b.client ? b.client.companyName || b.client.contactPerson : null,
        emailedAt: b.emailedAt,
      })),
    })),
  });
}

// POST /api/billing/connectors – from Billing → Connectors, or from the client
// form (anyone adding a client may add its connector; only billing managers
// and Admin set the connector's Tally ledger name)
export async function POST(request: NextRequest) {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = connectorSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  const d = parsed.data;
  const mayLedger = await canSetTallyLedger(user.id);

  const same = await prisma.connector.findFirst({ where: { name: { equals: d.name, mode: "insensitive" } } });
  if (same) {
    return NextResponse.json(
      { error: same.active ? `${same.name} is already a connector` : `${same.name} is a stopped connector; restart them in Billing → Connectors` },
      { status: 409 }
    );
  }

  const connector = await prisma.connector.create({
    data: {
      name: d.name,
      phone: d.phone || null,
      email: d.email || null,
      tallyLedgerName: (mayLedger && d.tallyLedgerName) || null,
    },
  });
  return NextResponse.json({ ...connector, ledgerName: connectorLedger(connector) }, { status: 201 });
}
