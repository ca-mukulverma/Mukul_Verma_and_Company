import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, money, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { serializeWorkType, workTypeInclude } from "@/lib/compliance-work-types";

// GET /api/compliance/work-types
export async function GET() {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const workTypes = await prisma.complianceWorkType.findMany({ include: workTypeInclude, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return NextResponse.json({ workTypes: workTypes.map((wt) => serializeWorkType(wt, access.isManager)) });
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(80),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
  company: z.enum(["MVC", "BEDGE"]),
  dueDay: z.number().int().min(1).max(31),
  dueMonthOffset: z.number().int().min(0).max(12),
  leadDays: z.number().int().min(0).max(90),
  requirePdf: z.boolean(),
  billable: z.boolean(),
  defaultFeeNil: money.nullable().optional(),
  defaultFeeNonNil: money.nullable().optional(),
});

// POST /api/compliance/work-types – a new recurring work (Admins and Partners)
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess({ manager: true });
  if (error) return error;
  const body = parseBody(createSchema, await request.json());
  if (body.error) return body.error;
  const data = body.data;
  if (await prisma.complianceWorkType.findUnique({ where: { name: data.name } })) {
    return badRequest("A work with this name already exists");
  }
  const workType = await prisma.complianceWorkType.create({
    data: {
      ...data,
      kind: "GENERIC",
      reminderSubject: "{work} for {period}: details required",
      reminderMessage: "Dear {client}, please share the details for {work} for {period}. The due date is {due}. – {firm}",
    },
    include: workTypeInclude,
  });
  return NextResponse.json(serializeWorkType(workType, access.isManager), { status: 201 });
}
