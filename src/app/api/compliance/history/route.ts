import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn, frequencyAt, logEvent } from "@/lib/compliance";
import {
  addMonths,
  dateKey,
  dueDateFor,
  monthKey,
  parseDateKey,
  parseMonthKey,
  periodContaining,
  periodLabel,
  todayIST,
} from "@/lib/compliance-periods";
import { badRequest, dateString, forbidden, monthString, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

// Past periods: periods from before tracking started, so the history (and the
// return PDF / JSON of every month or quarter) is in one place. They are
// completed when saved, with no RCM/TDS check, no reminders and no bill; a
// missing PDF or JSON only shows as a tag.

const MAX_ROWS = 60;

const schema = z.object({
  clientId: z.string().min(1),
  workTypeId: z.string().min(1),
  month: monthString,
  status: z.enum(["completed", "not_required"]),
  filedAt: dateString.optional().nullable(),
  arn: z.string().trim().max(50).optional().nullable(),
  isNil: z.boolean().optional().nullable(),
});

async function load(clientId: string, workTypeId: string) {
  return Promise.all([
    prisma.complianceWorkType.findUnique({ where: { id: workTypeId } }),
    prisma.client.findUnique({ where: { id: clientId }, select: { gstin: true } }),
    prisma.clientCompliance.findUnique({ where: { clientId_workTypeId: { clientId, workTypeId } } }),
  ]);
}

// GET /api/compliance/history?clientId&workTypeId&from=2024-04&to=2026-03 –
// one row per period in the range that is over, with what is saved for it
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId") ?? "";
  const workTypeId = params.get("workTypeId") ?? "";
  const from = parseMonthKey(params.get("from"));
  const to = parseMonthKey(params.get("to"));
  if (!from || !to || to < from) return badRequest("Choose the first and last month");

  const [workType, client, sub] = await load(clientId, workTypeId);
  if (!workType || !client) return notFound("Not found");

  const today = todayIST();
  const periods = new Map<number, { start: Date; end: Date; frequency: typeof workType.frequency }>();
  for (let month = from; month <= to && periods.size < MAX_ROWS; month = addMonths(month, 1)) {
    const frequency = sub ? frequencyAt(sub, month) : workType.frequency;
    const { start, end } = periodContaining(frequency, month);
    if (end < today) periods.set(start.getTime(), { start, end, frequency });
  }
  const starts = [...periods.values()].map((p) => p.start);
  const items = await prisma.complianceItem.findMany({
    where: { clientId, workTypeId, periodStart: { in: starts } },
    select: {
      id: true,
      periodStart: true,
      status: true,
      historical: true,
      filedAt: true,
      arn: true,
      isNil: true,
      documents: { select: { id: true, kind: true, fileName: true } },
    },
  });

  return NextResponse.json({
    workType: { id: workType.id, name: workType.name, requirePdf: workType.requirePdf, requireJson: workType.requireJson },
    trackedFrom: sub ? monthKey(sub.startPeriod) : null,
    rows: [...periods.values()]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((p) => {
        const item = items.find((i) => i.periodStart.getTime() === p.start.getTime());
        return {
          month: monthKey(p.start),
          months: Array.from({ length: (p.end.getUTCFullYear() - p.start.getUTCFullYear()) * 12 + p.end.getUTCMonth() - p.start.getUTCMonth() + 1 }, (_, i) =>
            monthKey(addMonths(p.start, i))
          ),
          period: periodLabel(p.frequency, p.start),
          item: item
            ? {
                id: item.id,
                status: item.status,
                historical: item.historical,
                filedAt: item.filedAt ? dateKey(item.filedAt) : null,
                arn: item.arn,
                isNil: item.isNil,
                documents: item.documents,
              }
            : null,
        };
      }),
  });
}

// POST /api/compliance/history – saves one past period (creates it, or
// changes one entered before). Periods tracked in the sheets are changed there.
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const data = body.data;
  if (!canWorkOn(access, data.workTypeId)) return forbidden();

  const [workType, client, sub] = await load(data.clientId, data.workTypeId);
  if (!workType || !client) return notFound("Not found");
  const month = parseMonthKey(data.month)!;
  const frequency = sub ? frequencyAt(sub, month) : workType.frequency;
  const { start, end } = periodContaining(frequency, month);
  if (end >= todayIST()) return badRequest("Only periods that are over can be entered as past periods");
  const filedAt = data.filedAt ? parseDateKey(data.filedAt) : null;
  if (filedAt && filedAt > todayIST()) return badRequest("The filing date can't be in the future");

  const fields = {
    status: data.status,
    filedAt: data.status === "not_required" ? null : filedAt,
    arn: data.status === "not_required" ? null : data.arn || null,
    isNil: data.status === "not_required" ? null : data.isNil ?? null,
    updatedById: access.userId,
  };
  const exists = await prisma.complianceItem.findUnique({
    where: { clientId_workTypeId_periodStart: { clientId: data.clientId, workTypeId: data.workTypeId, periodStart: start } },
  });
  if (exists) {
    if (!exists.historical) return badRequest(`${workType.name} ${periodLabel(frequency, start)} is tracked in the sheet; change it there`);
    await prisma.complianceItem.update({
      where: { id: exists.id },
      data: { ...fields, completedAt: data.status === "completed" ? exists.completedAt ?? new Date() : null },
    });
    await logEvent(prisma, exists.id, "past_period_updated", access.userId);
    return NextResponse.json({ itemId: exists.id });
  }

  const item = await prisma.complianceItem.create({
    data: {
      clientId: data.clientId,
      workTypeId: data.workTypeId,
      frequency,
      periodStart: start,
      periodEnd: end,
      dueDate: dueDateFor(workType, frequency, end, client.gstin),
      historical: true,
      completedAt: data.status === "completed" ? new Date() : null,
      ...fields,
    },
  });
  await logEvent(prisma, item.id, "past_period_entered", access.userId);
  return NextResponse.json({ itemId: item.id }, { status: 201 });
}
