import {
  ClientCompliance,
  ComplianceDocKind,
  ComplianceFrequency,
  ComplianceKind,
  ComplianceStatus,
  ComplianceWorkType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultBillType, getBillingManagerIds, notifyBillingUsers } from "@/lib/billing";
import { COMPANY_LABELS, formatRupees } from "@/lib/billing-constants";
import {
  addMonths,
  dueDateFor,
  formatDay,
  monthsIn,
  periodContaining,
  periodEndOf,
  periodLabel,
  quarterOf,
  todayIST,
} from "@/lib/compliance-periods";

// Recurring compliance work (see docs/COMPLIANCE.md). This file holds the rules:
// who may change what, when items are created, what locks an item and what an
// item needs before it counts as completed (and goes to billing).

// ─── Access ──────────────────────────────────────────────────────────────────

export interface ComplianceAccess {
  userId: string;
  name: string;
  // Admins and Partners: setup, every item, Claude notes
  isManager: boolean;
  // Only Admin may record someone else as the one who completed a filing
  isAdmin: boolean;
  // Work types the user is currently on the team of
  teamWorkTypeIds: Set<string>;
  // Work types that have a team at all; anyone may work on the others
  staffedWorkTypeIds: Set<string>;
}

export async function getComplianceAccess(userId: string): Promise<ComplianceAccess | null> {
  const [user, teams] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true, isActive: true } }),
    prisma.complianceTeamMember.findMany({ where: { toDate: null }, select: { workTypeId: true, userId: true } }),
  ]);
  if (!user || !user.isActive) return null;
  return {
    userId,
    name: user.name,
    isManager: user.role === "ADMIN" || user.role === "PARTNER",
    isAdmin: user.role === "ADMIN",
    teamWorkTypeIds: new Set(teams.filter((t) => t.userId === userId).map((t) => t.workTypeId)),
    staffedWorkTypeIds: new Set(teams.map((t) => t.workTypeId)),
  };
}

// Admins/Partners, the work type's current team, or anyone if it has no team
export function canWorkOn(access: ComplianceAccess, workTypeId: string) {
  return access.isManager || access.teamWorkTypeIds.has(workTypeId) || !access.staffedWorkTypeIds.has(workTypeId);
}

// ─── Figures used in the reconciliation ──────────────────────────────────────

export const FIGURE_FIELDS: Partial<Record<ComplianceKind, { key: string; label: string }[]>> = {
  GSTR1: [
    { key: "taxable", label: "Taxable value" },
    { key: "tax", label: "Total tax" },
    { key: "taxable1A", label: "GSTR-1A: change in taxable value" },
    { key: "tax1A", label: "GSTR-1A: change in tax" },
  ],
  GSTR3B: [
    { key: "taxable", label: "Outward taxable value (3.1a)" },
    { key: "outputTax", label: "Outward tax" },
    { key: "itcClaimed", label: "ITC claimed" },
    { key: "itc2b", label: "ITC available as per GSTR-2B" },
    { key: "rcmTax", label: "RCM tax paid" },
    { key: "cashPaid", label: "Tax paid in cash" },
  ],
  TDS_RETURN: [
    { key: "deducted", label: "TDS deducted" },
    { key: "deposited", label: "TDS deposited" },
    { key: "deductees", label: "Number of deductees" },
    { key: "challans", label: "Number of challans" },
  ],
};

// Figures that must be entered when a TDS return is marked filed
export const TDS_RETURN_REQUIRED_FIGURES = ["deducted", "deposited", "deductees", "challans"];

export const TDS_SECTIONS = [
  "192", "192A", "193", "194", "194A", "194B", "194C", "194D", "194H", "194I(a)", "194I(b)",
  "194IA", "194IB", "194J(a)", "194J(b)", "194M", "194N", "194O", "194Q", "194R", "194S", "195", "Other",
];

// Challans of these sections go in 24Q; all others in 26Q
export const SALARY_SECTIONS = ["192"];

export const DOC_KIND_LABELS: Record<ComplianceDocKind, string> = {
  RETURN_PDF: "Return PDF",
  RETURN_JSON: "Return JSON",
  GSTR1A_PDF: "GSTR-1A PDF",
  GSTR1A_JSON: "GSTR-1A JSON",
  GSTR2B_JSON: "GSTR-2B JSON",
  CHALLAN: "Challan",
  CERTIFICATE: "Form 16/16A",
  OTHER: "Other",
};

export const STATUS_LABELS: Record<ComplianceStatus, string> = {
  pending: "Pending",
  data_received: "Data received",
  filed: "Filed",
  completed: "Completed",
  not_required: "Not required",
};

const DONE: ComplianceStatus[] = ["completed", "not_required"];
const FILED_OR_DONE: ComplianceStatus[] = ["filed", "completed", "not_required"];

// ─── Creating items ──────────────────────────────────────────────────────────

export type SubscriptionWithRefs = ClientCompliance & {
  workType: ComplianceWorkType;
  client: { gstin: string | null };
};

export const subscriptionInclude = {
  workType: true,
  client: { select: { gstin: true } },
} satisfies Prisma.ClientComplianceInclude;

// The frequency a subscription has in the period starting on `date` (a change
// between monthly and quarterly applies from frequencyFrom)
export function frequencyAt(
  sub: Pick<ClientCompliance, "frequency" | "previousFrequency" | "frequencyFrom">,
  date: Date
): ComplianceFrequency {
  return sub.previousFrequency && sub.frequencyFrom && date < sub.frequencyFrom ? sub.previousFrequency : sub.frequency;
}

function tracks(sub: SubscriptionWithRefs, periodStart: Date) {
  return (
    sub.active &&
    sub.workType.active &&
    periodStart >= sub.startPeriod &&
    (!sub.endPeriod || periodStart <= sub.endPeriod)
  );
}

// The day an item appears: leadDays before the period ends (or before the due
// date, if that is earlier)
export function appearsOn(sub: SubscriptionWithRefs, periodStart: Date): Date {
  const frequency = frequencyAt(sub, periodStart);
  const end = periodEndOf(frequency, periodStart);
  const due = dueDateFor(sub.workType, frequency, end, sub.client.gstin);
  const earliest = due < end ? due : end;
  return new Date(earliest.getTime() - sub.workType.leadDays * 86_400_000);
}

// Creates the items that don't exist yet (never changes existing ones) and
// adds RCM/TDS lines to open items for obligations they don't have yet.
// Each periodStart must be the start of a period of the subscription's
// frequency at that date.
export async function ensureItems(pairs: { sub: SubscriptionWithRefs; periodStart: Date }[]) {
  const wanted = pairs.filter(({ sub, periodStart }) => tracks(sub, periodStart));
  if (wanted.length === 0) return;

  await prisma.complianceItem.createMany({
    data: wanted.map(({ sub, periodStart }) => {
      const frequency = frequencyAt(sub, periodStart);
      const periodEnd = periodEndOf(frequency, periodStart);
      return {
        clientId: sub.clientId,
        workTypeId: sub.workTypeId,
        frequency,
        periodStart,
        periodEnd,
        dueDate: dueDateFor(sub.workType, frequency, periodEnd, sub.client.gstin),
      };
    }),
    skipDuplicates: true,
  });

  await addObligationLines(wanted);
}

async function addObligationLines(pairs: { sub: SubscriptionWithRefs; periodStart: Date }[]) {
  const candidates = pairs.filter(({ sub }) => sub.workType.kind === "GSTR3B" || sub.workType.kind === "TDS_PAYMENT");
  if (candidates.length === 0) return;
  await addLinesToOpenItems(
    [...new Set(candidates.map(({ sub }) => sub.clientId))],
    candidates.map(({ sub, periodStart }) => ({ clientId: sub.clientId, workTypeId: sub.workTypeId, periodStart }))
  );
}

// Gives open GSTR-3B / TDS payment items (of `only`, or every open one of the
// clients) the RCM/TDS lines they don't have yet. Every open period is covered,
// so a monthly payment added late still reaches older periods not filed yet.
// Past periods entered by hand never get lines.
export async function addLinesToOpenItems(
  clientIds: string[],
  only?: { clientId: string; workTypeId: string; periodStart: Date }[]
) {
  // Only clients that have obligations get lines
  const obligations = await prisma.clientObligation.findMany({
    where: { clientId: { in: clientIds }, active: true },
  });
  if (obligations.length === 0) return;
  const withObligations = new Set(obligations.map((o) => o.clientId));
  const wanted = only?.filter((o) => withObligations.has(o.clientId));
  if (wanted && wanted.length === 0) return;

  const items = await prisma.complianceItem.findMany({
    where: {
      ...(wanted ? { OR: wanted } : { clientId: { in: [...withObligations] } }),
      workType: { kind: { in: ["GSTR3B", "TDS_PAYMENT"] } },
      status: { notIn: DONE },
      historical: false,
    },
    select: { id: true, clientId: true, frequency: true, periodStart: true, workType: { select: { kind: true } } },
  });

  const lines: Prisma.ComplianceObligationLineCreateManyInput[] = [];
  for (const item of items) {
    const kind = item.workType.kind === "GSTR3B" ? "RCM" : "TDS";
    for (const ob of obligations) {
      if (ob.clientId !== item.clientId || ob.kind !== kind) continue;
      // Months of the period in which the obligation applies
      let months = 0;
      for (let i = 0; i < monthsIn(item.frequency); i++) {
        const month = addMonths(item.periodStart, i);
        if (month >= ob.fromMonth && (!ob.toMonth || month <= ob.toMonth)) months++;
      }
      if (months === 0) continue;
      const base = ob.fixedAmount !== null ? Number(ob.fixedAmount) * months : null;
      lines.push({
        itemId: item.id,
        obligationId: ob.id,
        baseAmount: base,
        taxAmount: base !== null ? Math.round(base * Number(ob.ratePercent)) / 100 : null,
      });
    }
  }
  if (lines.length) await prisma.complianceObligationLine.createMany({ data: lines, skipDuplicates: true });
}

// For every active subscription (of the given work types / clients): the
// previous, current and next period, each once it should appear
export async function ensureItemsAround(workTypeIds: string[] | null, date: Date = todayIST(), clientIds?: string[]) {
  const subs = await prisma.clientCompliance.findMany({
    where: {
      active: true,
      ...(workTypeIds && { workTypeId: { in: workTypeIds } }),
      ...(clientIds && { clientId: { in: clientIds } }),
    },
    include: subscriptionInclude,
  });
  const pairs: { sub: SubscriptionWithRefs; periodStart: Date }[] = [];
  for (const sub of subs) {
    const starts = new Map<number, Date>();
    for (const frequency of new Set([sub.frequency, sub.previousFrequency ?? sub.frequency])) {
      const months = monthsIn(frequency);
      const current = periodContaining(frequency, date).start;
      for (const start of [addMonths(current, -months), current, addMonths(current, months)]) {
        if (frequencyAt(sub, start) === frequency) starts.set(start.getTime(), start);
      }
    }
    for (const start of starts.values()) {
      if (appearsOn(sub, start) <= date) pairs.push({ sub, periodStart: start });
    }
  }
  await ensureItems(pairs);
}

// ─── Locks ───────────────────────────────────────────────────────────────────

export interface LockableItem {
  id: string;
  clientId: string;
  workTypeId: string;
  kind: ComplianceKind;
  frequency: ComplianceFrequency;
  periodStart: Date;
  periodEnd: Date;
}

// Why each item can't be filed yet (only locked items are in the map):
// - GSTR-1: every earlier GSTR-1 must be completed and the previous GSTR-3B filed
// - GSTR-3B: this period's GSTR-1 and the previous GSTR-3B must be filed, and
//   every RCM line confirmed or skipped (so an RCM payment is never missed)
// Periods before tracking started have no items and don't lock anything.
// A TDS return is not locked; see tdsReturnWarnings.
export async function computeLocks(items: LockableItem[]): Promise<Map<string, string>> {
  const locks = new Map<string, string>();
  const gst = items.filter((i) => i.kind === "GSTR1" || i.kind === "GSTR3B");
  if (gst.length === 0) return locks;

  const clientIds = [...new Set(gst.map((i) => i.clientId))];
  const maxStart = new Date(Math.max(...gst.map((i) => i.periodStart.getTime())));
  const recentFrom = addMonths(new Date(Math.min(...gst.map((i) => i.periodStart.getTime()))), -12);
  const threeBIds = gst.filter((i) => i.kind === "GSTR3B").map((i) => i.id);
  // The last year's GST items, and any older GSTR-1 still open
  const [earlier, pendingLines] = await Promise.all([
    prisma.complianceItem.findMany({
      where: {
        clientId: { in: clientIds },
        periodStart: { lte: maxStart },
        OR: [
          { workType: { kind: { in: ["GSTR1", "GSTR3B"] } }, periodStart: { gte: recentFrom } },
          { workType: { kind: "GSTR1" }, periodStart: { lt: recentFrom }, status: { notIn: DONE } },
        ],
      },
      select: { clientId: true, periodStart: true, frequency: true, status: true, workType: { select: { kind: true } } },
      orderBy: { periodStart: "desc" },
    }),
    threeBIds.length
      ? prisma.complianceObligationLine.groupBy({
          by: ["itemId"],
          where: { itemId: { in: threeBIds }, status: "pending" },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  for (const item of gst) {
    const mine = earlier.filter((e) => e.clientId === item.clientId);
    const openGstr1 = mine
      .filter((e) => e.workType.kind === "GSTR1" && e.periodStart < item.periodStart && !DONE.includes(e.status))
      .pop(); // oldest open one
    const previous3b = mine.find((e) => e.workType.kind === "GSTR3B" && e.periodStart < item.periodStart);
    const reasons: string[] = [];
    if (item.kind === "GSTR1" && openGstr1) {
      reasons.push(`GSTR-1 ${periodLabel(openGstr1.frequency, openGstr1.periodStart)} is not completed`);
    }
    if (item.kind === "GSTR3B") {
      const gstr1 = mine.find((e) => e.workType.kind === "GSTR1" && e.periodStart.getTime() === item.periodStart.getTime());
      if (gstr1 && !FILED_OR_DONE.includes(gstr1.status)) reasons.push("GSTR-1 of this period is not filed");
      const open = pendingLines.find((l) => l.itemId === item.id)?._count._all ?? 0;
      if (open > 0) reasons.push(`${open === 1 ? "1 RCM line is" : `${open} RCM lines are`} not confirmed or skipped`);
    }
    if (previous3b && !FILED_OR_DONE.includes(previous3b.status)) {
      reasons.push(`GSTR-3B ${periodLabel(previous3b.frequency, previous3b.periodStart)} is not filed`);
    }
    if (reasons.length) locks.set(item.id, reasons.join("; "));
  }
  return locks;
}

// The months of each TDS return's quarter whose TDS payment is not closed yet
// (only returns with such months are in the map). Months before the client's
// TDS payments were tracked are left out.
async function openTdsPaymentMonths(items: LockableItem[]): Promise<Map<string, Date[]>> {
  const open = new Map<string, Date[]>();
  const tds = items.filter((i) => i.kind === "TDS_RETURN");
  if (tds.length === 0) return open;
  const clientIds = [...new Set(tds.map((i) => i.clientId))];
  const [payments, paymentSubs] = await Promise.all([
    prisma.complianceItem.findMany({
      where: { clientId: { in: clientIds }, workType: { kind: "TDS_PAYMENT" } },
      select: { clientId: true, periodStart: true, status: true },
    }),
    prisma.clientCompliance.findMany({
      where: { clientId: { in: clientIds }, active: true, workType: { kind: "TDS_PAYMENT", active: true } },
      select: { clientId: true, startPeriod: true },
    }),
  ]);
  for (const item of tds) {
    const sub = paymentSubs.find((s) => s.clientId === item.clientId);
    if (!sub) continue; // TDS payments not tracked for this client
    const months: Date[] = [];
    for (let i = 0; i < 3; i++) {
      const month = addMonths(item.periodStart, i);
      if (month < sub.startPeriod) continue;
      const payment = payments.find((p) => p.clientId === item.clientId && p.periodStart.getTime() === month.getTime());
      if (!payment || payment.status !== "completed") months.push(month);
    }
    if (months.length) open.set(item.id, months);
  }
  return open;
}

// What the filing window of a TDS return warns about. It does not stop the
// filing; the warning is kept in the item's history when it is filed anyway.
export async function tdsReturnWarnings(items: LockableItem[]): Promise<Map<string, string>> {
  const warnings = new Map<string, string>();
  const tds = items.filter((i) => i.kind === "TDS_RETURN");
  if (tds.length === 0) return warnings;
  const [openMonths, workTypes, challans] = await Promise.all([
    openTdsPaymentMonths(tds),
    prisma.complianceWorkType.findMany({ where: { id: { in: [...new Set(tds.map((i) => i.workTypeId))] } }, select: { id: true, returnType: true } }),
    prisma.tdsChallan.findMany({
      where: {
        item: {
          clientId: { in: [...new Set(tds.map((i) => i.clientId))] },
          workType: { kind: "TDS_PAYMENT" },
          periodStart: { gte: new Date(Math.min(...tds.map((i) => i.periodStart.getTime()))) },
        },
      },
      select: { section: true, item: { select: { clientId: true, periodStart: true } } },
    }),
  ]);
  for (const item of tds) {
    const parts: string[] = [];
    const months = openMonths.get(item.id);
    if (months) parts.push(`TDS payment not closed for ${months.map((m) => periodLabel("MONTHLY", m)).join(", ")}`);
    const salary = workTypes.find((w) => w.id === item.workTypeId)?.returnType === "24Q";
    const paid = challans.filter(
      (c) =>
        c.item.clientId === item.clientId &&
        c.item.periodStart >= item.periodStart &&
        c.item.periodStart <= item.periodEnd &&
        SALARY_SECTIONS.includes(c.section) === salary
    );
    const withoutChallans = [0, 1, 2]
      .map((i) => addMonths(item.periodStart, i))
      .filter((m) => !months?.some((o) => o.getTime() === m.getTime()) && !paid.some((c) => c.item.periodStart.getTime() === m.getTime()));
    if (paid.length === 0) parts.push(`No ${salary ? "salary " : ""}challans paid in the quarter`);
    else if (withoutChallans.length) parts.push(`No challans paid for ${withoutChallans.map((m) => periodLabel("MONTHLY", m)).join(", ")}`);
    if (parts.length) warnings.set(item.id, parts.join("; "));
  }
  return warnings;
}

// ─── TDS returns without challans ────────────────────────────────────────────

// A TDS return is needed only if the quarter has challans of its kind (24Q:
// salary, 26Q: everything else). Once the quarter's payments are all closed,
// a return without challans is marked "Not required"; if a challan is added
// later it becomes pending again.
export async function resolveTdsReturns(clientIds?: string[]) {
  const returns = await prisma.complianceItem.findMany({
    where: {
      ...(clientIds && { clientId: { in: clientIds } }),
      workType: { kind: "TDS_RETURN" },
      status: { in: ["pending", "not_required"] },
      historical: false,
      periodStart: { gte: addMonths(todayIST(), -15) },
    },
    select: {
      id: true,
      clientId: true,
      workTypeId: true,
      frequency: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      workType: { select: { returnType: true, kind: true } },
    },
  });
  if (returns.length === 0) return;

  const openMonths = await openTdsPaymentMonths(returns.map((r) => ({ ...r, kind: r.workType.kind })));
  const challans = await prisma.tdsChallan.findMany({
    where: {
      item: {
        clientId: { in: [...new Set(returns.map((r) => r.clientId))] },
        workType: { kind: "TDS_PAYMENT" },
        periodStart: { gte: new Date(Math.min(...returns.map((r) => r.periodStart.getTime()))) },
      },
    },
    select: { section: true, item: { select: { clientId: true, periodStart: true } } },
  });

  for (const ret of returns) {
    const salary = ret.workType.returnType === "24Q";
    const hasChallans = challans.some(
      (c) =>
        c.item.clientId === ret.clientId &&
        c.item.periodStart >= ret.periodStart &&
        c.item.periodStart <= ret.periodEnd &&
        SALARY_SECTIONS.includes(c.section) === salary
    );
    const next: ComplianceStatus | null =
      !openMonths.has(ret.id) && !hasChallans && ret.status === "pending"
        ? "not_required"
        : hasChallans && ret.status === "not_required"
          ? "pending"
          : null;
    if (!next) continue;
    await prisma.$transaction([
      prisma.complianceItem.update({ where: { id: ret.id }, data: { status: next } }),
      prisma.complianceEvent.create({
        data: {
          itemId: ret.id,
          action: next === "not_required" ? "not_required" : "reopened",
          remark: next === "not_required" ? "No challans in the quarter" : "A challan was added",
        },
      }),
    ]);
  }
}

// ─── Completion and billing ──────────────────────────────────────────────────

export const completionInclude = {
  workType: true,
  client: { select: { id: true, contactPerson: true, companyName: true } },
  documents: { select: { kind: true } },
  lines: { select: { status: true } },
  _count: { select: { challans: true } },
} satisfies Prisma.ComplianceItemInclude;

type ItemForCompletion = Prisma.ComplianceItemGetPayload<{ include: typeof completionInclude }>;

export function needsCertificates(item: { periodStart: Date }, workType: Pick<ComplianceWorkType, "kind" | "certificateRule">) {
  if (workType.kind !== "TDS_RETURN") return false;
  if (workType.certificateRule === "EVERY_QUARTER") return true;
  return workType.certificateRule === "Q4_ONLY" && quarterOf(item.periodStart) === 4;
}

// What a filed item still needs before it is completed (empty: nothing)
export function missingForCompletion(item: ItemForCompletion): string[] {
  const wt = item.workType;
  const kinds = new Set(item.documents.map((d) => d.kind));
  const missing: string[] = [];
  if (wt.requirePdf && !kinds.has("RETURN_PDF")) missing.push("Return PDF");
  if (wt.requireJson && !kinds.has("RETURN_JSON")) missing.push("Return JSON");
  if (item.lines.some((l) => l.status === "pending")) missing.push(wt.kind === "GSTR3B" ? "RCM lines" : "TDS lines");
  if (needsCertificates(item, wt)) {
    if (!item.certRequestedAt) missing.push("Form 16/16A request");
    if (!kinds.has("CERTIFICATE")) missing.push("Form 16/16A files");
    if (!item.certEmailedAt) missing.push("Form 16/16A emailed");
  }
  return missing;
}

export function partyName(client: { contactPerson: string; companyName: string | null }) {
  return client.companyName || client.contactPerson;
}

export async function logEvent(
  tx: Prisma.TransactionClient | typeof prisma,
  itemId: string,
  action: string,
  userId: string | null,
  remark?: string | null
) {
  await tx.complianceEvent.create({ data: { itemId, action, userId, remark: remark || null } });
}

// Suggested fee for a completed item: the item's own fee, else the client's
// nil/non-nil fee, else the work type's default
async function suggestedFee(item: ItemForCompletion): Promise<{ amount: number | null; source: string }> {
  if (item.fee !== null) return { amount: Number(item.fee), source: "fee set on this period" };
  const sub = await prisma.clientCompliance.findUnique({
    where: { clientId_workTypeId: { clientId: item.clientId, workTypeId: item.workTypeId } },
    select: { feeNil: true, feeNonNil: true },
  });
  const nil = item.isNil === true;
  const clientFee = nil ? sub?.feeNil : sub?.feeNonNil;
  if (clientFee != null) return { amount: Number(clientFee), source: `client's ${nil ? "nil" : "non-nil"} fee` };
  const defaultFee = nil ? item.workType.defaultFeeNil : item.workType.defaultFeeNonNil;
  if (defaultFee != null) return { amount: Number(defaultFee), source: `${nil ? "nil" : "non-nil"} fee of ${item.workType.name}` };
  return { amount: null, source: "" };
}

// Marks a filed item completed once it has everything it needs, and creates
// its draft bill if the work is billable. The billing manager checks the
// suggested fee and approves it as usual (see docs/BILLING.md).
// Returns true when the item was completed now.
export async function completeIfReady(itemId: string, userId: string): Promise<boolean> {
  const item = await prisma.complianceItem.findUnique({ where: { id: itemId }, include: completionInclude });
  if (!item || item.status !== "filed" || missingForCompletion(item).length > 0) return false;

  const wt = item.workType;
  const label = periodLabel(item.frequency, item.periodStart);
  const billing = wt.billable && !item.historical && !item.billId;
  const fee = billing ? await suggestedFee(item) : null;
  const type = billing ? await defaultBillType(wt.company, item.clientId) : null;

  const billId = await prisma.$transaction(async (tx) => {
    const { count } = await tx.complianceItem.updateMany({
      where: { id: itemId, status: "filed" },
      data: { status: "completed", completedAt: new Date(), updatedById: userId },
    });
    if (count === 0) return undefined;
    await logEvent(tx, itemId, "completed", userId);
    if (!billing || !fee) return null;
    const bill = await tx.bill.create({
      data: {
        company: wt.company,
        type,
        description:
          `Filing of ${wt.name} for ${label}${item.isNil ? " (Nil)" : ""}` + (item.arn ? `\nARN / Ack. No.: ${item.arn}` : ""),
        workDate: item.filedAt ?? todayIST(),
        remark: fee.amount !== null ? `Suggested fee ${formatRupees(fee.amount)} (${fee.source})` : "No fee set for this work: enter the amount",
        amount: fee.amount,
        clientId: item.clientId,
        createdById: userId,
      },
    });
    await tx.complianceItem.update({ where: { id: itemId }, data: { billId: bill.id } });
    await logEvent(tx, itemId, "sent_to_billing", userId, fee.amount !== null ? `Suggested fee ${formatRupees(fee.amount)}` : null);
    return bill.id;
  });
  if (billId === undefined) return false;

  if (billId) {
    const managerIds = await getBillingManagerIds(wt.company);
    await notifyBillingUsers(managerIds.filter((id) => id !== userId), {
      title: "Compliance work ready for billing",
      content: `${wt.name} ${label} for ${partyName(item.client)} is completed (${COMPANY_LABELS[wt.company]}). Check the fee and approve the bill.`,
      sentById: userId,
    });
  }
  return true;
}

// ─── Reminder messages ───────────────────────────────────────────────────────

export function renderMessage(
  template: string,
  values: { client: string; work: string; period: string; due: Date; taxPayable: number | null; firm: string }
) {
  return template
    .replaceAll("{client}", values.client)
    .replaceAll("{work}", values.work)
    .replaceAll("{period}", values.period)
    .replaceAll("{due}", formatDay(values.due))
    .replaceAll("{taxPayable}", values.taxPayable ? ` Tax payable: ${formatRupees(values.taxPayable)}.` : "")
    .replaceAll("{firm}", values.firm);
}

export { whatsappNumber } from "@/lib/client-contacts";
