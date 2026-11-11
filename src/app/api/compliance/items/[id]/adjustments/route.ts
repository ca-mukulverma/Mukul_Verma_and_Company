import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWorkOn } from "@/lib/compliance";
import { addAdjustment, adjustmentInput, itemAdjustments } from "@/lib/compliance-adjustments";
import { forbidden, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

// POST /api/compliance/items/[id]/adjustments – note an adjustment made in
// this period's return (docs/COMPLIANCE.md)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const parsed = parseBody(adjustmentInput, await request.json());
  if (parsed.error) return parsed.error;
  const item = await prisma.complianceItem.findUnique({ where: { id }, select: { workTypeId: true } });
  if (!item) return notFound("Item not found");
  if (!canWorkOn(access, item.workTypeId)) return forbidden();
  await prisma.$transaction((tx) => addAdjustment(tx, id, access.userId, parsed.data));
  return NextResponse.json({ adjustments: await itemAdjustments(id, access, true) });
}
