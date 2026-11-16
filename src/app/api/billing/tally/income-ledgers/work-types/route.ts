import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { forbidden, incomeLedgerAccess } from "@/lib/tally-income-ledgers-api";

const schema = z.object({ workTypeId: z.string().min(1), incomeLedgerId: z.string().min(1).nullable() });

// PUT /api/billing/tally/income-ledgers/work-types – the ledger a compliance
// work type's bills start with (null: none). Bills already made keep theirs.
export async function PUT(request: NextRequest) {
  const access = await incomeLedgerAccess();
  if (!access) return forbidden();
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const { workTypeId, incomeLedgerId } = parsed.data;

  const workType = await prisma.complianceWorkType.findUnique({ where: { id: workTypeId }, select: { company: true } });
  if (!workType) return NextResponse.json({ error: "Work type not found" }, { status: 404 });
  if (!access.isAdmin && !access.manages.includes(workType.company)) return forbidden();
  if (incomeLedgerId) {
    const ledger = await prisma.tallyIncomeLedger.findUnique({ where: { id: incomeLedgerId }, select: { active: true } });
    if (!ledger?.active) return NextResponse.json({ error: "That ledger is not in the list" }, { status: 400 });
  }
  await prisma.complianceWorkType.update({ where: { id: workTypeId }, data: { incomeLedgerId } });
  return NextResponse.json({ ok: true });
}
