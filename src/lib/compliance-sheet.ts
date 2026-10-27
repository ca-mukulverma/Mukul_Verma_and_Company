import { ComplianceWorkType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canWorkOn,
  ComplianceAccess,
  computeLocks,
  ensureItems,
  frequencyAt,
  missingForCompletion,
  needsCertificates,
  partyName,
  resolveTdsReturns,
  subscriptionInclude,
  SubscriptionWithRefs,
  tdsReturnWarnings,
} from "@/lib/compliance";
import { addMonths, dateKey, periodEndOf, periodLabel, todayIST } from "@/lib/compliance-periods";
import { clientContactSelect, reminderContacts } from "@/lib/client-contacts";

// The data behind the sheets on the Compliance page: one row per client, one
// cell per item. Opening a sheet also creates the period's missing items.

export const sheetItemInclude = {
  workType: true,
  client: { select: clientContactSelect },
  documents: { select: { id: true, kind: true, fileName: true, size: true, createdAt: true }, orderBy: { createdAt: "asc" } },
  lines: { include: { obligation: true, resolvedBy: { select: { name: true } } }, orderBy: { obligation: { createdAt: "asc" } } },
  challans: { orderBy: { challanDate: "asc" } },
  bill: { select: { id: true, status: true } },
  updatedBy: { select: { name: true } },
  completedBy: { select: { id: true, name: true } },
  checkedBy: { select: { id: true, name: true } },
  _count: { select: { challans: true } },
} satisfies Prisma.ComplianceItemInclude;

export type SheetItemRecord = Prisma.ComplianceItemGetPayload<{ include: typeof sheetItemInclude }>;

const num = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

// Files a past period still lacks (it is completed when saved; these show as tags)
function missingFiles(item: SheetItemRecord) {
  const kinds = new Set(item.documents.map((d) => d.kind));
  return [
    ...(item.workType.requirePdf && !kinds.has("RETURN_PDF") ? ["PDF"] : []),
    ...(item.workType.requireJson && !kinds.has("RETURN_JSON") ? ["JSON"] : []),
  ];
}

export function serializeItem(
  item: SheetItemRecord,
  access: ComplianceAccess,
  lockReason: string | null,
  warning: string | null = null
) {
  const today = todayIST();
  const open = item.status === "pending" || item.status === "data_received";
  return {
    id: item.id,
    clientId: item.clientId,
    workTypeId: item.workTypeId,
    workTypeName: item.workType.name,
    kind: item.workType.kind,
    status: item.status,
    frequency: item.frequency,
    period: periodLabel(item.frequency, item.periodStart),
    periodStart: dateKey(item.periodStart),
    dueDate: dateKey(item.dueDate),
    overdue: open && !item.historical && item.dueDate < today,
    lockReason,
    // TDS return: challans not paid / payments not closed; filing is allowed
    warning,
    historical: item.historical,
    filesMissing: item.historical && item.status === "completed" ? missingFiles(item) : [],
    dataReceivedAt: item.dataReceivedAt?.toISOString() ?? null,
    filedAt: item.filedAt ? dateKey(item.filedAt) : null,
    arn: item.arn,
    isNil: item.isNil,
    taxPayable: num(item.taxPayable),
    figures: (item.figures ?? {}) as Record<string, number>,
    gstr1aFiled: item.gstr1aFiled,
    gstr1aFiledAt: item.gstr1aFiledAt ? dateKey(item.gstr1aFiledAt) : null,
    gstr1aArn: item.gstr1aArn,
    noTds: item.noTds,
    needsCertificates: needsCertificates(item, item.workType),
    certRequestedAt: item.certRequestedAt ? dateKey(item.certRequestedAt) : null,
    certRequestNo: item.certRequestNo,
    certEmailedAt: item.certEmailedAt?.toISOString() ?? null,
    certEmailedTo: item.certEmailedTo,
    completedAt: item.completedAt?.toISOString() ?? null,
    missing: item.status === "filed" ? missingForCompletion(item) : [],
    reminderCount: item.reminderCount,
    lastReminderAt: item.lastReminderAt?.toISOString() ?? null,
    billStatus: item.bill?.status ?? null,
    requirePdf: item.workType.requirePdf,
    requireJson: item.workType.requireJson,
    documents: item.documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
    lines: item.lines.map((l) => ({
      id: l.id,
      label: `${l.obligation.category} – ${l.obligation.payee}`,
      ratePercent: Number(l.obligation.ratePercent),
      fixed: l.obligation.fixedAmount !== null,
      baseAmount: num(l.baseAmount),
      taxAmount: num(l.taxAmount),
      status: l.status,
      note: l.note,
      resolvedBy: l.resolvedBy?.name ?? null,
    })),
    challans: item.challans.map((c) => ({
      id: c.id,
      section: c.section,
      bsrCode: c.bsrCode,
      challanDate: dateKey(c.challanDate),
      serialNo: c.serialNo,
      amount: Number(c.amount),
    })),
    updatedBy: item.updatedBy?.name ?? null,
    completedBy: item.completedBy,
    checkedBy: item.checkedBy,
    selfChecked: !!item.completedById && item.completedById === item.checkedById,
    updatedAt: item.updatedAt.toISOString(),
    canEdit: canWorkOn(access, item.workTypeId),
  };
}

export type SheetItem = ReturnType<typeof serializeItem>;

// Serializes items with their locks and warnings (both only for open items)
export async function serializeItems(items: SheetItemRecord[], access: ComplianceAccess) {
  const lockable = items
    .filter((i) => !i.historical && (i.status === "pending" || i.status === "data_received"))
    .map((i) => ({ ...i, kind: i.workType.kind }));
  const [locks, warnings] = await Promise.all([computeLocks(lockable), tdsReturnWarnings(lockable)]);
  return items.map((item) => serializeItem(item, access, locks.get(item.id) ?? null, warnings.get(item.id) ?? null));
}

export async function loadSheetItem(id: string, access: ComplianceAccess) {
  const item = await prisma.complianceItem.findUnique({ where: { id }, include: sheetItemInclude });
  if (!item) return null;
  const [serialized] = await serializeItems([item], access);
  return serialized;
}

function clientRow(client: SheetItemRecord["client"]) {
  return { id: client.id, name: partyName(client), gstin: client.gstin, ...reminderContacts(client) };
}

// Items may be created for periods up to next month, not further ahead
function mayCreate(periodStart: Date) {
  return periodStart <= addMonths(todayIST(), 1);
}

async function subscriptionsOf(workTypes: ComplianceWorkType[]): Promise<SubscriptionWithRefs[]> {
  return prisma.clientCompliance.findMany({
    where: { active: true, workTypeId: { in: workTypes.map((w) => w.id) } },
    include: subscriptionInclude,
  });
}

// GST sheet for a month: monthly filers' items for that month, and quarterly
// filers' items in the quarter's last month
export async function gstSheet(month: Date, access: ComplianceAccess) {
  const workTypes = await prisma.complianceWorkType.findMany({
    where: { active: true, kind: { in: ["GSTR1", "GSTR3B"] } },
    orderBy: { sortOrder: "asc" },
  });
  const quarterEnd = [3, 6, 9, 12].includes(month.getUTCMonth() + 1);
  const subs = await subscriptionsOf(workTypes);
  await ensureItems(
    subs.flatMap((sub) => {
      const frequency = frequencyAt(sub, month);
      const start = frequency === "MONTHLY" ? month : frequency === "QUARTERLY" && quarterEnd ? addMonths(month, -2) : null;
      if (start && frequencyAt(sub, start) !== frequency) return [];
      return start && mayCreate(start) ? [{ sub, periodStart: start }] : [];
    })
  );

  const items = await prisma.complianceItem.findMany({
    where: {
      workTypeId: { in: workTypes.map((w) => w.id) },
      periodEnd: { gte: month, lte: periodEndOf("MONTHLY", month) },
    },
    include: sheetItemInclude,
  });
  const serialized = await serializeItems(items, access);
  const rows = new Map<string, { client: ReturnType<typeof clientRow>; gstr1: SheetItem | null; gstr3b: SheetItem | null }>();
  items.forEach((item, i) => {
    const row = rows.get(item.clientId) ?? { client: clientRow(item.client), gstr1: null, gstr3b: null };
    if (item.workType.kind === "GSTR1") row.gstr1 = serialized[i];
    else row.gstr3b = serialized[i];
    rows.set(item.clientId, row);
  });
  return { rows: [...rows.values()].sort((a, b) => a.client.name.localeCompare(b.client.name)) };
}

// TDS sheet for a quarter: the three monthly payments and the returns
export async function tdsSheet(quarterStart: Date, access: ComplianceAccess) {
  const workTypes = await prisma.complianceWorkType.findMany({
    where: { active: true, kind: { in: ["TDS_PAYMENT", "TDS_RETURN"] } },
    orderBy: { sortOrder: "asc" },
  });
  const months = [0, 1, 2].map((i) => addMonths(quarterStart, i));
  const subs = await subscriptionsOf(workTypes);
  await ensureItems(
    subs.flatMap((sub) => {
      const starts = sub.workType.kind === "TDS_PAYMENT" ? months : [quarterStart];
      return starts.filter(mayCreate).map((periodStart) => ({ sub, periodStart }));
    })
  );
  await resolveTdsReturns([...new Set(subs.map((s) => s.clientId))]);

  const items = await prisma.complianceItem.findMany({
    where: {
      workTypeId: { in: workTypes.map((w) => w.id) },
      periodStart: { gte: quarterStart, lte: months[2] },
    },
    include: sheetItemInclude,
  });
  const serialized = await serializeItems(items, access);
  const returnTypes = workTypes.filter((w) => w.kind === "TDS_RETURN").map((w) => ({ id: w.id, name: w.name }));
  const rows = new Map<
    string,
    { client: ReturnType<typeof clientRow>; months: (SheetItem | null)[]; returns: Record<string, SheetItem> }
  >();
  items.forEach((item, i) => {
    const row = rows.get(item.clientId) ?? { client: clientRow(item.client), months: [null, null, null], returns: {} };
    if (item.workType.kind === "TDS_PAYMENT") {
      const index = months.findIndex((m) => m.getTime() === item.periodStart.getTime());
      if (index >= 0) row.months[index] = serialized[i];
    } else {
      row.returns[item.workTypeId] = serialized[i];
    }
    rows.set(item.clientId, row);
  });
  return {
    months: months.map((m) => periodLabel("MONTHLY", m)),
    returnTypes,
    rows: [...rows.values()].sort((a, b) => a.client.name.localeCompare(b.client.name)),
  };
}

// Sheet of one work type for one period
export async function workSheet(workTypeId: string, periodStart: Date, access: ComplianceAccess) {
  const workType = await prisma.complianceWorkType.findUnique({ where: { id: workTypeId } });
  if (!workType) return null;
  const subs = (await subscriptionsOf([workType])).filter((s) => s.frequency === workType.frequency);
  if (mayCreate(periodStart)) await ensureItems(subs.map((sub) => ({ sub, periodStart })));
  const items = await prisma.complianceItem.findMany({
    where: { workTypeId, periodStart },
    include: sheetItemInclude,
  });
  const serialized = await serializeItems(items, access);
  return {
    workType: { id: workType.id, name: workType.name, kind: workType.kind, frequency: workType.frequency },
    period: periodLabel(workType.frequency, periodStart),
    rows: items
      .map((item, i) => ({ client: clientRow(item.client), item: serialized[i] }))
      .sort((a, b) => a.client.name.localeCompare(b.client.name)),
  };
}
