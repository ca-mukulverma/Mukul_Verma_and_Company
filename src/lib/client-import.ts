import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ClientPhone } from "@/lib/client-contacts";
import { registrationsPayload, registrationsProblem } from "@/lib/client-documents";

// Bulk client import from an Excel sheet (Admin, Partner). The template has a
// "Clients" sheet to fill in and an "Instructions" sheet.

export const MAX_IMPORT_ROWS = 1000;

const COLUMNS = [
  { key: "contactPerson", header: "Contact Person*", width: 26, max: 50, note: "Required. The person to contact." },
  { key: "companyName", header: "Company Name", width: 32, max: 75, note: "Firm or company name, if any." },
  { key: "email", header: "Email", width: 30, max: 75, note: "Email or phone is required." },
  { key: "phone", header: "Phone", width: 16, max: 15, note: "Email or phone is required. Up to 15 digits, e.g. +919876543210." },
  { key: "gstin", header: "GSTIN", width: 18, max: 15, note: "Optional. 15 characters, starting with the state code." },
  { key: "address", header: "Address", width: 40, max: 150, note: "Optional. Up to 150 characters." },
  { key: "tallyLedgerName", header: "Tally Ledger Name", width: 28, max: 100, note: "Optional. Only if the client's ledger in Tally has a different name." },
  { key: "notes", header: "Notes", width: 36, max: 2000, note: "Optional." },
  { key: "otherPhones", header: "Other phones", width: 32, max: 400, note: "Optional. More numbers separated by ';', e.g. 9876500000 (Accountant, WhatsApp); 0755 2550000 (Office)." },
  { key: "pan", header: "PAN", width: 12, max: 10, note: "Optional. e.g. ABCDE1234F" },
  { key: "tan", header: "TAN", width: 12, max: 10, note: "Optional. e.g. BPLA12345B" },
  { key: "cin", header: "CIN / LLPIN", width: 24, max: 21, note: "Optional. e.g. U74999MP2020PTC012345 or AAB-1234" },
  { key: "udyamNumber", header: "Udyam number", width: 22, max: 19, note: "Optional. e.g. UDYAM-MP-12-0012345" },
  { key: "iec", header: "IEC", width: 12, max: 10, note: "Optional. 10 characters." },
  { key: "responsibleName", header: "Responsible person", width: 22, max: 50, note: "Optional. Who gets compliance reminders, if not the owner. Empty or 'Owner' means the owner." },
  { key: "responsiblePhone", header: "Responsible phone", width: 16, max: 15, note: "Optional." },
  { key: "responsibleEmail", header: "Responsible email", width: 28, max: 75, note: "Optional." },
  { key: "connector", header: "Connector", width: 22, max: 100, note: "Optional. Name of a connector already in Billing → Connectors." },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];
export type ClientRowData = Record<ColumnKey, string | null>;

export interface ImportRow {
  row: number; // row number in the sheet
  data: ClientRowData;
  errors: string[];
  duplicate: string | null; // why the row matches an existing client or an earlier row
  phones?: ClientPhone[]; // the owner's numbers, when more than one
  connectorId?: string | null;
}

export async function buildClientTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MV Company";

  const sheet = workbook.addWorksheet("Clients", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  header.height = 20;
  COLUMNS.forEach((c, i) => {
    header.getCell(i + 1).note = c.note;
  });
  // Keep phone numbers and GSTINs as text so Excel doesn't turn them into numbers
  for (const key of ["phone", "gstin", "otherPhones", "responsiblePhone"] as const) {
    sheet.getColumn(key).numFmt = "@";
  }

  const help = workbook.addWorksheet("Instructions");
  help.columns = [{ width: 24 }, { width: 90 }];
  const lines: [string, string][] = [
    ["How to use", "Fill one client per row on the 'Clients' sheet, starting from row 2. Do not change the column headings."],
    ["", "Then upload this file in Clients → Import from Excel. You will see a check of every row before anything is saved."],
    ["", "A file from Clients → Export to Excel can be uploaded here as it is."],
    ["Required", "Contact Person, and at least one of Email or Phone."],
    ["Duplicates", "Rows with the same GSTIN, email or phone as an existing client (or an earlier row) are skipped."],
    ["Limit", `Up to ${MAX_IMPORT_ROWS} clients per file.`],
    ["", ""],
    ["Column", "What to enter"],
    ...COLUMNS.map((c) => [c.header, c.note] as [string, string]),
    ["", ""],
    ["Example", "Ravi Shah | Shah Traders | ravi@example.com | 9876543210 | 23ABCDE1234F1Z5 | M.P. Nagar, Bhopal"],
  ];
  for (const line of lines) help.addRow(line);
  help.getColumn(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Text of a cell whatever Excel stored: numbers, links, rich text, formulas
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text; // hyperlink
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue); // formula
  }
  return String(value);
}

const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

export class ImportFileError extends Error {}

// Reads the rows of the "Clients" sheet (or the first sheet)
export async function readClientRows(buffer: ArrayBuffer): Promise<{ row: number; data: ClientRowData }[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ImportFileError("This file could not be read. Please upload the .xlsx template.");
  }
  const sheet = workbook.getWorksheet("Clients") ?? workbook.worksheets[0];
  if (!sheet) throw new ImportFileError("The file has no sheets.");

  // Match columns by heading, so the column order doesn't matter
  const positions = new Map<ColumnKey, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const heading = normaliseHeader(cellText(cell.value));
    const column = COLUMNS.find((c) => normaliseHeader(c.header) === heading);
    if (column) positions.set(column.key, col);
  });
  if (!positions.has("contactPerson")) {
    throw new ImportFileError("The 'Contact Person*' column was not found. Please use the template.");
  }

  const rows: { row: number; data: ClientRowData }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = Object.fromEntries(
      COLUMNS.map((c) => {
        const col = positions.get(c.key);
        const text = col ? cellText(row.getCell(col).value).trim() : "";
        return [c.key, text || null];
      })
    ) as ClientRowData;
    if (Object.values(data).some((v) => v !== null)) rows.push({ row: rowNumber, data });
  });

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportFileError(`The file has ${rows.length} clients; the limit is ${MAX_IMPORT_ROWS} per file.`);
  }
  return rows;
}

const normalisePhone = (phone: string) => phone.replace(/[\s\-().]/g, "");

// Checks every row and marks duplicates of existing clients or earlier rows
// "9876500000 (Accountant, WhatsApp); 0755 2550000 (Office)" as phone entries
function parseOtherPhones(text: string): ClientPhone[] | string {
  const phones: ClientPhone[] = [];
  for (const part of text.split(";").map((p) => p.trim()).filter(Boolean)) {
    const match = part.match(/^([^(]+?)\s*(?:\((.*)\))?$/);
    const number = match ? normalisePhone(match[1]) : "";
    if (!/^\+?\d{6,14}$/.test(number)) return `Other phones: "${part}" is not a phone number`;
    const notes = (match?.[2] ?? "").split(",").map((n) => n.trim()).filter(Boolean);
    const label = notes.find((n) => n.toLowerCase() !== "whatsapp")?.slice(0, 20) || "Other";
    phones.push({ number, label, whatsapp: notes.some((n) => n.toLowerCase() === "whatsapp") });
  }
  return phones;
}

export async function checkClientRows(rows: { row: number; data: ClientRowData }[]): Promise<ImportRow[]> {
  const [existing, connectors] = await Promise.all([
    prisma.client.findMany({ select: { gstin: true, email: true, phone: true, contactPerson: true } }),
    prisma.connector.findMany({ select: { id: true, name: true } }),
  ]);
  const connectorIds = new Map(connectors.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const seen = {
    gstin: new Map<string, string>(),
    email: new Map<string, string>(),
    phone: new Map<string, string>(),
  };
  for (const c of existing) {
    if (c.gstin) seen.gstin.set(c.gstin.toUpperCase(), `existing client ${c.contactPerson}`);
    if (c.email) seen.email.set(c.email.toLowerCase(), `existing client ${c.contactPerson}`);
    if (c.phone) seen.phone.set(normalisePhone(c.phone), `existing client ${c.contactPerson}`);
  }

  return rows.map(({ row, data }) => {
    const errors: string[] = [];
    const d = { ...data };
    if (d.gstin) d.gstin = d.gstin.toUpperCase().replace(/\s/g, "");
    if (d.email) d.email = d.email.toLowerCase();
    if (d.phone) d.phone = normalisePhone(d.phone);

    if (!d.contactPerson) errors.push("Contact Person is missing");
    if (!d.email && !d.phone) errors.push("Email or Phone is needed");
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.push("Email is not valid");
    if (d.phone && !/^\+?\d{6,14}$/.test(d.phone)) errors.push("Phone should be 6–15 digits");
    if (d.gstin && !/^\d{2}[A-Z0-9]{13}$/.test(d.gstin)) errors.push("GSTIN should be 15 characters starting with the state code");
    if (d.responsibleName?.toLowerCase() === "owner") d.responsibleName = null;
    if (d.responsibleEmail) d.responsibleEmail = d.responsibleEmail.toLowerCase();
    if (d.responsiblePhone) d.responsiblePhone = normalisePhone(d.responsiblePhone);
    if (d.responsibleEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.responsibleEmail)) errors.push("Responsible email is not valid");
    if ((d.responsiblePhone || d.responsibleEmail) && !d.responsibleName) errors.push("Responsible person's name is missing");
    Object.assign(d, registrationsPayload(d));
    const registrationProblem = registrationsProblem(d);
    if (registrationProblem) errors.push(registrationProblem);

    let phones: ClientPhone[] | undefined;
    if (d.otherPhones) {
      const parsed = parseOtherPhones(d.otherPhones);
      if (typeof parsed === "string") errors.push(parsed);
      else if (parsed.length) {
        phones = [...(d.phone ? [{ number: d.phone, label: "Owner", whatsapp: true }] : []), ...parsed];
        if (phones.length > 10) errors.push("At most 10 phone numbers");
      }
    }

    let connectorId: string | null = null;
    if (d.connector) {
      connectorId = connectorIds.get(d.connector.toLowerCase()) ?? null;
      if (!connectorId) errors.push(`Connector "${d.connector}" was not found in Billing → Connectors`);
    }

    for (const c of COLUMNS) {
      const value = d[c.key];
      if (value && value.length > c.max) errors.push(`${c.header.replace("*", "")} is longer than ${c.max} characters`);
    }

    let duplicate: string | null = null;
    if (d.gstin && seen.gstin.has(d.gstin)) duplicate = `Same GSTIN as ${seen.gstin.get(d.gstin)}`;
    else if (d.email && seen.email.has(d.email)) duplicate = `Same email as ${seen.email.get(d.email)}`;
    else if (d.phone && seen.phone.has(d.phone)) duplicate = `Same phone as ${seen.phone.get(d.phone)}`;

    // Later rows with the same details are duplicates of this one
    if (errors.length === 0 && !duplicate) {
      const label = `row ${row}`;
      if (d.gstin) seen.gstin.set(d.gstin, label);
      if (d.email) seen.email.set(d.email, label);
      if (d.phone) seen.phone.set(d.phone, label);
    }
    return { row, data: d, errors, duplicate, phones, connectorId };
  });
}

// Creates the rows that passed every check, managed by the person importing;
// returns how many were created
export async function importClientRows(rows: ImportRow[], userId: string) {
  const ready = rows.filter((r) => r.errors.length === 0 && !r.duplicate);
  if (ready.length === 0) return 0;
  await prisma.$transaction([
    prisma.client.createMany({
      data: ready.map(({ data, phones, connectorId }) => ({
        contactPerson: data.contactPerson!,
        companyName: data.companyName,
        email: data.email,
        phone: data.phone,
        gstin: data.gstin,
        address: data.address,
        tallyLedgerName: data.tallyLedgerName,
        notes: data.notes,
        ...(phones && { phones: phones as unknown as Prisma.InputJsonValue, phone: phones[0].number }),
        pan: data.pan,
        tan: data.tan,
        cin: data.cin,
        udyamNumber: data.udyamNumber,
        iec: data.iec,
        ownerIsResponsible: !data.responsibleName,
        responsibleName: data.responsibleName,
        responsiblePhone: data.responsibleName ? data.responsiblePhone : null,
        responsibleEmail: data.responsibleName ? data.responsibleEmail : null,
        connectorId: connectorId ?? null,
        isGuest: false,
        managerId: userId,
      })),
    }),
    prisma.activity.create({
      data: {
        type: "client",
        action: "created",
        target: `Imported ${ready.length} client${ready.length === 1 ? "" : "s"} from Excel`,
        userId,
      },
    }),
  ]);
  return ready.length;
}
