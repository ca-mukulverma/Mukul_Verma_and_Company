import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, money, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { serializeWorkType, workTypeInclude } from "@/lib/compliance-work-types";

const schema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  company: z.enum(["MVC", "BEDGE"]).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  dueMonthOffset: z.number().int().min(0).max(12).optional(),
  quarterlyDueDay: z.number().int().min(1).max(31).nullable().optional(),
  quarterlyDueMonthOffset: z.number().int().min(0).max(12).nullable().optional(),
  leadDays: z.number().int().min(0).max(90).optional(),
  requirePdf: z.boolean().optional(),
  requireJson: z.boolean().optional(),
  billable: z.boolean().optional(),
  defaultFeeNil: money.nullable().optional(),
  defaultFeeNonNil: money.nullable().optional(),
  reminderSubject: z.string().trim().min(3).max(150).optional(),
  reminderMessage: z.string().trim().min(10).max(2000).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  active: z.boolean().optional(),
  // The new team: members not in the list leave it today, new ones join today
  teamUserIds: z.array(z.string().min(1)).max(50).optional(),
});

// PATCH /api/compliance/work-types/[id] – Admins and Partners
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess({ manager: true });
  if (error) return error;
  const { id } = await params;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { teamUserIds, ...data } = body.data;

  const workType = await prisma.complianceWorkType.findUnique({ where: { id }, include: { team: { where: { toDate: null } } } });
  if (!workType) return notFound("Work not found");
  if (data.name && data.name !== workType.name && (await prisma.complianceWorkType.findUnique({ where: { name: data.name } }))) {
    return badRequest("A work with this name already exists");
  }

  await prisma.$transaction(async (tx) => {
    await tx.complianceWorkType.update({ where: { id }, data });
    if (teamUserIds) {
      const users = await tx.user.findMany({ where: { id: { in: teamUserIds }, isActive: true }, select: { id: true } });
      const wanted = new Set(users.map((u) => u.id));
      const current = new Set(workType.team.map((t) => t.userId));
      const leaving = workType.team.filter((t) => !wanted.has(t.userId)).map((t) => t.id);
      if (leaving.length) await tx.complianceTeamMember.updateMany({ where: { id: { in: leaving } }, data: { toDate: new Date() } });
      const joining = [...wanted].filter((userId) => !current.has(userId));
      if (joining.length) await tx.complianceTeamMember.createMany({ data: joining.map((userId) => ({ workTypeId: id, userId })) });
    }
  });

  const updated = await prisma.complianceWorkType.findUniqueOrThrow({ where: { id }, include: workTypeInclude });
  return NextResponse.json(serializeWorkType(updated, access.isManager));
}
