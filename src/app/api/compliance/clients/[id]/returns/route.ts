import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn, frequencyAt, logEvent } from "@/lib/compliance";
import { dueDateFor, monthKey, parseDateKey, parseMonthKey, periodContaining, periodLabel, todayIST } from "@/lib/compliance-periods";
import { badRequest, dateString, monthString, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

// Upload documents (Compliance → Clients → a client): where each file the
// browser read goes. With place: false it only says what each period is; with
// place: true it creates the past periods that don't exist yet (completed,
// with the ARN and filing date read from the file) and returns their ids.
// Periods tracked in the sheets are never changed here; files are only added.

const schema = z.object({
  place: z.boolean(),
  rows: z
    .array(
      z.object({
        workTypeId: z.string().min(1),
        month: monthString,
        arn: z.string().trim().max(50).optional().nullable(),
        filedAt: dateString.optional().nullable(),
      })
    )
    .min(1)
    .max(200),
});

type Place =
  | { ok: true; period: string; month: string; itemId: string | null; state: "sheet" | "past" | "new_past"; status: string | null }
  | { ok: false; period: string | null; error: string };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id: clientId } = await params;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { rows, place } = body.data;

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { gstin: true } });
  if (!client) return notFound("Client not found");
  const workTypeIds = [...new Set(rows.map((r) => r.workTypeId))];
  const [workTypes, subs] = await Promise.all([
    prisma.complianceWorkType.findMany({ where: { id: { in: workTypeIds } } }),
    prisma.clientCompliance.findMany({ where: { clientId, workTypeId: { in: workTypeIds } } }),
  ]);
  const today = todayIST();

  const results: Place[] = [];
  for (const row of rows) {
    const workType = workTypes.find((w) => w.id === row.workTypeId);
    if (!workType) {
      results.push({ ok: false, period: null, error: "Work not found" });
      continue;
    }
    const month = parseMonthKey(row.month);
    if (!month) {
      results.push({ ok: false, period: null, error: "Choose the period" });
      continue;
    }
    const sub = subs.find((s) => s.workTypeId === workType.id);
    const frequency = sub ? frequencyAt(sub, month) : workType.frequency;
    const { start, end } = periodContaining(frequency, month);
    const period = periodLabel(frequency, start);
    if (!canWorkOn(access, workType.id)) {
      results.push({ ok: false, period, error: `You are not in the ${workType.name} team` });
      continue;
    }

    const item = await prisma.complianceItem.findUnique({
      where: { clientId_workTypeId_periodStart: { clientId, workTypeId: workType.id, periodStart: start } },
      select: { id: true, historical: true, status: true, arn: true, filedAt: true },
    });
    if (item) {
      // Past periods get the ARN and filing date from the file if they have none
      if (place && item.historical && ((!item.arn && row.arn) || (!item.filedAt && row.filedAt))) {
        await prisma.complianceItem.update({
          where: { id: item.id },
          data: {
            ...(!item.arn && row.arn && { arn: row.arn }),
            ...(!item.filedAt && row.filedAt && { filedAt: parseDateKey(row.filedAt) }),
            updatedById: access.userId,
          },
        });
      }
      results.push({ ok: true, period, month: monthKey(start), itemId: item.id, state: item.historical ? "past" : "sheet", status: item.status });
      continue;
    }
    if (end >= today) {
      results.push({ ok: false, period, error: `${period} is not over and not in the sheet yet` });
      continue;
    }
    if (!place) {
      results.push({ ok: true, period, month: monthKey(start), itemId: null, state: "new_past", status: null });
      continue;
    }

    const filedAt = row.filedAt ? parseDateKey(row.filedAt) : null;
    const created = await prisma.complianceItem.upsert({
      where: { clientId_workTypeId_periodStart: { clientId, workTypeId: workType.id, periodStart: start } },
      update: {},
      create: {
        clientId,
        workTypeId: workType.id,
        frequency,
        periodStart: start,
        periodEnd: end,
        dueDate: dueDateFor(workType, frequency, end, client.gstin),
        historical: true,
        status: "completed",
        completedAt: new Date(),
        filedAt: filedAt && filedAt <= today ? filedAt : null,
        arn: row.arn || null,
        updatedById: access.userId,
      },
    });
    await logEvent(prisma, created.id, "past_period_entered", access.userId, "From an uploaded return");
    results.push({ ok: true, period, month: monthKey(start), itemId: created.id, state: "new_past", status: "completed" });
  }

  if (!results.length) return badRequest("Nothing to place");
  return NextResponse.json({ results });
}
