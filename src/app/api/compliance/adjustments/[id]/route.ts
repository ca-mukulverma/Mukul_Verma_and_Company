import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWorkOn } from "@/lib/compliance";
import {
  adjustmentInput,
  canChangeAdjustment,
  deleteAdjustment,
  editAdjustment,
  itemAdjustments,
} from "@/lib/compliance-adjustments";
import { forbidden, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

// One adjustment: the author may change it on the day it was written, Admins
// and Partners at any time (docs/COMPLIANCE.md)
async function load(id: string) {
  return prisma.complianceAdjustment.findUnique({
    where: { id },
    select: { id: true, itemId: true, body: true, createdById: true, createdAt: true, item: { select: { workTypeId: true } } },
  });
}

const TOO_LATE = "Only the person who wrote it can change it, on the same day. Ask an Admin or Partner to change it now";

// PATCH /api/compliance/adjustments/[id] – correct the text or the follow-up tick
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const parsed = parseBody(adjustmentInput, await request.json());
  if (parsed.error) return parsed.error;
  const row = await load(id);
  if (!row) return notFound("Adjustment not found");
  if (!canWorkOn(access, row.item.workTypeId)) return forbidden();
  if (!canChangeAdjustment(row, access)) return forbidden(TOO_LATE);
  await prisma.$transaction((tx) => editAdjustment(tx, id, row.itemId, access.userId, parsed.data));
  return NextResponse.json({ adjustments: await itemAdjustments(row.itemId, access, true) });
}

// DELETE /api/compliance/adjustments/[id] – the period's history keeps a line saying so
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const row = await load(id);
  if (!row) return notFound("Adjustment not found");
  if (!canWorkOn(access, row.item.workTypeId)) return forbidden();
  if (!canChangeAdjustment(row, access)) return forbidden(TOO_LATE);
  await prisma.$transaction((tx) => deleteAdjustment(tx, id, row.itemId, access.userId, row.body));
  return NextResponse.json({ adjustments: await itemAdjustments(row.itemId, access, true) });
}
