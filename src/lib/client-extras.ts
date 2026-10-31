import ExcelJS from "exceljs";
import { ComplianceFrequency, ObligationKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureItems, subscriptionInclude, SubscriptionWithRefs, appearsOn, addLinesToOpenItems } from "@/lib/compliance";
import { monthKey, nextPeriodStart, parseMonthKey, periodContaining, todayIST } from "@/lib/compliance-periods";
import type { ImportRow } from "@/lib/client-import";

// The sheets that travel with the "Clients" sheet of a client export: logins
// (Admin only), compliance setup and monthly TDS/RCM payments. On import they
// are added for the clients created by the same upload (docs/FRESH_START.md).

export const SHEETS = {
  logins: "Logins",
  setup: "Compliance setup",
  payments: "TDS RCM payments",
  history: "Compliance history",
} as const;

// Every sheet starts with the client, found again by GSTIN, then by name
export const CLIENT_COLUMNS = [
  { key: "client", header: "Client", width: 30 },
  { key: "contactPerson", header: "Contact person", width: 22 },
  { key: "gstin", header: "GSTIN", width: 18 },
] as const;

export const LOGIN_COLUMNS = [
  ...CLIENT_COLUMNS,
  { key: "title", header: "Login for", width: 24 },
  { key: "username", header: "Username", width: 26 },
  { key: "password", header: "Password", width: 22 },
] as const;

export const SETUP_COLUMNS = [
  ...CLIENT_COLUMNS,
  { key: "work", header: "Work", width: 22 },
  { key: "frequency", header: "Frequency", width: 11 },
  { key: "trackFrom", header: "Track from (YYYY-MM)", width: 14 },
  { key: "trackTill", header: "Track till (YYYY-MM)", width: 14 },
  { key: "feeNil", header: "Fee (nil)", width: 11 },
  { key: "feeNonNil", header: "Fee (non-nil)", width: 12 },
] as const;

export const PAYMENT_COLUMNS = [
  ...CLIENT_COLUMNS,
  { key: "kind", header: "Type (RCM / TDS)", width: 10 },
  { key: "category", header: "Category / section", width: 22 },
  { key: "payee", header: "Paid to", width: 26 },
  { key: "fixedAmount", header: "Fixed amount", width: 13 },
  { key: "ratePercent", header: "Rate %", width: 8 },
  { key: "fromMonth", header: "From (YYYY-MM)", width: 12 },
  { key: "toMonth", header: "Till (YYYY-MM)", width: 12 },
] as const;

export const FREQUENCY_LABELS: Record<ComplianceFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

type Columns = readonly { key: string; header: string }[];
type Values<C extends Columns> = Record<C[number]["key"], string | null>;

export interface ExtraProblem {
  sheet: string;
  row: number;
  client: string | null;
  problem: string;
  skipped: boolean; // true: the client is not added by this upload, so the row is left out
}

interface Linked<T> {
  clientRow: number; // row of the client on the Clients sheet
  value: T;
}

export interface ClientExtras {
  logins: Linked<{ title: string; username: string; password: string }>[];
  setups: Linked<{
    workTypeId: string;
    frequency: ComplianceFrequency;
    startPeriod: Date;
    endPeriod: Date | null;
    feeNil: number | null;
    feeNonNil: number | null;
  }>[];
  payments: Linked<{
    kind: ObligationKind;
    category: string;
    payee: string;
    fixedAmount: number | null;
    ratePercent: number;
    fromMonth: Date;
    toMonth: Date | null;
  }>[];
  problems: ExtraProblem[];
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  }
  return String(value);
}

const normalise = (text: string | null | undefined) => (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function readSheet<C extends Columns>(workbook: ExcelJS.Workbook, name: string, columns: C) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) return [];
  const positions = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const column = columns.find((c) => normalise(c.header) === normalise(cellText(cell.value)));
    if (column) positions.set(column.key, col);
  });
  const rows: { row: number; data: Values<C> }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = Object.fromEntries(
      columns.map((c) => {
        const col = positions.get(c.key);
        // Passwords keep their spaces
        const text = col ? cellText(row.getCell(col).value) : "";
        return [c.key, (c.key === "password" ? text : text.trim()) || null];
      })
    ) as Values<C>;
    if (Object.values(data).some((v) => v !== null)) rows.push({ row: rowNumber, data });
  });
  return rows;
}

// "2026-10", or a date Excel made of it
function parseMonth(text: string | null): Date | null {
  if (!text) return null;
  return parseMonthKey(text.slice(0, 7));
}

function parseAmount(text: string | null): number | null | undefined {
  if (!text) return null;
  const value = Number(text.replace(/[,₹\s]/g, ""));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

// Reads the extra sheets and links every row to a client row of the upload
export async function checkClientExtras(buffer: ArrayBuffer, clientRows: ImportRow[]): Promise<ClientExtras> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const extras: ClientExtras = { logins: [], setups: [], payments: [], problems: [] };

  const loginRows = readSheet(workbook, SHEETS.logins, LOGIN_COLUMNS);
  const setupRows = readSheet(workbook, SHEETS.setup, SETUP_COLUMNS);
  const paymentRows = readSheet(workbook, SHEETS.payments, PAYMENT_COLUMNS);
  if (!loginRows.length && !setupRows.length && !paymentRows.length) return extras;

  const ready = (r: ImportRow) => r.errors.length === 0 && !r.duplicate;
  const byGstin = new Map<string, ImportRow>();
  const byBoth = new Map<string, ImportRow>();
  const byName = new Map<string, ImportRow[]>();
  for (const r of clientRows) {
    if (r.data.gstin) byGstin.set(r.data.gstin.toUpperCase(), r);
    byBoth.set(`${normalise(r.data.companyName || r.data.contactPerson)}|${normalise(r.data.contactPerson)}`, r);
    for (const name of new Set([normalise(r.data.companyName), normalise(r.data.contactPerson)].filter(Boolean))) {
      byName.set(name, [...(byName.get(name) ?? []), r]);
    }
  }

  // The client row a sheet row belongs to; records a problem when there is none
  const link = (sheet: string, row: number, data: Values<typeof CLIENT_COLUMNS>): number | null => {
    const label = data.client || data.contactPerson || data.gstin;
    const gstin = data.gstin?.toUpperCase().replace(/\s/g, "");
    const named = byName.get(normalise(data.client || data.contactPerson)) ?? [];
    const match =
      (gstin && byGstin.get(gstin)) ||
      byBoth.get(`${normalise(data.client || data.contactPerson)}|${normalise(data.contactPerson)}`) ||
      (named.length === 1 ? named[0] : undefined);
    if (!match) {
      extras.problems.push({ sheet, row, client: label, problem: "Client not found on the Clients sheet", skipped: false });
      return null;
    }
    if (!ready(match)) {
      extras.problems.push({
        sheet,
        row,
        client: label,
        problem: match.duplicate ? "Client already in the app; left out" : "Client not added (fix its row); left out",
        skipped: true,
      });
      return null;
    }
    return match.row;
  };

  for (const { row, data } of loginRows) {
    const clientRow = link(SHEETS.logins, row, data);
    if (clientRow === null) continue;
    const problem = !data.title
      ? "'Login for' is missing"
      : !data.password
        ? "Password is missing"
        : data.title.length > 75 || (data.username ?? "").length > 75 || data.password.length > 100
          ? "Too long (Login for and Username up to 75, Password up to 100 characters)"
          : null;
    if (problem) extras.problems.push({ sheet: SHEETS.logins, row, client: data.client, problem, skipped: false });
    else extras.logins.push({ clientRow, value: { title: data.title!, username: data.username ?? "", password: data.password! } });
  }

  const workTypes = await prisma.complianceWorkType.findMany();
  const workByName = new Map(workTypes.map((w) => [normalise(w.name), w]));
  const gstFrequency = new Map<string, ComplianceFrequency>(); // client row|kind → frequency

  for (const { row, data } of setupRows) {
    const clientRow = link(SHEETS.setup, row, data);
    if (clientRow === null) continue;
    const fail = (problem: string) => extras.problems.push({ sheet: SHEETS.setup, row, client: data.client, problem, skipped: false });
    const work = workByName.get(normalise(data.work));
    if (!work) {
      fail(`Work "${data.work ?? ""}" not found in Compliance → Setup`);
      continue;
    }
    if (!work.active) {
      fail(`${work.name} is switched off in Compliance → Setup`);
      continue;
    }
    const frequency = (Object.keys(FREQUENCY_LABELS) as ComplianceFrequency[]).find(
      (f) => normalise(FREQUENCY_LABELS[f]) === normalise(data.frequency)
    ) ?? (data.frequency ? undefined : work.frequency);
    if (!frequency || (frequency !== work.frequency && !(work.allowQuarterly && frequency === "QUARTERLY"))) {
      fail(`${work.name} can't be ${data.frequency ?? "this frequency"}`);
      continue;
    }
    const from = parseMonth(data.trackFrom) ?? (data.trackFrom ? null : todayIST());
    const till = data.trackTill ? parseMonth(data.trackTill) : null;
    if (!from || (data.trackTill && !till)) {
      fail("Months should look like 2026-10");
      continue;
    }
    const startPeriod = periodContaining(frequency, from).start;
    const endPeriod = till ? periodContaining(frequency, till).start : null;
    if (endPeriod && endPeriod < startPeriod) {
      fail("'Track till' is before 'Track from'");
      continue;
    }
    const feeNil = parseAmount(data.feeNil);
    const feeNonNil = parseAmount(data.feeNonNil);
    if (feeNil === undefined || feeNonNil === undefined) {
      fail("Fees should be amounts, e.g. 500");
      continue;
    }
    if (work.kind === "GSTR1" || work.kind === "GSTR3B") {
      const other = gstFrequency.get(`${clientRow}|${work.kind === "GSTR1" ? "GSTR3B" : "GSTR1"}`);
      if (other && other !== frequency) {
        fail("GSTR-1 and GSTR-3B must have the same frequency");
        continue;
      }
      gstFrequency.set(`${clientRow}|${work.kind}`, frequency);
    }
    if (extras.setups.some((s) => s.clientRow === clientRow && s.value.workTypeId === work.id)) {
      fail(`${work.name} is listed twice for this client`);
      continue;
    }
    extras.setups.push({ clientRow, value: { workTypeId: work.id, frequency, startPeriod, endPeriod, feeNil, feeNonNil } });
  }

  for (const { row, data } of paymentRows) {
    const clientRow = link(SHEETS.payments, row, data);
    if (clientRow === null) continue;
    const fail = (problem: string) => extras.problems.push({ sheet: SHEETS.payments, row, client: data.client, problem, skipped: false });
    const kind = data.kind?.toUpperCase();
    if (kind !== "RCM" && kind !== "TDS") {
      fail("Type should be RCM or TDS");
      continue;
    }
    const category = data.category ?? "";
    const payee = data.payee ?? "";
    if (category.length < 2 || category.length > 60) {
      fail("Category / section should be 2 to 60 characters");
      continue;
    }
    if (payee.length < 2 || payee.length > 100) {
      fail("'Paid to' should be 2 to 100 characters");
      continue;
    }
    const fixedAmount = parseAmount(data.fixedAmount);
    const ratePercent = parseAmount(data.ratePercent);
    if (fixedAmount === undefined || ratePercent === undefined || ratePercent === null || ratePercent > 100) {
      fail("Fixed amount should be an amount and Rate % between 0 and 100");
      continue;
    }
    const fromMonth = parseMonth(data.fromMonth);
    const toMonth = data.toMonth ? parseMonth(data.toMonth) : null;
    if (!fromMonth || (data.toMonth && !toMonth)) {
      fail("Months should look like 2026-10");
      continue;
    }
    if (toMonth && toMonth < fromMonth) {
      fail("'Till' is before 'From'");
      continue;
    }
    extras.payments.push({ clientRow, value: { kind, category, payee, fixedAmount, ratePercent, fromMonth, toMonth } });
  }

  return extras;
}

export function extrasSummary(extras: ClientExtras) {
  return {
    logins: extras.logins.length,
    setups: extras.setups.length,
    payments: extras.payments.length,
    problems: extras.problems,
  };
}

// The rows to write with the new clients' ids, inside the import transaction
export function extrasWrites(extras: ClientExtras, clientIds: Map<number, string>) {
  const id = (row: number) => clientIds.get(row)!;
  return [
    prisma.credential.createMany({ data: extras.logins.map((l) => ({ clientId: id(l.clientRow), ...l.value })) }),
    prisma.clientCompliance.createMany({
      data: extras.setups.map((s) => ({ clientId: id(s.clientRow), ...s.value, active: true })),
      skipDuplicates: true,
    }),
    prisma.clientObligation.createMany({ data: extras.payments.map((p) => ({ clientId: id(p.clientRow), ...p.value })) }),
  ];
}

// The compliance items of the new clients, from each work's first period up
// to the ones that should show today (at most three years back)
export async function createItemsForImported(clientIds: string[]) {
  if (clientIds.length === 0) return;
  const subs: SubscriptionWithRefs[] = await prisma.clientCompliance.findMany({
    where: { clientId: { in: clientIds }, active: true },
    include: subscriptionInclude,
  });
  const today = todayIST();
  const pairs: { sub: SubscriptionWithRefs; periodStart: Date }[] = [];
  for (const sub of subs) {
    let start = sub.startPeriod;
    const earliest = periodContaining(sub.frequency, new Date(Date.UTC(today.getUTCFullYear() - 3, today.getUTCMonth(), 1))).start;
    if (start < earliest) start = earliest;
    for (let i = 0; i < 60; i++) {
      if (sub.endPeriod && start > sub.endPeriod) break;
      if (appearsOn(sub, start) > today) break;
      pairs.push({ sub, periodStart: start });
      start = nextPeriodStart(sub.frequency, start);
    }
  }
  for (let i = 0; i < pairs.length; i += 1000) await ensureItems(pairs.slice(i, i + 1000));
  await addLinesToOpenItems(clientIds);
}

// The first period still to be done: the earliest open period, else the one
// after the last period dealt with, else where tracking started
export function trackFromFor(
  sub: { frequency: ComplianceFrequency; startPeriod: Date },
  items: { periodStart: Date; status: string; historical: boolean }[]
): string {
  const tracked = items.filter((i) => !i.historical && i.periodStart >= sub.startPeriod);
  const open = tracked.filter((i) => i.status === "pending" || i.status === "data_received");
  let from: Date;
  if (open.length) from = new Date(Math.min(...open.map((i) => i.periodStart.getTime())));
  else if (tracked.length) {
    const latest = new Date(Math.max(...tracked.map((i) => i.periodStart.getTime())));
    from = nextPeriodStart(sub.frequency, periodContaining(sub.frequency, latest).start);
  } else from = sub.startPeriod;
  from = periodContaining(sub.frequency, from).start;
  return monthKey(from < sub.startPeriod ? sub.startPeriod : from);
}
