import { prisma } from "@/lib/prisma";
import { partyName, SALARY_SECTIONS } from "@/lib/compliance";
import { dateKey, periodEndOf, periodLabel, utcDate } from "@/lib/compliance-periods";

// Reconciliation tables, worked out from the figures entered when returns are
// filed. Plain arithmetic, no AI: always live and free.

type Figures = Record<string, number | undefined>;

const has = (...values: (number | undefined)[]) => values.every((v) => typeof v === "number");
const round = (n: number) => Math.round(n * 100) / 100;

export interface GstRecoRow {
  clientId: string;
  client: string;
  period: string;
  periodStart: string;
  gstr1Status: string | null;
  gstr3bStatus: string | null;
  gstr1Taxable: number | null;
  gstr3bTaxable: number | null;
  taxableDiff: number | null;
  gstr1Tax: number | null;
  gstr3bTax: number | null;
  taxDiff: number | null;
  itcClaimed: number | null;
  itc2b: number | null;
  itcExcess: number | null;
  rcmExpected: number | null;
  rcmPaid: number | null;
  rcmShort: number | null;
  cashPaid: number | null;
  flags: string[];
}

function gstRow(
  client: { id: string; contactPerson: string; companyName: string | null },
  frequency: "MONTHLY" | "QUARTERLY" | "YEARLY",
  periodStart: Date,
  gstr1: { status: string; figures: unknown } | undefined,
  gstr3b: { status: string; figures: unknown; lines: { status: string; taxAmount: unknown; obligation: { kind: string } }[] } | undefined
): GstRecoRow {
  const f1 = (gstr1?.figures ?? {}) as Figures;
  const f3 = (gstr3b?.figures ?? {}) as Figures;
  const gstr1Taxable = has(f1.taxable) ? f1.taxable! + (f1.taxable1A ?? 0) : null;
  const gstr1Tax = has(f1.tax) ? f1.tax! + (f1.tax1A ?? 0) : null;
  const gstr3bTaxable = has(f3.taxable) ? f3.taxable! : null;
  const gstr3bTax = has(f3.outputTax) ? f3.outputTax! : null;
  const rcmLines = gstr3b?.lines.filter((l) => l.obligation.kind === "RCM" && l.status === "confirmed") ?? [];
  const rcmExpected = rcmLines.length ? round(rcmLines.reduce((s, l) => s + Number(l.taxAmount ?? 0), 0)) : null;
  const row: GstRecoRow = {
    clientId: client.id,
    client: partyName(client),
    period: periodLabel(frequency, periodStart),
    periodStart: dateKey(periodStart),
    gstr1Status: gstr1?.status ?? null,
    gstr3bStatus: gstr3b?.status ?? null,
    gstr1Taxable,
    gstr3bTaxable,
    taxableDiff: gstr1Taxable !== null && gstr3bTaxable !== null ? round(gstr3bTaxable - gstr1Taxable) : null,
    gstr1Tax,
    gstr3bTax,
    taxDiff: gstr1Tax !== null && gstr3bTax !== null ? round(gstr3bTax - gstr1Tax) : null,
    itcClaimed: has(f3.itcClaimed) ? f3.itcClaimed! : null,
    itc2b: has(f3.itc2b) ? f3.itc2b! : null,
    itcExcess: has(f3.itcClaimed, f3.itc2b) ? round(f3.itcClaimed! - f3.itc2b!) : null,
    rcmExpected,
    rcmPaid: has(f3.rcmTax) ? f3.rcmTax! : null,
    rcmShort: rcmExpected !== null ? round(rcmExpected - (f3.rcmTax ?? 0)) : null,
    cashPaid: has(f3.cashPaid) ? f3.cashPaid! : null,
    flags: [],
  };
  if (row.taxableDiff !== null && Math.abs(row.taxableDiff) >= 1) {
    row.flags.push(`3B taxable value is ${row.taxableDiff > 0 ? "higher" : "lower"} than GSTR-1 by ₹${Math.abs(row.taxableDiff).toLocaleString("en-IN")}`);
  }
  if (row.taxDiff !== null && Math.abs(row.taxDiff) >= 1) {
    row.flags.push(`3B tax is ${row.taxDiff > 0 ? "higher" : "lower"} than GSTR-1 by ₹${Math.abs(row.taxDiff).toLocaleString("en-IN")}`);
  }
  if (row.itcExcess !== null && row.itcExcess >= 1) {
    row.flags.push(`ITC claimed is ₹${row.itcExcess.toLocaleString("en-IN")} more than GSTR-2B`);
  }
  if (row.rcmShort !== null && row.rcmShort >= 1) {
    row.flags.push(`RCM paid is ₹${row.rcmShort.toLocaleString("en-IN")} less than the RCM lines`);
  }
  return row;
}

const recoItemInclude = {
  workType: { select: { kind: true, name: true, returnType: true } },
  client: { select: { id: true, contactPerson: true, companyName: true } },
  lines: { select: { status: true, taxAmount: true, obligation: { select: { kind: true } } } },
  challans: { select: { section: true, amount: true } },
} as const;

// One client's financial year: a GST row per return period and a TDS row per return
export async function clientReco(clientId: string, fy: number) {
  const items = await prisma.complianceItem.findMany({
    where: {
      clientId,
      periodStart: { gte: utcDate(fy, 4), lt: utcDate(fy + 1, 4) },
      workType: { kind: { in: ["GSTR1", "GSTR3B", "TDS_PAYMENT", "TDS_RETURN"] } },
    },
    include: recoItemInclude,
    orderBy: { periodStart: "asc" },
  });

  const gstStarts = new Map<number, { frequency: "MONTHLY" | "QUARTERLY" | "YEARLY"; start: Date }>();
  for (const i of items) {
    if (i.workType.kind === "GSTR1" || i.workType.kind === "GSTR3B") gstStarts.set(i.periodStart.getTime(), { frequency: i.frequency, start: i.periodStart });
  }
  const gst = [...gstStarts.values()].map(({ frequency, start }) => {
    const at = (kind: string) => items.find((i) => i.workType.kind === kind && i.periodStart.getTime() === start.getTime());
    const g1 = at("GSTR1");
    const g3 = at("GSTR3B");
    return gstRow((g1 ?? g3)!.client, frequency, start, g1, g3);
  });

  const tds = items
    .filter((i) => i.workType.kind === "TDS_RETURN")
    .map((ret) => {
      const salary = ret.workType.returnType === "24Q";
      const end = periodEndOf("QUARTERLY", ret.periodStart);
      const challanTotal = round(
        items
          .filter((p) => p.workType.kind === "TDS_PAYMENT" && p.periodStart >= ret.periodStart && p.periodStart <= end)
          .flatMap((p) => p.challans)
          .filter((c) => SALARY_SECTIONS.includes(c.section) === salary)
          .reduce((s, c) => s + Number(c.amount), 0)
      );
      const f = (ret.figures ?? {}) as Figures;
      const deposited = has(f.deposited) ? f.deposited! : null;
      return {
        period: periodLabel("QUARTERLY", ret.periodStart),
        returnName: ret.workType.name,
        status: ret.status,
        challanTotal,
        deducted: has(f.deducted) ? f.deducted! : null,
        deposited,
        diff: deposited !== null ? round(deposited - challanTotal) : null,
      };
    });

  const sum = (key: keyof GstRecoRow) =>
    gst.some((r) => r[key] !== null) ? round(gst.reduce((s, r) => s + ((r[key] as number | null) ?? 0), 0)) : null;
  return {
    gst,
    gstTotals: {
      gstr1Taxable: sum("gstr1Taxable"),
      gstr3bTaxable: sum("gstr3bTaxable"),
      gstr1Tax: sum("gstr1Tax"),
      gstr3bTax: sum("gstr3bTax"),
      itcClaimed: sum("itcClaimed"),
      itc2b: sum("itc2b"),
      rcmExpected: sum("rcmExpected"),
      rcmPaid: sum("rcmPaid"),
      cashPaid: sum("cashPaid"),
    },
    tds,
  };
}

// All clients' GST returns of the periods ending in a month, with a problem
export async function gstMismatches(month: Date) {
  const items = await prisma.complianceItem.findMany({
    where: {
      periodEnd: { gte: month, lte: periodEndOf("MONTHLY", month) },
      workType: { kind: { in: ["GSTR1", "GSTR3B"] } },
    },
    include: recoItemInclude,
  });
  const rows: GstRecoRow[] = [];
  for (const g3 of items.filter((i) => i.workType.kind === "GSTR3B")) {
    const g1 = items.find((i) => i.workType.kind === "GSTR1" && i.clientId === g3.clientId && i.periodStart.getTime() === g3.periodStart.getTime());
    const row = gstRow(g3.client, g3.frequency, g3.periodStart, g1, g3);
    if (row.flags.length) rows.push(row);
  }
  return rows.sort((a, b) => a.client.localeCompare(b.client));
}

