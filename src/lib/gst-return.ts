import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BillingAccess, billPartyName, managesCompany } from "@/lib/billing";
import { billTotals } from "@/lib/bill-document";
import { billShowsGstin } from "@/lib/connectors";
import { gstState } from "@/lib/gst-states";
import {
  financialYearOfMonth,
  formatGstReturnNumber,
  istMonthKey,
  monthDate,
  monthKeyOfDate,
} from "@/lib/gst-return-number";

// GST return series (docs/BILLING.md). The billing managers of MVC and Admin
// push numbered GST bills to the firm's GST return for a month; each bill then
// gets the next GST return number, kept apart from its bill number. Only
// Admin can undo a push, and only from the end of the series, so the series
// never has gaps. The number is never printed, emailed or sent to Tally.

export function canUseGstReturn(access: BillingAccess) {
  return access.isAdmin || managesCompany(access, "MVC");
}

// Bills that can be pushed: numbered GST bills, not cancelled, not pushed yet
export const PUSHABLE_WHERE = {
  type: "GST",
  status: "approved",
  gstReturnSequence: null,
} satisfies Prisma.BillWhereInput;

// ─── Series ─────────────────────────────────────────────────────────────────

async function nextNumberOf(financialYear: string) {
  const row = await prisma.gstReturnSeries.findUnique({ where: { financialYear } });
  return row?.nextNumber ?? 1;
}

export async function getGstReturnSeries(monthKey: string = istMonthKey()) {
  const financialYear = financialYearOfMonth(monthKey);
  const [nextNumber, highest] = await Promise.all([
    nextNumberOf(financialYear),
    prisma.bill.aggregate({ where: { gstReturnFinancialYear: financialYear }, _max: { gstReturnSequence: true } }),
  ]);
  return {
    financialYear,
    nextNumber,
    preview: formatGstReturnNumber(financialYear, nextNumber),
    lastIssued: highest._max.gstReturnSequence,
  };
}

// Admin sets where a year's series goes on (e.g. on go-live day)
export async function setGstReturnNextNumber(financialYear: string, nextNumber: number) {
  const highest = await prisma.bill.aggregate({
    where: { gstReturnFinancialYear: financialYear },
    _max: { gstReturnSequence: true },
  });
  const last = highest._max.gstReturnSequence;
  if (last !== null && nextNumber <= last) {
    return { error: `GST return number ${formatGstReturnNumber(financialYear, last)} has already been given` };
  }
  await prisma.gstReturnSeries.upsert({
    where: { financialYear },
    update: { nextNumber },
    create: { financialYear, nextNumber },
  });
  return { ok: true as const };
}

// ─── Push and undo ──────────────────────────────────────────────────────────

export interface GstReturnResult {
  done: { id: string; gstReturnNumber: string }[];
  skipped: { id: string; reason: string }[];
}

class Conflict extends Error {}

// Gives the bills the next GST return numbers for the return of `monthKey`, in
// order of bill date and bill number. All or none: if a bill was pushed or
// changed by someone else meanwhile, nothing is numbered.
export async function pushToGstReturn(ids: string[], monthKey: string, actorId: string): Promise<GstReturnResult> {
  const result: GstReturnResult = { done: [], skipped: [] };
  const bills = await prisma.bill.findMany({
    where: { id: { in: ids } },
    orderBy: [{ billDate: "asc" }, { sequence: "asc" }],
    select: { id: true, type: true, status: true, billDate: true, gstReturnNumber: true },
  });
  for (const id of ids) {
    if (!bills.some((b) => b.id === id)) result.skipped.push({ id, reason: "Not found" });
  }
  const ready = bills.filter((bill) => {
    const reason =
      bill.type !== "GST"
        ? "Not a GST bill"
        : bill.gstReturnNumber
          ? `Already in the GST return as ${bill.gstReturnNumber}`
          : bill.status !== "approved" || !bill.billDate
            ? bill.status === "cancelled"
              ? "Cancelled bills are not pushed"
              : "Not numbered yet"
            : istMonthKey(bill.billDate) > monthKey
              ? "Dated after the return month"
              : null;
    if (reason) result.skipped.push({ id: bill.id, reason });
    return !reason;
  });
  if (ready.length === 0) return result;

  const financialYear = financialYearOfMonth(monthKey);
  const count = ready.length;
  try {
    const numbered = await prisma.$transaction(async (tx) => {
      // Takes `count` numbers at once; a year without a row starts at 1
      const rows = await tx.$queryRaw<{ sequence: number }[]>`
        INSERT INTO "GstReturnSeries" ("financialYear", "nextNumber", "updatedAt")
        VALUES (${financialYear}, ${1 + count}::int, NOW())
        ON CONFLICT ("financialYear") DO UPDATE
          SET "nextNumber" = "GstReturnSeries"."nextNumber" + ${count}::int, "updatedAt" = NOW()
        RETURNING ("nextNumber" - ${count}::int) AS "sequence"`;
      const first = Number(rows[0].sequence);
      const now = new Date();
      const done: GstReturnResult["done"] = [];
      for (const [i, bill] of ready.entries()) {
        const sequence = first + i;
        const gstReturnNumber = formatGstReturnNumber(financialYear, sequence);
        const updated = await tx.bill.updateMany({
          where: { id: bill.id, ...PUSHABLE_WHERE },
          data: {
            gstReturnFinancialYear: financialYear,
            gstReturnSequence: sequence,
            gstReturnNumber,
            gstReturnMonth: monthDate(monthKey),
            gstReturnPushedAt: now,
            gstReturnPushedById: actorId,
          },
        });
        if (updated.count !== 1) throw new Conflict();
        done.push({ id: bill.id, gstReturnNumber });
      }
      await tx.billEvent.createMany({
        data: done.map((d) => ({
          billId: d.id,
          action: "gst_return_pushed",
          remark: `GST return ${monthKey}: ${d.gstReturnNumber}`,
          userId: actorId,
        })),
      });
      return done;
    });
    result.done = numbered;
  } catch (error) {
    if (error instanceof Conflict || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      for (const bill of ready) result.skipped.push({ id: bill.id, reason: "Changed by someone else meanwhile. Reload and try again." });
      return result;
    }
    throw error;
  }
  return result;
}

// Admin takes bills out of the GST return. Only the last numbers of a year's
// series can be taken back (all of those after the first one chosen), and the
// series goes back to the first of them, so it stays without gaps.
export async function undoGstReturnPush(ids: string[], actorId: string): Promise<{ error: string } | { undone: number }> {
  const bills = await prisma.bill.findMany({
    where: { id: { in: ids }, gstReturnSequence: { not: null } },
    select: { id: true, gstReturnFinancialYear: true, gstReturnSequence: true, gstReturnNumber: true },
  });
  if (bills.length === 0) return { error: "None of these bills is in the GST return" };
  const years = new Set(bills.map((b) => b.gstReturnFinancialYear));
  if (years.size > 1) return { error: "Undo the bills of one financial year at a time" };
  const financialYear = bills[0].gstReturnFinancialYear!;
  const lowest = Math.min(...bills.map((b) => b.gstReturnSequence!));

  try {
    return await prisma.$transaction(async (tx) => {
      // Every bill numbered from the lowest chosen on must be among those chosen
      const after = await tx.bill.findMany({
        where: { gstReturnFinancialYear: financialYear, gstReturnSequence: { gte: lowest } },
        select: { id: true, gstReturnNumber: true, gstReturnSequence: true },
        orderBy: { gstReturnSequence: "asc" },
      });
      const chosen = new Set(bills.map((b) => b.id));
      const notChosen = after.filter((b) => !chosen.has(b.id));
      if (notChosen.length > 0) {
        throw new Conflict(
          `Only the last numbers can be undone. Choose every bill from ${formatGstReturnNumber(financialYear, lowest)} to ${after[after.length - 1].gstReturnNumber} (${after.length} bills), or start from a later one.`
        );
      }
      await tx.bill.updateMany({
        where: { id: { in: after.map((b) => b.id) } },
        data: {
          gstReturnFinancialYear: null,
          gstReturnSequence: null,
          gstReturnNumber: null,
          gstReturnMonth: null,
          gstReturnPushedAt: null,
          gstReturnPushedById: null,
        },
      });
      const highest = after[after.length - 1].gstReturnSequence!;
      // The numbers are given again, unless Admin has moved the series on since
      await tx.gstReturnSeries.updateMany({
        where: { financialYear, nextNumber: highest + 1 },
        data: { nextNumber: lowest },
      });
      await tx.billEvent.createMany({
        data: after.map((b) => ({
          billId: b.id,
          action: "gst_return_undone",
          remark: `${b.gstReturnNumber} taken back`,
          userId: actorId,
        })),
      });
      return { undone: after.length };
    });
  } catch (error) {
    if (error instanceof Conflict) return { error: error.message };
    throw error;
  }
}

// ─── Register rows ──────────────────────────────────────────────────────────

export const gstReturnRowSelect = {
  id: true,
  type: true,
  status: true,
  billNumber: true,
  billDate: true,
  amount: true,
  description: true,
  showGstin: true,
  connectorId: true,
  billToName: true,
  billToGstin: true,
  gstReturnNumber: true,
  gstReturnSequence: true,
  gstReturnMonth: true,
  gstReturnPushedAt: true,
  gstReturnPushedBy: { select: { name: true } },
  client: { select: { contactPerson: true, companyName: true, gstin: true, connectorId: true } },
} satisfies Prisma.BillSelect;

type RowRecord = Prisma.BillGetPayload<{ select: typeof gstReturnRowSelect }>;

export async function mvcStateCode() {
  const entity = await prisma.billingEntity.findUnique({ where: { type: "GST" }, select: { stateCode: true } });
  return entity?.stateCode || null;
}

// One line of the register: what is entered in GSTR-1 for the bill
export function gstReturnRow(bill: RowRecord, stateCode: string | null) {
  const fee = bill.amount !== null ? Number(bill.amount) : 0;
  const gstin = bill.client ? bill.client.gstin : bill.billToGstin;
  const totals = billTotals("GST", fee, stateCode, gstin || null);
  const tax = (prefix: string) =>
    totals.taxLines.filter((line) => line.label.startsWith(prefix)).reduce((sum, line) => sum + line.amount, 0);
  // "GST @ 18%" (state code not set yet) is split like CGST + SGST
  const single = tax("GST @") / 2;
  // A connector's client is reported as B2C unless its GSTIN is shown on the bill
  const b2b = !!gstin && (!bill.client || billShowsGstin(bill, bill.client.connectorId));
  return {
    id: bill.id,
    status: bill.status,
    billNumber: bill.billNumber,
    billDate: bill.billDate?.toISOString() ?? null,
    party: billPartyName(bill) ?? "",
    gstin: b2b ? gstin : null,
    placeOfSupply: totals.placeOfSupply ?? (b2b ? gstState(gstin) : null),
    description: bill.description,
    taxable: fee,
    cgst: tax("CGST") + single,
    sgst: tax("SGST") + single,
    igst: tax("IGST"),
    total: totals.total,
    gstReturnNumber: bill.gstReturnNumber,
    gstReturnSequence: bill.gstReturnSequence,
    gstReturnMonth: bill.gstReturnMonth ? monthKeyOfDate(bill.gstReturnMonth) : null,
    pushedAt: bill.gstReturnPushedAt?.toISOString() ?? null,
    pushedBy: bill.gstReturnPushedBy?.name ?? null,
  };
}

export type GstReturnRow = ReturnType<typeof gstReturnRow>;
