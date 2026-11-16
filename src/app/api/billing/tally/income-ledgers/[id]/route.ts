import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { duplicateName, forbidden, incomeLedgerAccess, ledgerInput } from "@/lib/tally-income-ledgers-api";

const patchSchema = ledgerInput.partial().extend({ active: z.boolean().optional() });

// PATCH /api/billing/tally/income-ledgers/:id – rename (as renamed in Tally),
// change the group, or hide / show it when picking. A ledger is never
// deleted, since bills keep it.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await incomeLedgerAccess();
  if (!access) return forbidden();
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid ledger" }, { status: 400 });
  const { name, groupName, active } = parsed.data;
  try {
    const ledger = await prisma.tallyIncomeLedger.update({
      where: { id: (await params).id },
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
