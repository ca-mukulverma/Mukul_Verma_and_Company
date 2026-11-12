import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { COMPANY_LABELS, CompanyValue, MAX_WORK_ROWS, formatIndianDate } from "@/lib/billing-constants";
import { cellText, parseDay } from "@/lib/task-transfer";

// Log work done from Excel: download a sheet with drop-downs for the company
// and the client (or "Other" for a party not saved), fill in many pieces of
// work, and upload it. The rows are put in the Log work form to be checked
// there before anything is logged.

export { MAX_WORK_ROWS } from "@/lib/billing-constants";
export const OTHER_CLIENT = "Other (not a saved client)";
const TEMPLATE_ROWS = 300;

const COLUMNS = [
  { key: "company", header: "Company*", width: 10, note: "Pick MVC or B Edge from the list." },
  { key: "client", header: "Client*", width: 45, note: `Pick a saved client from the list, or "${OTHER_CLIENT}" and fill the next three columns.` },
  { key: "otherName", header: "Name to bill (Other)", width: 30, note: `Only for "${OTHER_CLIENT}": the name to bill. Required then.` },
  { key: "otherAddress", header: "Address (Other)", width: 35, note: `Only for "${OTHER_CLIENT}". Optional.` },
  { key: "otherGstin", header: "GSTIN (Other)", width: 18, note: `Only for "${OTHER_CLIENT}". Optional.` },
  { key: "description", header: "Work done*", width: 50, note: "What was done, e.g. GSTR-3B filing for September 2026." },
  { key: "workDate", header: "Date of work*", width: 14, note: "A date, e.g. 15/11/2026." },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

export class WorkImportFileError extends Error {}

interface ClientRow {
  id: string;
  contactPerson: string;
  companyName: string | null;
  gstin: string | null;
  pan: string | null;
}

// The name shown for each client in the drop-down; made unique so the row can
// be matched back to the client on upload
function clientLabels(clients: ClientRow[]): Map<string, ClientRow> {
  const base = (c: ClientRow) => (c.companyName ? `${c.companyName} (${c.contactPerson})` : c.contactPerson).trim();
  const counts = new Map<string, number>();
  for (const c of clients) counts.set(base(c).toLowerCase(), (counts.get(base(c).toLowerCase()) ?? 0) + 1);
  const labels = new Map<string, ClientRow>();
  for (const c of clients) {
    let label = base(c);
    if ((counts.get(label.toLowerCase()) ?? 0) > 1) label = `${label} – ${c.gstin || c.pan || c.id.slice(0, 6)}`;
    while (labels.has(label)) label = `${label} – ${c.id.slice(0, 6)}`;
    labels.set(label, c);
  }
  return labels;
}

const loadClients = () =>
  prisma.client.findMany({
    select: { id: true, contactPerson: true, companyName: true, gstin: true, pan: true },
    orderBy: [{ companyName: "asc" }, { contactPerson: "asc" }],
  });

export async function buildWorkTemplate(downloadedBy: string): Promise<Buffer> {
  const labels = [...clientLabels(await loadClients()).keys()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MV Company";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Work", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  COLUMNS.forEach((c, i) => {
    header.getCell(i + 1).note = c.note;
  });
  sheet.getColumn("otherGstin").numFmt = "@";
  sheet.getColumn("workDate").numFmt = "dd/mm/yyyy";

  // The client list sits on a hidden sheet, as it is too long to write into
  // the drop-down itself
  const lists = workbook.addWorksheet("Lists", { state: "hidden" });
  lists.getCell("A1").value = "Clients";
  lists.getCell("A2").value = OTHER_CLIENT;
  labels.forEach((label, i) => {
    lists.getCell(`A${i + 3}`).value = label;
  });
  const clientRange = `Lists!$A$2:$A$${labels.length + 2}`;

  const columnLetter = (key: ColumnKey) => sheet.getColumn(key).letter;
  const companies = Object.values(COMPANY_LABELS);
  for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) {
    sheet.getCell(`${columnLetter("company")}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${companies.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Company",
      error: `Pick ${companies.join(" or ")}`,
    };
    sheet.getCell(`${columnLetter("client")}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [clientRange],
      showErrorMessage: true,
      errorTitle: "Client",
      error: `Pick a client from the list, or "${OTHER_CLIENT}" and type the name in the next column.`,
    };
    sheet.getCell(`${columnLetter("workDate")}${r}`).dataValidation = {
      type: "date",
      operator: "greaterThan",
      allowBlank: true,
      formulae: [new Date(Date.UTC(2000, 0, 1))],
      showErrorMessage: true,
      errorTitle: "Date of work",
      error: "Enter a date, e.g. 15/11/2026",
    };
  }

  const help = workbook.addWorksheet("Instructions");
  help.columns = [{ width: 24 }, { width: 100 }];
  const lines: [string, string][] = [
    ["Downloaded on", formatIndianDate(new Date(), "medium")],
    ["Downloaded by", downloadedBy],
    ["", ""],
    ["How to use", "Fill one row per piece of work in the 'Work' sheet, then upload the file in Billing → Log work → Import from Excel."],
    ["", "The rows are put in the form for you to check; nothing is logged until you press Log."],
    ["Clients", `Pick from the drop-down. A party that is not saved: pick "${OTHER_CLIENT}" and type the name to bill.`],
    ["", "Clients added after this file was downloaded are not in the list: download a new file, or pick them in the form."],
    ["Limit", `Up to ${MAX_WORK_ROWS} pieces of work per file.`],
    ["", ""],
    ["Column", "What to enter"],
    ...COLUMNS.map((c) => [c.header, c.note] as [string, string]),
  ];
  for (const line of lines) help.addRow(line);
  help.getColumn(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export interface WorkImportRow {
  row: number;
  company: CompanyValue | null;
  client: { id: string; contactPerson: string; companyName: string | null } | null;
  other: { name: string; address: string; gstin: string } | null;
  description: string;
  workDate: string | null; // yyyy-mm-dd
  problems: string[];
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function readWorkFile(buffer: ArrayBuffer): Promise<WorkImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new WorkImportFileError("This file could not be read. Please upload the .xlsx file downloaded from Log work.");
  }
  const sheet = workbook.getWorksheet("Work") ?? workbook.worksheets[0];
  if (!sheet) throw new WorkImportFileError("The file has no sheets.");

  const positions = new Map<ColumnKey, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const heading = normalise(cellText(cell.value));
    const column = COLUMNS.find((c) => normalise(c.header) === heading);
    if (column) positions.set(column.key, col);
  });
  if (!positions.has("client") || !positions.has("description")) {
    throw new WorkImportFileError("The 'Client*' and 'Work done*' columns were not found. Please use the file downloaded from Log work.");
  }

  const raw: { row: number; data: Record<ColumnKey, string> }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = Object.fromEntries(
      COLUMNS.map((c) => {
        const col = positions.get(c.key);
        return [c.key, col ? cellText(row.getCell(col).value).trim() : ""];
      })
    ) as Record<ColumnKey, string>;
    if (Object.values(data).some(Boolean)) raw.push({ row: rowNumber, data });
  });
  if (raw.length === 0) throw new WorkImportFileError("No work was found in the file.");
  if (raw.length > MAX_WORK_ROWS) {
    throw new WorkImportFileError(`The file has ${raw.length} rows; up to ${MAX_WORK_ROWS} can be imported at a time.`);
  }

  const labels = clientLabels(await loadClients());
  const byLabel = new Map([...labels].map(([label, c]) => [label.toLowerCase(), c]));
  // A name typed instead of picked: matched when only one client has it
  const byName = new Map<string, ClientRow[]>();
  for (const c of labels.values()) {
    for (const name of [c.companyName, c.contactPerson, c.gstin]) {
      if (!name) continue;
      const key = normalise(name);
      byName.set(key, [...(byName.get(key) ?? []), c]);
    }
  }
  const findClient = (text: string): ClientRow | "many" | null => {
    const exact = byLabel.get(text.toLowerCase());
    if (exact) return exact;
    const loose = byName.get(normalise(text));
    if (!loose) return null;
    return loose.length === 1 ? loose[0] : "many";
  };
  const companyOf = (text: string): CompanyValue | null => {
    const key = normalise(text);
    if (!key) return null;
    return (Object.entries(COMPANY_LABELS).find(([value, label]) => normalise(value) === key || normalise(label) === key)?.[0] ??
      null) as CompanyValue | null;
  };

  return raw.map(({ row, data }) => {
    const problems: string[] = [];
    const company = companyOf(data.company);
    if (!data.company) problems.push("Company is empty");
    else if (!company) problems.push(`Company "${data.company}" is not MVC or B Edge`);

    let client: WorkImportRow["client"] = null;
    let other: WorkImportRow["other"] = null;
    const isOther = normalise(data.client) === normalise(OTHER_CLIENT) || (!data.client && !!data.otherName);
    if (isOther) {
      other = { name: data.otherName.slice(0, 150), address: data.otherAddress, gstin: data.otherGstin.toUpperCase().slice(0, 15) };
      if (data.otherName.length < 2) problems.push("Enter the name to bill for Other");
    } else if (!data.client) {
      problems.push("Client is empty");
    } else {
      const found = findClient(data.client);
      if (found === "many") problems.push(`"${data.client}" matches more than one client – pick the right one`);
      else if (found) client = { id: found.id, contactPerson: found.contactPerson, companyName: found.companyName };
      else problems.push(`Client "${data.client}" was not found – pick the client, or choose Other`);
    }

    const description = data.description.slice(0, 2000);
    if (description.length < 3) problems.push("Describe the work done");

    const workDate = data.workDate ? parseDay(data.workDate) : null;
    if (!data.workDate) problems.push("Date of work is empty");
    else if (!workDate) problems.push(`Date "${data.workDate}" is not a date (use e.g. 15/11/2026)`);

    return { row, company, client, other, description, workDate, problems };
  });
}
