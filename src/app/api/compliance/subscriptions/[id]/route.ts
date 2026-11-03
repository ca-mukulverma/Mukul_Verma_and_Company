import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { frequencyAt, moveStartEarlier } from "@/lib/compliance";
import { parseMonthKey, periodContaining, periodLabel } from "@/lib/compliance-periods";
import { badRequest, money, monthString, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

const schema = z.object({
  feeNil: money.nullable().optional(),
  feeNonNil: money.nullable().optional(),
  endPeriod: monthString.nullable().optional(),
  // First period tracked; can be moved earlier, or later while no period
  // before the new start is in the sheet
  startPeriod: monthString.optional(),
  active: z.boolean().optional(),
  // Monthly ↔ quarterly, from a given period on
  frequencyChange: z.object({ frequency: z.enum(["MONTHLY", "QUARTERLY"]), from: monthString }).optional(),
});

// PATCH /api/compliance/subscriptions/[id] – fees, first period, stop, frequency change (Admins and Partners)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireComplianceAccess({ manager: true });
  if (error) return error;
  const { id } = await params;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { frequencyChange, endPeriod, startPeriod, ...data } = body.data;

  const sub = await prisma.clientCompliance.findUnique({ where: { id }, include: { workType: true } });
  if (!sub) return notFound("Not found");

  const update: Record<string, unknown> = { ...data };
  if (endPeriod !== undefined) update.endPeriod = endPeriod ? parseMonthKey(endPeriod) : null;

  if (startPeriod) {
    const month = parseMonthKey(startPeriod);
    if (!month) return badRequest("Choose the first period to track");
    const start = periodContaining(frequencyAt(sub, month), month).start;
    if (start < sub.startPeriod) {
      const moved = await moveStartEarlier(sub.id, month);
      if ("error" in moved) return badRequest(moved.error);
    } else if (start > sub.startPeriod) {
      if (sub.endPeriod && start > sub.endPeriod) return badRequest("That is after the work was stopped");
      const earlier = await prisma.complianceItem.findFirst({
        where: { clientId: sub.clientId, workTypeId: sub.workTypeId, historical: false, periodStart: { lt: start } },
        orderBy: { periodStart: "desc" },
      });
      if (earlier) {
        return badRequest(
          `${periodLabel(earlier.frequency, earlier.periodStart)} is already in the sheet. Choose a period up to it`
        );
      }
      update.startPeriod = start;
    }
  }

  if (frequencyChange) {
    if (!sub.workType.allowQuarterly) return badRequest(`${sub.workType.name} has only one frequency`);
    const month = parseMonthKey(frequencyChange.from);
    if (!month) return badRequest("Choose the period the change applies from");
    const from = periodContaining(frequencyChange.frequency, month).start;
    // Both GST returns change together
    const subs = await prisma.clientCompliance.findMany({
      where: { clientId: sub.clientId, active: true, workType: { kind: { in: ["GSTR1", "GSTR3B"] } } },
    });
    const targets = sub.workType.kind === "GSTR1" || sub.workType.kind === "GSTR3B" ? subs : [sub];
    const clash = await prisma.complianceItem.findFirst({
      where: { clientId: sub.clientId, workTypeId: { in: targets.map((t) => t.workTypeId) }, periodEnd: { gte: from } },
      orderBy: { periodEnd: "desc" },
    });
    if (clash) {
      return badRequest(
        `${periodLabel(clash.frequency, clash.periodStart)} is already in the sheet. Choose a period after it`
      );
    }
    for (const target of targets) {
      await prisma.clientCompliance.update({
        where: { id: target.id },
        data: { previousFrequency: frequencyAt(target, from), frequencyFrom: from, frequency: frequencyChange.frequency },
      });
    }
  }

  if (Object.keys(update).length) await prisma.clientCompliance.update({ where: { id }, data: update });
  return NextResponse.json({ ok: true });
}
