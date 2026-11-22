import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { duplicateName, forbidden, incomeLedgerAccess, ledgerFirms, ledgerInput } from "@/lib/tally-income-ledgers-api";

// The firm of a ledger never changes
const patchSchema = ledgerInput.omit({ entity: true }).partial().extend({ active: z.boolean().optional() });

// PATCH /api/billing/tally/income-ledgers/:id – rename (as renamed in Tally),
// change the group, or hide / show it when picking. A ledger is never
// deleted, since bills keep it.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await incomeLedgerAccess();
  if (!access) return forbidden();
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid ledger" }, { status: 400 });
  const { name, groupName, active } = parsed.data;
  const id = (await params).id;
  const current = await prisma.tallyIncomeLedger.findUnique({ where: { id }, select: { entity: true } });
  if (!current) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });
  if (!ledgerFirms(access).includes(current.entity)) return forbidden();
  try {
    const ledger = await prisma.tallyIncomeLedger.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(groupName !== undefined && { groupName: groupName || null }),
        ...(active !== undefined && { active }),
      },
    });
    return NextResponse.json(ledger);
  } catch (error) {
    if (duplicateName(error)) return NextResponse.json({ error: "Another ledger already has this name" }, { status: 409 });
    return NextResponse.json({ error: "Ledger not found" }, { status: 404 });
  }
}
