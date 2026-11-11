import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ComplianceAccess, logEvent } from "@/lib/compliance";
import { periodLabel } from "@/lib/compliance-periods";

// Adjustments made in a return, in the staff's own words (docs/COMPLIANCE.md).
// Internal only: never put in a message to the client.

export const ADJUSTMENT_MAX = 2000;

export const adjustmentInput = z.object({
  body: z.string().trim().min(3, "Write the adjustment in a few words").max(ADJUSTMENT_MAX),
  followUp: z.boolean().optional(),
});

const IST_OFFSET = 5.5 * 3_600_000;
const istDay = (date: Date) => new Date(date.getTime() + IST_OFFSET).toISOString().slice(0, 10);

export const adjustmentSelect = {
  id: true,
  itemId: true,
  body: true,
  followUp: true,
  createdAt: true,
  editedAt: true,
  createdById: true,
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} satisfies Prisma.ComplianceAdjustmentSelect;

type AdjustmentRow = Prisma.ComplianceAdjustmentGetPayload<{ select: typeof adjustmentSelect }>;

// The author on the day it was written; Admins and Partners at any time
export function canChangeAdjustment(row: { createdById: string | null; createdAt: Date }, access: ComplianceAccess) {
  return access.isManager || (row.createdById === access.userId && istDay(row.createdAt) === istDay(new Date()));
}

export function serializeAdjustment(row: AdjustmentRow, access: ComplianceAccess, canWork = true) {
  return {
    id: row.id,
    itemId: row.itemId,
    body: row.body,
    followUp: row.followUp,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    author: row.createdBy?.name ?? null,
    editedBy: row.updatedBy?.name ?? null,
    canChange: canWork && canChangeAdjustment(row, access),
  };
}

export type AdjustmentView = ReturnType<typeof serializeAdjustment>;

// The adjustments of one period, oldest first
export async function itemAdjustments(itemId: string, access: ComplianceAccess, canWork: boolean) {
  const rows = await prisma.complianceAdjustment.findMany({
    where: { itemId },
    orderBy: { createdAt: "asc" },
    select: adjustmentSelect,
  });
  return rows.map((r) => serializeAdjustment(r, access, canWork));
}

// Adjustments marked "follow up next period" on the period just before this
// one of the same work and client
export async function previousFollowUps(
  item: { clientId: string; workTypeId: string; periodStart: Date },
  access: ComplianceAccess
) {
  const previous = await prisma.complianceItem.findFirst({
    where: { clientId: item.clientId, workTypeId: item.workTypeId, periodStart: { lt: item.periodStart } },
    orderBy: { periodStart: "desc" },
    select: {
      frequency: true,
      periodStart: true,
      adjustments: { where: { followUp: true }, orderBy: { createdAt: "asc" }, select: adjustmentSelect },
    },
  });
  if (!previous || previous.adjustments.length === 0) return null;
  return {
    period: periodLabel(previous.frequency, previous.periodStart),
    adjustments: previous.adjustments.map((r) => serializeAdjustment(r, access, false)),
  };
}

const snippet = (body: string) => (body.length > 80 ? `${body.slice(0, 77)}…` : body);

export async function addAdjustment(
  tx: Prisma.TransactionClient | typeof prisma,
  itemId: string,
  userId: string,
  input: z.infer<typeof adjustmentInput>
) {
  await tx.complianceAdjustment.create({
    data: { itemId, body: input.body, followUp: input.followUp ?? false, createdById: userId },
  });
  await logEvent(tx, itemId, "adjustment_added", userId, snippet(input.body));
}

export async function editAdjustment(
  tx: Prisma.TransactionClient | typeof prisma,
  id: string,
  itemId: string,
  userId: string,
  input: z.infer<typeof adjustmentInput>
) {
  await tx.complianceAdjustment.update({
    where: { id },
    data: { body: input.body, followUp: input.followUp ?? false, updatedById: userId, editedAt: new Date() },
  });
  await logEvent(tx, itemId, "adjustment_edited", userId, snippet(input.body));
}

export async function deleteAdjustment(
  tx: Prisma.TransactionClient | typeof prisma,
  id: string,
  itemId: string,
  userId: string,
  body: string
) {
  await tx.complianceAdjustment.delete({ where: { id } });
  await logEvent(tx, itemId, "adjustment_deleted", userId, snippet(body));
}
