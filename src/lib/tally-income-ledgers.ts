import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { cellText, ImportFileError } from "@/lib/client-import";

// The income ledgers in Tally that bills go to, one per service (e.g. "Gst
// Return Monthly" under Sales Accounts → Gst). Billing → Tally → Services.
// See docs/TALLY_DIRECT_IMPORT.md.

export const MAX_INCOME_LEDGER_LENGTH = 100;

export interface IncomeLedgerOption {
  id: string;
  name: string;
  groupName: string | null;
  active: boolean;
  billCount: number;
  // Last time a bill got this ledger, for "recently used first"
  lastUsedAt: string | null;
}

// Every income ledger with how much it is used, most recently used first,
// then by name
export async function listIncomeLedgers(): Promise<IncomeLedgerOption[]> {
  const [ledgers, usage] = await Promise.all([
    prisma.tallyIncomeLedger.findMany({ orderBy: { name: "asc" } }),
    prisma.bill.groupBy({
      by: ["incomeLedgerId"],
      where: { incomeLedgerId: { not: null } },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ]);
  const used = new Map(usage.map((u) => [u.incomeLedgerId, u]));
  return ledgers
    .map((l) => {
      const u = used.get(l.id);
      return {
        id: l.id,
        name: l.name,
        groupName: l.groupName,
        active: l.active,
        billCount: u?._count._all ?? 0,
        lastUsedAt: u?._max.updatedAt?.toISOString() ?? null,
      };
    })
    .sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || a.name.localeCompare(b.name));
}

export function cleanLedgerName(name: string) {
  return name.replace(/\s+/g, " ").trim();
}

const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

// The mapping sheet: "Tally income ledger", "Tally group" and, optionally,
// "Show in app? (Yes/No)". Any sheet with a column headed like the first
// works, e.g. a ledger list exported from Tally.
const NAME_HEADERS = ["tallyincomeledger", "incomeledger", "ledger", "ledgername", "name"];
const GROUP_HEADERS = ["tallygroup", "group", "under", "parent"];
const SHOW_HEADERS = ["showinappyesno", "showinapp", "show"];

interface SheetRow {
  name: string;
  groupName: string | null;
  // null: the column is empty, so the ledger is shown
  show: boolean | null;
}

function readSheet(sheet: ExcelJS.Worksheet) {
  const columns: { name?: number; group?: number; show?: number } = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const heading = normaliseHeader(cellText(cell.value));
    if (!columns.name && NAME_HEADERS.includes(heading)) columns.name = col;
    else if (!columns.group && GROUP_HEADERS.includes(heading)) columns.group = col;
    else if (!columns.show && SHOW_HEADERS.includes(heading)) columns.show = col;
  });
  if (!columns.name) return null;

  const rows: SheetRow[] = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const name = cleanLedgerName(cellText(row.getCell(columns.name!).value));
    if (!name) return;
    const group = columns.group ? cleanLedgerName(cellText(row.getCell(columns.group).value)) : "";
    const show = columns.show ? cellText(row.getCell(columns.show).value).trim().toLowerCase() : "";
    rows.push({
      name,
      groupName: group || null,
      show: show === "no" || show === "n" ? false : show === "yes" || show === "y" ? true : null,
    });
  });
  return rows;
}

export interface LedgerImportResult {
  added: number;
  updated: number;
  unchanged: number;
  hidden: number;
  errors: string[];
}

// Adds the ledgers in the file and updates their group and whether they are
// shown. Never deletes: ledgers missing from the file stay as they are.
export async function importIncomeLedgers(buffer: ArrayBuffer): Promise<LedgerImportResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ImportFileError("This file could not be read. Please upload an .xlsx file.");
  }
  let rows: SheetRow[] | null = null;
  for (const sheet of workbook.worksheets) {
    rows = readSheet(sheet);
    if (rows) break;
  }
  if (!rows) throw new ImportFileError("No sheet has a 'Tally income ledger' column.");
  if (rows.length === 0) throw new ImportFileError("No ledgers were found in the file.");

  const errors: string[] = [];
  const byName = new Map<string, SheetRow>();
  for (const row of rows) {
    if (row.name.length > MAX_INCOME_LEDGER_LENGTH) {
      errors.push(`"${row.name.slice(0, 40)}…" is longer than ${MAX_INCOME_LEDGER_LENGTH} characters`);
      continue;
    }
    byName.set(row.name.toLowerCase(), row);
  }

  const existing = await prisma.tallyIncomeLedger.findMany();
  const existingByName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));
  const result: LedgerImportResult = { added: 0, updated: 0, unchanged: 0, hidden: 0, errors };

  await prisma.$transaction(async (tx) => {
    for (const [key, row] of byName) {
      const current = existingByName.get(key);
      const groupName = row.groupName ?? current?.groupName ?? null;
      const active = row.show ?? current?.active ?? true;
      if (!active) result.hidden++;
      if (!current) {
        await tx.tallyIncomeLedger.create({ data: { name: row.name, groupName, active } });
        result.added++;
      } else if (current.name !== row.name || current.groupName !== groupName || current.active !== active) {
        // The file's spelling wins, e.g. a change of capitals made in Tally
        await tx.tallyIncomeLedger.update({ where: { id: current.id }, data: { name: row.name, groupName, active } });
        result.updated++;
      } else {
        result.unchanged++;
      }
    }
  });
  return result;
}
