import { Prisma } from "@prisma/client";

// Work types as sent to the browser (Compliance → Setup)

export const workTypeInclude = {
  team: { where: { toDate: null }, select: { user: { select: { id: true, name: true } } }, orderBy: { fromDate: "asc" } },
  _count: { select: { subscriptions: { where: { active: true } } } },
} satisfies Prisma.ComplianceWorkTypeInclude;

export function serializeWorkType(wt: Prisma.ComplianceWorkTypeGetPayload<{ include: typeof workTypeInclude }>, isManager: boolean) {
  return {
    id: wt.id,
    name: wt.name,
    kind: wt.kind,
    frequency: wt.frequency,
    allowQuarterly: wt.allowQuarterly,
    company: wt.company,
    dueDay: wt.dueDay,
    dueMonthOffset: wt.dueMonthOffset,
    quarterlyDueDay: wt.quarterlyDueDay,
    quarterlyDueMonthOffset: wt.quarterlyDueMonthOffset,
    leadDays: wt.leadDays,
    returnType: wt.returnType,
    certificateRule: wt.certificateRule,
    requirePdf: wt.requirePdf,
    requireJson: wt.requireJson,
    billable: wt.billable,
    // Fees only for Admins and Partners
    defaultFeeNil: isManager && wt.defaultFeeNil !== null ? Number(wt.defaultFeeNil) : null,
    defaultFeeNonNil: isManager && wt.defaultFeeNonNil !== null ? Number(wt.defaultFeeNonNil) : null,
    reminderSubject: wt.reminderSubject,
    reminderMessage: wt.reminderMessage,
    sortOrder: wt.sortOrder,
    active: wt.active,
    system: wt.system,
    team: wt.team.map((t) => t.user),
    clients: wt._count.subscriptions,
  };
}
