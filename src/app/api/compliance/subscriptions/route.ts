import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureItemsAround, frequencyAt } from "@/lib/compliance";
import { parseMonthKey, periodContaining } from "@/lib/compliance-periods";
import { badRequest, money, monthString, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

const schema = z.object({
  clientIds: z.array(z.string().min(1)).min(1, "Select the clients").max(2000),
  workTypeId: z.string().min(1),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
  startPeriod: monthString,
  feeNil: money.nullable().optional(),
  feeNonNil: money.nullable().optional(),
});

// POST /api/compliance/subscriptions – adds a work to one or many clients
// (Admins and Partners). Clients that already have it are skipped.
export async function POST(request: NextRequest) {
  const { error } = await requireComplianceAccess({ manager: true });
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const data = body.data;

  const workType = await prisma.complianceWorkType.findUnique({ where: { id: data.workTypeId } });
  if (!workType || !workType.active) return notFound("Work not found");
  if (data.frequency !== workType.frequency && !(workType.allowQuarterly && data.frequency === "QUARTERLY")) {
    return badRequest(`${workType.name} can't be ${data.frequency.toLowerCase()}`);
  }
  const month = parseMonthKey(data.startPeriod);
  if (!month) return badRequest("Choose the first period to track");
  const startPeriod = periodContaining(data.frequency, month).start;

  // GSTR-1 and GSTR-3B of a client always have the same frequency
  const gstPartners =
    workType.kind === "GSTR1" || workType.kind === "GSTR3B"
      ? await prisma.clientCompliance.findMany({
          where: {
            clientId: { in: data.clientIds },
            active: true,
            workType: { kind: workType.kind === "GSTR1" ? "GSTR3B" : "GSTR1" },
          },
        })
      : [];

  const existing = await prisma.clientCompliance.findMany({
    where: { clientId: { in: data.clientIds }, workTypeId: workType.id },
  });
  const skipped: { clientId: string; reason: string }[] = [];
  let added = 0;
  for (const clientId of data.clientIds) {
    const partner = gstPartners.find((p) => p.clientId === clientId);
    if (partner && frequencyAt(partner, startPeriod) !== data.frequency) {
      skipped.push({ clientId, reason: "GSTR-1 and GSTR-3B must have the same frequency" });
      continue;
    }
    const current = existing.find((e) => e.clientId === clientId);
    if (current?.active) {
      skipped.push({ clientId, reason: "Already set up" });
      continue;
    }
    const fields = {
      frequency: data.frequency,
      previousFrequency: null,
      frequencyFrom: null,
      startPeriod,
      endPeriod: null,
      feeNil: data.feeNil ?? null,
      feeNonNil: data.feeNonNil ?? null,
      active: true,
    };
    if (current) await prisma.clientCompliance.update({ where: { id: current.id }, data: fields });
    else await prisma.clientCompliance.create({ data: { clientId, workTypeId: workType.id, ...fields } });
    added++;
  }

  if (added) await ensureItemsAround([workType.id], undefined, data.clientIds);
  return NextResponse.json({ added, skipped });
}
