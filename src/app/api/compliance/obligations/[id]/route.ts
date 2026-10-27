import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addLinesToOpenItems, ensureItemsAround } from "@/lib/compliance";
import { monthKey, parseMonthKey, todayIST } from "@/lib/compliance-periods";
import { badRequest, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { obligationSchema } from "@/lib/compliance-schemas";

// PATCH /api/compliance/obligations/[id]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const body = parseBody(obligationSchema.partial(), await request.json());
  if (body.error) return body.error;
  const { fromMonth, toMonth, ...data } = body.data;
  const ob = await prisma.clientObligation.findUnique({ where: { id } });
  if (!ob) return notFound("Not found");
  const from = fromMonth ? parseMonthKey(fromMonth)! : ob.fromMonth;
  const to = toMonth === undefined ? ob.toMonth : toMonth ? parseMonthKey(toMonth) : null;
  if (to && to < from) return badRequest("The last month is before the first month");

  await prisma.$transaction([
    prisma.clientObligation.update({ where: { id }, data: { ...data, fromMonth: from, toMonth: to } }),
    // Lines not dealt with yet are worked out again with the new details
    prisma.complianceObligationLine.deleteMany({ where: { obligationId: id, status: "pending" } }),
  ]);
  await ensureItemsAround(null, undefined, [ob.clientId]);
  await addLinesToOpenItems([ob.clientId]);
  return NextResponse.json({ ok: true });
}

// DELETE /api/compliance/obligations/[id] – stops it; kept if months already used it
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const ob = await prisma.clientObligation.findUnique({ where: { id }, include: { _count: { select: { lines: { where: { status: { not: "pending" } } } } } } });
  if (!ob) return notFound("Not found");
  await prisma.complianceObligationLine.deleteMany({ where: { obligationId: id, status: "pending" } });
  if (ob._count.lines > 0) {
    // Past months keep their lines; it no longer applies from this month
    await prisma.clientObligation.update({
      where: { id },
      data: { active: false, toMonth: parseMonthKey(monthKey(todayIST())) },
    });
  } else {
    await prisma.clientObligation.delete({ where: { id } });
  }
  return NextResponse.json({ ok: true });
}
