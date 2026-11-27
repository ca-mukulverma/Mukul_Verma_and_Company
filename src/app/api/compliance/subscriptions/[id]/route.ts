import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureItemsAround, frequencyAt, moveStartEarlier } from "@/lib/compliance";
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

  let changedWorkTypes: string[] = [];
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
    // Periods from the change on that are still untouched (pending, no files,
    // no bill…) are replaced by periods of the new frequency; a period that
    // was already worked on, or one that runs across the change, blocks it.
    const later = await prisma.complianceItem.findMany({
      where: { clientId: sub.clientId, workTypeId: { in: targets.map((t) => t.workTypeId) }, periodEnd: { gte: from } },
      orderBy: { periodStart: "asc" },
      select: {
        id: true,
        frequency: true,
        periodStart: true,
        status: true,
        historical: true,
        billId: true,
        _count: {
          select: {
            documents: true,
            challans: true,
            notes: true,
            adjustments: true,
            lines: { where: { status: { not: "pending" } } },
          },
        },
      },
    });
    const across = later.find((i) => i.periodStart < from);
    if (across) {
      return badRequest(
        `${periodLabel(across.frequency, across.periodStart)} runs across ${periodLabel("MONTHLY", from)}. ` +
          `Change from ${periodLabel("MONTHLY", across.periodStart)} instead`
      );
    }
    const worked = later.find(
      (i) =>
        i.historical ||
        !(i.status === "pending" || i.status === "data_received") ||
        i.billId ||
        Object.values(i._count).some((n) => n > 0)
    );
    if (worked) {
      return badRequest(
        `${periodLabel(worked.frequency, worked.periodStart)} is already filed or has files, notes or a bill. Choose a period after it`
      );
    }
    await prisma.$transaction(async (tx) => {
      if (later.length) await tx.complianceItem.deleteMany({ where: { id: { in: later.map((i) => i.id) } } });
      for (const target of targets) {
        // From the first tracked period on: the work simply has the new frequency
        const fromStart = from <= target.startPeriod;
        await tx.clientCompliance.update({
          where: { id: target.id },
          data: fromStart
            ? {
                previousFrequency: null,
                frequencyFrom: null,
                frequency: frequencyChange.frequency,
                startPeriod: periodContaining(frequencyChange.frequency, target.startPeriod).start,
              }
            : { previousFrequency: frequencyAt(target, from), frequencyFrom: from, frequency: frequencyChange.frequency },
        });
      }
    });
    changedWorkTypes = targets.map((t) => t.workTypeId);
  }

  if (Object.keys(update).length) await prisma.clientCompliance.update({ where: { id }, data: update });
  // The periods of the new frequency show in the sheet straight away
  if (changedWorkTypes.length) await ensureItemsAround(changedWorkTypes, undefined, [sub.clientId]);
  return NextResponse.json({ ok: true });
}
