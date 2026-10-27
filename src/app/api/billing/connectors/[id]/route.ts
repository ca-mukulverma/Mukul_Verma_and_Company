import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { connectorAccess, connectorLedger, connectorSchema } from "@/lib/connectors";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/billing/connectors/:id – details, or { active } to stop/restart
export async function PATCH(request: NextRequest, { params }: Params) {
  const { error } = await connectorAccess();
  if (error) return error;
  const { id } = await params;
  const parsed = connectorSchema.partial().extend({ active: z.boolean().optional() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  const d = parsed.data;
  const existing = await prisma.connector.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Connector not found" }, { status: 404 });

  const connector = await prisma.connector.update({
    where: { id },
    data: {
      ...(d.name !== undefined && { name: d.name }),
      ...(d.phone !== undefined && { phone: d.phone || null }),
      ...(d.email !== undefined && { email: d.email || null }),
      ...(d.tallyLedgerName !== undefined && { tallyLedgerName: d.tallyLedgerName || null }),
      ...(typeof d.active === "boolean" && { active: d.active }),
    },
  });
  // Numbered bills not sent to Tally yet go to the new ledger name
  if (connectorLedger(connector) !== connectorLedger(existing)) {
    await prisma.bill.updateMany({
      where: { connectorId: id, billNumber: { not: null }, tallyExportedAt: null },
      data: { tallyLedgerName: connectorLedger(connector) },
    });
  }
  return NextResponse.json(connector);
}
