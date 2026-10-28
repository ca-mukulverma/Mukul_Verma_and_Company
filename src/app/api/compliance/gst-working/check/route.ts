import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn } from "@/lib/compliance";
import { badRequest, forbidden, monthString, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { addMonths, parseMonthKey } from "@/lib/compliance-periods";
import { loadPeriods } from "@/lib/gst-working";

const schema = z.object({
  clientId: z.string().min(1),
  start: monthString,
  remark: z.string().trim().max(1000).optional().nullable(),
});

// May the user review this client's GST? Admins/Partners and the GST teams
async function mayReview(access: Parameters<typeof canWorkOn>[0], clientId: string) {
  const subs = await prisma.clientCompliance.findMany({
    where: { clientId, workType: { kind: { in: ["GSTR1", "GSTR3B"] } } },
    select: { workTypeId: true },
  });
  return access.isManager || subs.some((s) => canWorkOn(access, s.workTypeId));
}

// POST /api/compliance/gst-working/check – a reviewer signs off a GST period.
// A period with a difference needs a remark saying why it is fine.
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { clientId, start, remark } = body.data;
  if (!(await mayReview(access, clientId))) return forbidden("Only the GST team, Admins and Partners can sign off the GST working");

  const month = parseMonthKey(start)!;
  // Earlier periods are loaded too, so the checks match the working
  const periods = (await loadPeriods([clientId], addMonths(month, -9), month)).get(clientId) ?? [];
  const period = periods.find((p) => p.start === start);
  if (!period) return notFound("Period not found");
  if (period.hasDifference && (remark?.length ?? 0) < 5) return badRequest("This period has a difference: write why it is fine before signing it off");

  await prisma.gstWorkingCheck.upsert({
    where: { clientId_periodStart: { clientId, periodStart: month } },
    create: { clientId, periodStart: month, checkedById: access.userId, remark: remark || null, snapshot: period.snapshot },
    update: { checkedById: access.userId, remark: remark || null, snapshot: period.snapshot, createdAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/compliance/gst-working/check?clientId=…&start=2026-04 – undoes a sign-off
export async function DELETE(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId") ?? "";
  const month = parseMonthKey(params.get("start"));
  if (!clientId || !month) return badRequest("Choose the period");
  if (!(await mayReview(access, clientId))) return forbidden("Only the GST team, Admins and Partners can sign off the GST working");
  await prisma.gstWorkingCheck.deleteMany({ where: { clientId, periodStart: month } });
  return NextResponse.json({ ok: true });
}
