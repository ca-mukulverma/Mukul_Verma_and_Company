import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { formatIndianDate } from "@/lib/billing-constants";
import { cellText, ImportFileError } from "@/lib/client-import";

// Every client's Tally party ledger in one Excel file (billing managers,
// Admin): download, fill in the "Tally Ledger Name" column, upload. Rows are
// matched to clients by Client ID (or, when that is missing, a GSTIN only one
// client has), and only the ledger name is read.

export const LEDGER_SHEET = "Tally ledgers";
export const MAX_LEDGER_LENGTH = 100;
const TO_BE_SET = "To be set";

const COLUMNS = [
  { key: "id", header: "Client ID", width: 14 },
  { key: "client", header: "Client", width: 34 },
  { key: "contactPerson", header: "Contact person", width: 24 },
  { key: "gstin", header: "GSTIN", width: 18 },
  { key: "connector", header: "Connector", width: 22 },
  { key: "status", header: "Status", width: 11 },
  { key: "ledger", header: "Tally Ledger Name", width: 36 },
] as const;
type Key = (typeof COLUMNS)[number]["key"];

const clientName = (c: { companyName: string | null; contactPerson: string }) => c.companyName || c.contactPerson;

export async function buildLedgerFile(downloadedBy: string): Promise<Buffer> {
  const clients = await prisma.client.findMany({
    select: {
      id: true,
      contactPerson: true,
      companyName: true,
      gstin: true,
      tallyLedgerName: true,
      tallyLedgerPending: true,
      connector: { select: { name: true } },
    },
    orderBy: [{ companyName: "asc" }, { contactPerson: "asc" }],
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MV Company";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(LEDGER_SHEET, { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  header.getCell(1).note = "Links the row to the client. Do not change it.";
  header.getCell(6).note = `"${TO_BE_SET}": added by someone who may not set the ledger, so it still has to be checked.`;
  header.getCell(7).note =
    "The party ledger in Tally, exactly as it is named there. Empty, or the client's name, means the client's name.";
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  sheet.getColumn("gstin").numFmt = "@";
  sheet.getColumn("ledger").numFmt = "@";
  sheet.getColumn("id").font = { color: { argb: "FF9CA3AF" } };

  for (const c of clients) {
    const row = sheet.addRow({
      id: c.id,
      client: clientName(c),
      contactPerson: c.contactPerson,
      gstin: c.gstin ?? "",
      connector: c.connector?.name ?? "",
      status: c.tallyLedgerPending ? TO_BE_SET : "",
      ledger: c.tallyLedgerName || clientName(c),
    });
    row.getCell("ledger").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9C3" } };
  }

  const info = workbook.addWorksheet("About");
  info.columns = [{ width: 20 }, { width: 90 }];
  info.addRows([
    ["Downloaded on", formatIndianDate(new Date(), "medium")],
    ["Downloaded by", downloadedBy],
    ["Clients", String(clients.length)],
    ["", ""],
    ["How to use", "Change the yellow 'Tally Ledger Name' column to the ledger names exactly as they are in Tally."],
    ["", "Then upload this file in Billing → Tally → Ledger names from Excel. You see every change before it is saved."],
    ["", "Only the Tally Ledger Name is read; the other columns are for reference. Do not change the Client ID."],
    ["Client's name", "Empty, or the same as the client's name, means the ledger is the client's name."],
    ["Connector clients", "Their bills go to the connector's ledger (set in Billing → Connectors); the name here is kept for later."],
    ["Bills", "Numbered bills not yet sent to Tally move to the new ledger. Bills already sent keep their ledger."],
  ]);
  info.getColumn(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export interface LedgerRow {
  row: number;
  clientId: string | null;
  client: string | null;
  // The ledger used now and the one in the file (the client's name when the custom name is cleared)
  from: string | null;
  to: string | null;
  // Saved as the client's custom ledger name (null: the client's name)
  custom: string | null;
  status: "change" | "same" | "confirm" | "error";
  errors: string[];
  warnings: string[];
}

const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

// Reads the file and compares every row with the client's ledger now
export async function checkLedgerFile(buffer: ArrayBuffer): Promise<LedgerRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ImportFileError("This file could not be read. Please upload the .xlsx file downloaded here.");
  }
  const sheet = workbook.getWorksheet(LEDGER_SHEET) ?? workbook.worksheets[0];
  if (!sheet) throw new ImportFileError("The file has no sheets.");

  const positions = new Map<Key, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const heading = normaliseHeader(cellText(cell.value));
    const column = COLUMNS.find((c) => normaliseHeader(c.header) === heading);
    if (column && !positions.has(column.key)) positions.set(column.key, col);
  });
  if (!positions.has("ledger")) throw new ImportFileError("The 'Tally Ledger Name' column was not found.");
  if (!positions.has("id") && !positions.has("gstin")) {
    throw new ImportFileError("The 'Client ID' column was not found. Please upload the file downloaded here.");
  }

  const clients = await prisma.client.findMany({
    select: { id: true, contactPerson: true, companyName: true, gstin: true, tallyLedgerName: true, tallyLedgerPending: true },
  });
  const byId = new Map(clients.map((c) => [c.id, c]));
  const byGstin = new Map<string, (typeof clients)[number] | null>();
  for (const c of clients) {
    if (!c.gstin) continue;
    const key = c.gstin.toUpperCase();
    byGstin.set(key, byGstin.has(key) ? null : c); // null: more than one client
  }

  const read = (row: ExcelJS.Row, key: Key) => {
    const col = positions.get(key);
    return col ? cellText(row.getCell(col).value) : "";
  };

  const rows: LedgerRow[] = [];
  const seen = new Map<string, number>(); // client ID → row
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = read(row, "id").trim();
    const gstin = read(row, "gstin").trim().toUpperCase();
    const raw = read(row, "ledger");
    if (!id && !gstin && !raw.trim() && !read(row, "client").trim()) return;

    const errors: string[] = [];
    const warnings: string[] = [];
    let client = id ? byId.get(id) : undefined;
    if (!client && !id && gstin) {
      const match = byGstin.get(gstin);
      if (match) client = match;
      else errors.push(match === null ? `More than one client has GSTIN ${gstin}` : `No client has GSTIN ${gstin}`);
    } else if (!client) {
      errors.push(id ? "No client has this Client ID (it may have been deleted)" : "Client ID is missing");
    }
    if (client) {
      const earlier = seen.get(client.id);
      if (earlier) errors.push(`The same client is on row ${earlier}`);
      else seen.set(client.id, rowNumber);
    }

    const name = raw.trim();
    if (name.length > MAX_LEDGER_LENGTH) errors.push(`The ledger name is longer than ${MAX_LEDGER_LENGTH} characters`);
    if (/\s{2,}/.test(name)) warnings.push("Has two spaces together: Tally needs the name exactly");

    if (!client || errors.length) {
      rows.push({
        row: rowNumber,
        clientId: client?.id ?? null,
        client: client ? clientName(client) : read(row, "client").trim() || null,
        from: client ? client.tallyLedgerName || clientName(client) : null,
        to: name || null,
        custom: null,
        status: "error",
        errors,
        warnings,
      });
      return;
    }

    const own = clientName(client);
    // Empty or the client's own name: no custom ledger
    const custom = name && name !== own ? name : null;
    const from = client.tallyLedgerName || own;
    const to = custom || own;
    const status = custom !== (client.tallyLedgerName || null) ? "change" : client.tallyLedgerPending ? "confirm" : "same";
    rows.push({ row: rowNumber, clientId: client.id, client: own, from, to, custom, status, errors, warnings });
  });

  // One ledger for several clients is allowed but usually a slip
  const users = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    if (r.status === "error" || !r.custom) continue;
    const key = r.custom.toLowerCase();
    users.set(key, [...(users.get(key) ?? []), r]);
  }
  for (const group of users.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      const others = group.filter((o) => o !== r).map((o) => o.client);
      r.warnings.push(`Same ledger as ${others.slice(0, 2).join(", ")}${others.length > 2 ? ` and ${others.length - 2} more` : ""}`);
    }
  }
  return rows;
}

// Saves the changed ledgers (and, when asked, marks unchanged "to be set"
// clients as checked). Numbered bills of these clients not yet sent to Tally
// move to the new ledger, as when one ledger is changed on the Tally tab.
export async function applyLedgerRows(rows: LedgerRow[], userId: string, confirmUnchanged: boolean) {
  const changes = rows.filter((r) => r.status === "change");
  const confirms = confirmUnchanged ? rows.filter((r) => r.status === "confirm") : [];
  const chunk = 200;
  for (let i = 0; i < changes.length; i += chunk) {
    await prisma.$transaction(
      changes.slice(i, i + chunk).flatMap((r) => [
        prisma.client.update({
          where: { id: r.clientId! },
          data: { tallyLedgerName: r.custom, tallyLedgerPending: false },
        }),
        prisma.bill.updateMany({
          where: { clientId: r.clientId!, billNumber: { not: null }, tallyExportedAt: null, connectorId: null },
          data: { tallyLedgerName: r.to },
        }),
      ])
    );
  }
  if (confirms.length) {
    await prisma.client.updateMany({
      where: { id: { in: confirms.map((r) => r.clientId!) } },
      data: { tallyLedgerPending: false },
    });
  }
  if (changes.length || confirms.length) {
    await prisma.activity.create({
      data: {
        type: "client",
        action: "updated",
        target: [
          changes.length && `Tally ledger of ${changes.length} client${changes.length === 1 ? "" : "s"} from Excel`,
          confirms.length && `${confirms.length} ledger${confirms.length === 1 ? "" : "s"} confirmed as the client's name`,
        ]
          .filter(Boolean)
          .join("; "),
        userId,
      },
    });
  }
  return { changed: changes.length, confirmed: confirms.length };
}
