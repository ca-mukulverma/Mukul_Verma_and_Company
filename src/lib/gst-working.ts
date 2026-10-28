import { ComplianceDocKind, ComplianceFrequency, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ComplianceAccess, completeIfReady, computeLocks, frequencyAt, logEvent, partyName } from "@/lib/compliance";
import { addMonths, dateKey, monthKey, monthsIn, parseDateKey, parseMonthKey, periodEndOf, periodLabel, todayIST, utcDate } from "@/lib/compliance-periods";
import { GstRead, isNil, totalTax } from "@/lib/gst-read/types";
import { buildPeriod, DocRead, ItemInfo, PeriodResult, swingIssues, sumRows } from "@/lib/gst-read/working";

// The GST working (see docs/GST_WORKING.md): every figure comes from the
// return files uploaded for the period, never typed in. This file loads the
// files and items, builds the periods, keeps the items' reconciliation
// figures in step and marks returns filed from their PDFs.

export const DEFAULT_SWING_PERCENT = 50;

export async function swingPercent(): Promise<number> {
  const setting = await prisma.complianceSetting.findUnique({ where: { key: "gstSwingPercent" } });
  const value = Number(setting?.value);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SWING_PERCENT;
}

// Which document kind and work a file read as each GST form belongs to
export function placementOf(read: GstRead): { kind: ComplianceDocKind; work: "GSTR1" | "GSTR3B" } {
  switch (read.form) {
    case "GSTR3B":
      return { kind: "RETURN_PDF", work: "GSTR3B" };
    case "GSTR2B":
      return { kind: "GSTR2B_JSON", work: "GSTR3B" };
    case "GSTR1A":
      return { kind: read.source === "JSON" ? "GSTR1A_JSON" : "GSTR1A_PDF", work: "GSTR1" };
    default:
      return { kind: read.source === "JSON" ? "RETURN_JSON" : "RETURN_PDF", work: "GSTR1" };
  }
}

const itemSelect = {
  id: true,
  clientId: true,
  workTypeId: true,
  frequency: true,
  periodStart: true,
  periodEnd: true,
  dueDate: true,
  status: true,
  filedAt: true,
  arn: true,
  gstr1aFiled: true,
  historical: true,
  workType: { select: { kind: true } },
} satisfies Prisma.ComplianceItemSelect;
type GstItem = Prisma.ComplianceItemGetPayload<{ select: typeof itemSelect }>;

const info = (item: GstItem | undefined): ItemInfo | null =>
  item
    ? {
        status: item.status,
        filedAt: item.filedAt ? dateKey(item.filedAt) : null,
        arn: item.arn,
        dueDate: dateKey(item.dueDate),
        gstr1aFiled: item.gstr1aFiled,
      }
    : null;

const monthsOf = (start: Date, count: number) => Array.from({ length: count }, (_, i) => monthKey(addMonths(start, i)));

// Every client's periods from one month to another (a quarter is included
// when it starts in the range). The GST items decide monthly or quarterly;
// the client's GST work, or the uploaded 3B, for periods without items.
export async function loadPeriods(clientIds: string[], from: Date, to: Date): Promise<Map<string, PeriodResult[]>> {
  const result = new Map<string, PeriodResult[]>();
  if (clientIds.length === 0) return result;
  const until = periodEndOf("QUARTERLY", to);
  const [items, subs, docs, percent] = await Promise.all([
    prisma.complianceItem.findMany({
      where: { clientId: { in: clientIds }, workType: { kind: { in: ["GSTR1", "GSTR3B"] } }, periodStart: { gte: from, lte: until } },
      select: itemSelect,
    }),
    prisma.clientCompliance.findMany({
      where: { clientId: { in: clientIds }, workType: { kind: { in: ["GSTR1", "GSTR3B"] } } },
      select: { clientId: true, frequency: true, previousFrequency: true, frequencyFrom: true, workType: { select: { kind: true } } },
    }),
    prisma.complianceDocument.findMany({
      where: { clientId: { in: clientIds }, gstMonth: { gte: from, lte: until }, gst: { not: Prisma.DbNull } },
      select: { id: true, clientId: true, fileName: true, createdAt: true, gst: true },
    }),
    swingPercent(),
  ]);

  for (const clientId of clientIds) {
    const mine = items.filter((i) => i.clientId === clientId);
    const myDocs: (DocRead & { clientId: string })[] = docs
      .filter((d) => d.clientId === clientId)
      .map((d) => ({ id: d.id, clientId, fileName: d.fileName, createdAt: d.createdAt.toISOString(), read: d.gst as unknown as GstRead }));
    const mySub = subs.find((s) => s.clientId === clientId && s.workType.kind === "GSTR3B") ?? subs.find((s) => s.clientId === clientId);
    const periods: PeriodResult[] = [];
    for (let m = from; m <= to; ) {
      const key = monthKey(m);
      const startsHere = mine.filter((i) => i.periodStart.getTime() === m.getTime());
      const quarterStart = [4, 7, 10, 1].includes(m.getUTCMonth() + 1);
      let frequency: ComplianceFrequency = "MONTHLY";
      if (startsHere.length) frequency = startsHere.some((i) => i.frequency === "QUARTERLY") ? "QUARTERLY" : "MONTHLY";
      else if (mySub) frequency = frequencyAt(mySub, m);
      else if (myDocs.some((d) => d.read.form === "GSTR3B" && d.read.quarterly && d.read.month === monthKey(addMonths(m, 2)))) frequency = "QUARTERLY";
      const quarterly = frequency === "QUARTERLY" && quarterStart;
      const months = monthsOf(m, quarterly ? 3 : 1);
      periods.push(
        buildPeriod({
          start: key,
          months,
          quarterly,
          docs: myDocs.filter((d) => months.includes(d.read.month)),
          gstr1: info(startsHere.find((i) => i.workType.kind === "GSTR1")),
          gstr3b: info(startsHere.find((i) => i.workType.kind === "GSTR3B")),
        })
      );
      m = addMonths(m, months.length);
    }
    swingIssues(periods, percent);
    // Files of a period still running aren't missing yet
    const current = monthKey(todayIST());
    for (const p of periods) {
      if (p.months[p.months.length - 1] >= current) p.issues = p.issues.filter((i) => i.severity !== "missing" && !i.text.startsWith("No IFF"));
    }
    result.set(clientId, periods);
  }
  return result;
}

export function periodTitle(p: Pick<PeriodResult, "start" | "quarterly">) {
  return periodLabel(p.quarterly ? "QUARTERLY" : "MONTHLY", parseMonthKey(p.start)!);
}

const fyStart = (fy: number) => utcDate(fy, 4);

// A client's working for a financial year (2026 = FY 2026-27)
export async function clientWorking(clientId: string, fy: number) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, contactPerson: true, companyName: true, gstin: true, email: true, responsibleEmail: true, ownerIsResponsible: true },
  });
  if (!client) return null;
  // Three earlier periods are loaded for the swing check
  const all = (await loadPeriods([clientId], addMonths(fyStart(fy), -9), utcDate(fy + 1, 3))).get(clientId) ?? [];
  const periods = all.filter((p) => p.start >= monthKey(fyStart(fy)));
  const total = sumRows(periods);
  const today = monthKey(todayIST());
  return {
    client: {
      id: client.id,
      name: partyName(client),
      gstin: client.gstin,
      email: (client.ownerIsResponsible ? client.email : client.responsibleEmail ?? client.email) ?? null,
    },
    fy,
    periods: periods.map((p) => ({ ...p, title: periodTitle(p), over: p.months[p.months.length - 1] < today })),
    total,
    hasCess: Object.values(total).some((h) => h && Math.abs(h.cess) >= 0.01),
  };
}

export type ClientWorking = NonNullable<Awaited<ReturnType<typeof clientWorking>>>;

// ─── Uploads ────────────────────────────────────────────────────────────────

// Keeps an item's reconciliation figures (Compliance → Reconciliation) in
// step with its uploaded returns
export async function syncItemFigures(itemId: string) {
  const item = await prisma.complianceItem.findUnique({ where: { id: itemId }, select: { ...itemSelect, figures: true } });
  if (!item || (item.workType.kind !== "GSTR1" && item.workType.kind !== "GSTR3B")) return null;
  const months = monthsOf(item.periodStart, monthsIn(item.frequency));
  const docs = await prisma.complianceDocument.findMany({
    where: { clientId: item.clientId, gstMonth: { gte: item.periodStart, lte: item.periodEnd }, gst: { not: Prisma.DbNull } },
    select: { id: true, fileName: true, createdAt: true, gst: true },
  });
  const period = buildPeriod({
    start: months[0],
    months,
    quarterly: item.frequency === "QUARTERLY",
    docs: docs.map((d) => ({ id: d.id, fileName: d.fileName, createdAt: d.createdAt.toISOString(), read: d.gst as unknown as GstRead })),
    gstr1: null,
    gstr3b: null,
  });
  const r = period.rows;
  const figures: Record<string, number> = {};
  if (item.workType.kind === "GSTR1") {
    if (r.g1_net) Object.assign(figures, { taxable: r.g1_net.taxable, tax: totalTax(r.g1_net) });
    if (r.a_net) Object.assign(figures, { taxable1A: r.a_net.taxable, tax1A: totalTax(r.a_net) });
  } else {
    if (r.g3_sales) Object.assign(figures, { taxable: r.g3_sales.taxable, outputTax: totalTax(r.g3_sales) });
    if (r.itc_net) figures.itcClaimed = totalTax(r.itc_net);
    if (r.itc_2b) figures.itc2b = totalTax(r.itc_2b);
    if (r.rcm_out) figures.rcmTax = totalTax(r.rcm_out);
  }
  if (JSON.stringify(figures) !== JSON.stringify(item.figures ?? {})) {
    await prisma.complianceItem.update({ where: { id: itemId }, data: { figures } });
  }
  return period;
}

// Marks filed every open GST period of the clients whose filed return PDF is
// uploaded, oldest first, so a whole year uploaded at once is filed in order
// (a period is filed only after the ones before it). Returns how many.
export async function fileFromStoredReturns(clientIds: string[], access: ComplianceAccess): Promise<number> {
  let filed = 0;
  for (const clientId of clientIds) {
    const open = await prisma.complianceItem.findMany({
      where: { clientId, status: { in: ["pending", "data_received"] }, workType: { kind: { in: ["GSTR1", "GSTR3B"] } } },
      select: { id: true, frequency: true, periodStart: true, periodEnd: true, workType: { select: { kind: true } } },
    });
    if (open.length === 0) continue;
    // GSTR-1 before GSTR-3B of the same period
    open.sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime() || (a.workType.kind === "GSTR1" ? -1 : 1));
    const docs = await prisma.complianceDocument.findMany({
      where: { clientId, itemId: { in: open.map((i) => i.id) }, gst: { not: Prisma.DbNull } },
      select: { itemId: true, gst: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    for (const item of open) {
      const lastMonth = monthKey(addMonths(item.periodStart, monthsIn(item.frequency) - 1));
      const read = docs
        .map((d) => ({ itemId: d.itemId, read: d.gst as unknown as GstRead }))
        .find((d) => d.itemId === item.id && d.read.source === "PDF" && d.read.form === item.workType.kind && d.read.month === lastMonth && d.read.arn)?.read;
      if (!read) continue;
      const result = await fileFromUpload(item.id, read, access);
      if (result?.startsWith("Marked filed")) filed++;
      // A later period is locked until this one is filed
      else break;
    }
  }
  return filed;
}

// After a return's PDF is uploaded: marks the period filed with the ARN and
// filing date printed on it (unless something locks it), or fills in a
// missing ARN / date. A GSTR-1A PDF marks the GSTR-1A filed. Returns what
// was done, for the person uploading.
export async function fileFromUpload(itemId: string, read: GstRead, access: ComplianceAccess): Promise<string | null> {
  if (read.source !== "PDF" || !read.arn || !read.filedAt) return null;
  const item = await prisma.complianceItem.findUnique({ where: { id: itemId }, select: { ...itemSelect, isNil: true, completedById: true } });
  if (!item) return null;
  const filedAt = parseDateKey(read.filedAt);
  if (!filedAt || filedAt > todayIST()) return null;
  const lastMonth = monthKey(addMonths(item.periodStart, monthsIn(item.frequency) - 1));

  if (read.form === "GSTR1A") {
    if (item.workType.kind !== "GSTR1" || item.gstr1aFiled) return null;
    await prisma.complianceItem.update({
      where: { id: itemId },
      data: { gstr1aFiled: true, gstr1aFiledAt: filedAt, gstr1aArn: read.arn, updatedById: access.userId },
    });
    await logEvent(prisma, itemId, "gstr1a_filed", access.userId, `From the uploaded GSTR-1A · ARN ${read.arn}`);
    return "GSTR-1A marked filed";
  }
  const returnFor = read.form === "GSTR3B" ? "GSTR3B" : read.form === "GSTR1" ? "GSTR1" : null;
  if (!returnFor || item.workType.kind !== returnFor || read.month !== lastMonth) return null;

  if (item.status === "filed" || item.status === "completed") {
    if (item.arn && item.filedAt) return null;
    await prisma.complianceItem.update({
      where: { id: itemId },
      data: { arn: item.arn ?? read.arn, filedAt: item.filedAt ?? filedAt, updatedById: access.userId },
    });
    await logEvent(prisma, itemId, "filing_updated", access.userId, `From the uploaded return · ARN ${read.arn}`);
    return "ARN and filing date added";
  }
  if (item.status !== "pending" && item.status !== "data_received") return null;
  if (!item.historical) {
    const lock = (await computeLocks([{ ...item, kind: item.workType.kind }])).get(item.id);
    if (lock) return `Not marked filed: ${lock}`;
  }
  const period = await syncItemFigures(itemId);
  await prisma.$transaction(async (tx) => {
    await tx.complianceItem.update({
      where: { id: itemId },
      data: {
        status: "filed",
        filedAt,
        arn: read.arn,
        isNil: period ? (returnFor === "GSTR1" ? !!period.rows.g1_net && isNil(period.rows.g1_net, 0.01) : period.nil) : null,
        // The person uploading the filed return; Admin can change it in the period
        ...(!item.historical && !item.completedById && { completedById: access.userId, checkedById: access.userId }),
        updatedById: access.userId,
      },
    });
    await logEvent(tx, itemId, "filed", access.userId, `From the uploaded return · ARN ${read.arn}`);
  });
  await completeIfReady(itemId, access.userId);
  return `Marked filed (ARN ${read.arn}, ${read.filedAt.split("-").reverse().join("/")})`;
}
