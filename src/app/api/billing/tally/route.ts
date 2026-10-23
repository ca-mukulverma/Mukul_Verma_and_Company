import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { BillType } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";
import { formatBillNumber } from "@/lib/billing-constants";
import {
  createTallyExport,
  loadPendingTallyBills,
  partyLedgerName,
  TallyExportConflict,
  tallyExportXml,
  tallyFileName,
  tallyLedgers,
  tallyTypesFor,
  voucherAction,
} from "@/lib/tally";
import { fileResponse } from "@/lib/bill-files";

async function context() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return null;
  const access = await getBillingAccess(user.id);
  return access ? { user, access } : null;
}

// GET /api/billing/tally – what is waiting to go to Tally, per series
export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const types = tallyTypesFor(ctx.access);
  if (types.length === 0) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const entities = await prisma.billingEntity.findMany({ where: { type: { in: types } } });
  const series = await Promise.all(
    types.map(async (type) => {
      const entity = entities.find((e) => e.type === type) ?? null;
      const [pending, history] = await Promise.all([
        loadPendingTallyBills(type),
        prisma.tallyExport.findMany({
          where: { type },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, createdAt: true, newCount: true, updateCount: true, createdBy: { select: { name: true } } },
        }),
      ]);

      // Clients of the waiting bills and the party ledger each will be posted to
      // Names entered under "Other" have no saved client, so their ledger
      // name can't be changed here (clientId null)
      const parties = new Map<
        string,
        { clientId: string | null; clientName: string; ledgerName: string; custom: boolean }
      >();
      for (const bill of pending) {
        if (bill.client && !parties.has(bill.client.id)) {
          parties.set(bill.client.id, {
            clientId: bill.client.id,
            clientName: bill.client.companyName || bill.client.contactPerson,
            ledgerName: partyLedgerName(bill),
            custom: !!bill.client.tallyLedgerName,
          });
        } else if (!bill.client && bill.billToName && !parties.has(`other:${bill.billToName}`)) {
          parties.set(`other:${bill.billToName}`, {
            clientId: null,
            clientName: bill.billToName,
            ledgerName: bill.billToName,
            custom: false,
          });
        }
      }

      return {
        type,
        ledgers: tallyLedgers(entity, type),
        ledgersSet: !!(entity?.tallyCompany && entity.tallySalesLedger),
        bills: pending.map((bill) => ({
          id: bill.id,
          billNumber: bill.billNumber ?? formatBillNumber(type, bill.financialYear ?? "", bill.sequence ?? 0),
          action: voucherAction(bill),
          client: bill.client ? bill.client.companyName || bill.client.contactPerson : bill.billToName,
          amount: bill.amount !== null ? Number(bill.amount) : null,
        })),
        parties: [...parties.values()],
        history,
      };
    })
  );

  return NextResponse.json({ series });
}

const exportSchema = z.object({ type: z.nativeEnum(BillType) });

// POST /api/billing/tally – download the XML of everything waiting in a
// series; those bills are then marked as sent
export async function POST(request: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = exportSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a series" }, { status: 400 });
  const { type } = parsed.data;
  if (!tallyTypesFor(ctx.access).includes(type)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const tallyExport = await createTallyExport(type, ctx.user.id);
    if (!tallyExport) return NextResponse.json({ error: "Nothing is waiting to go to Tally" }, { status: 404 });
    return fileResponse(tallyExportXml(tallyExport), "xml", tallyFileName(type, tallyExport.createdAt));
  } catch (error) {
    if (error instanceof TallyExportConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
