import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn, frequencyAt, logEvent } from "@/lib/compliance";
import { dueDateFor, parseDateKey, parseMonthKey, periodContaining, periodLabel, todayIST } from "@/lib/compliance-periods";
import { badRequest, dateString, forbidden, monthString, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

const schema = z.object({
  clientId: z.string().min(1),
  workTypeId: z.string().min(1),
  month: monthString,
  status: z.enum(["filed", "completed", "not_required"]),
  filedAt: dateString.optional().nullable(),
  arn: z.string().trim().max(50).optional().nullable(),
  isNil: z.boolean().optional().nullable(),
});

// POST /api/compliance/history – a period from before tracking started, so the
// history is in one place. No reminders and no bill for these.
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const data = body.data;
  if (!canWorkOn(access, data.workTypeId)) return forbidden();

  const [workType, client, sub] = await Promise.all([
    prisma.complianceWorkType.findUnique({ where: { id: data.workTypeId } }),
    prisma.client.findUnique({ where: { id: data.clientId }, select: { gstin: true } }),
    prisma.clientCompliance.findUnique({ where: { clientId_workTypeId: { clientId: data.clientId, workTypeId: data.workTypeId } } }),
  ]);
  if (!workType || !client) return notFound("Not found");
  const month = parseMonthKey(data.month)!;
  const frequency = sub ? frequencyAt(sub, month) : workType.frequency;
  const { start, end } = periodContaining(frequency, month);
  if (end >= todayIST()) return badRequest("Only periods that are over can be entered as past periods");
  const filedAt = data.filedAt ? parseDateKey(data.filedAt) : null;
  if (data.status !== "not_required" && !filedAt) return badRequest("Enter the filing date");

  const exists = await prisma.complianceItem.findUnique({
    where: { clientId_workTypeId_periodStart: { clientId: data.clientId, workTypeId: data.workTypeId, periodStart: start } },
  });
  if (exists) return badRequest(`${workType.name} ${periodLabel(frequency, start)} is already there; change it in the sheet`);

  const item = await prisma.complianceItem.create({
    data: {
      clientId: data.clientId,
      workTypeId: data.workTypeId,
      frequency,
      periodStart: start,
      periodEnd: end,
      dueDate: dueDateFor(workType, frequency, end, client.gstin),
      status: data.status,
      historical: true,
      filedAt,
      arn: data.arn || null,
      isNil: data.isNil ?? null,
      completedAt: data.status === "completed" ? new Date() : null,
      updatedById: access.userId,
    },
  });
  await logEvent(prisma, item.id, "past_period_entered", access.userId);
  return NextResponse.json({ ok: true }, { status: 201 });
}
