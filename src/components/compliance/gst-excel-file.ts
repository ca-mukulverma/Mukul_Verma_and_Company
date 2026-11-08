import JSZip from "jszip";
import type { FileDoc } from "@/lib/gst-read/working";
import { gstr1Sheets, gstr2bSheets, monthName, SheetData, yearSheets } from "@/lib/gst-excel";

// GSTR-1 / GSTR-2B JSON saved in the app → an Excel workbook, made in the
// browser (lib/gst-excel.ts lays out the sheets): the saved files are read
// from storage as a download would, nothing is stored and the server does no
// work. A month, or a whole year with the month first on every row.

export type ExcelReturn = "GSTR1_JSON" | "GSTR2B_JSON";

const RETURN_NAMES: Record<ExcelReturn, string> = { GSTR1_JSON: "GSTR-1", GSTR2B_JSON: "GSTR-2B" };

/* eslint-disable @typescript-eslint/no-explicit-any */
// A saved file's JSON: the file itself, or each JSON in a ZIP
async function jsonsOf(doc: FileDoc): Promise<any[]> {
  const response = await fetch(`/api/compliance/documents/${doc.id}`);
  if (!response.ok) throw new Error(`${doc.fileName} couldn't be downloaded`);
  const bytes = await response.arrayBuffer();
  if (/\.zip$/i.test(doc.fileName)) {
    const zip = await JSZip.loadAsync(bytes);
    const inner = Object.values(zip.files).filter((f) => !f.dir && /\.json$/i.test(f.name));
    return Promise.all(inner.map(async (f) => JSON.parse(await f.async("string"))));
  }
  return [JSON.parse(new TextDecoder().decode(bytes))];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function monthSheets(kind: ExcelReturn, docs: FileDoc[]): Promise<SheetData[]> {
  // Newest first, as the layout expects
  const ordered = [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (kind === "GSTR1_JSON") return gstr1Sheets((await Promise.all(ordered.map(jsonsOf))).flat());
  const files: Parameters<typeof gstr2bSheets>[0] = [];
  for (const doc of ordered) for (const json of await jsonsOf(doc)) files.push({ json, part: doc.part, partNo: doc.partNo });
  return gstr2bSheets(files);
}

const FORMATS = { amount: "#,##0.00", rate: "0.00", date: "dd-mm-yyyy", number: "#,##0.###" } as const;

// A sheet name Excel accepts (31 characters, none of []:*?/\)
const sheetName = (name: string, taken: Set<string>) => {
  const base = name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
  let out = base;
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${base.slice(0, 27)} (${n})`;
  taken.add(out.toLowerCase());
  return out;
};

export async function workbook(sheets: SheetData[], heading: string[]) {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  book.creator = "MV Company";
  const taken = new Set<string>();
  for (const sheet of sheets) {
    const ws = book.addWorksheet(sheetName(sheet.name, taken));
    // The Summary sheet says what the workbook is
    const top = sheet.name === "Summary" ? heading.length + 1 : 0;
    if (top) {
      heading.forEach((line, i) => {
        ws.getCell(i + 1, 1).value = line;
        if (i === 0) ws.getCell(i + 1, 1).font = { bold: true, size: 13 };
      });
    }
    const headerRow = ws.getRow(top + 1);
    sheet.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    sheet.rows.forEach((r, n) => {
      const row = ws.getRow(top + 2 + n);
      sheet.columns.forEach((c, i) => {
        const v = r[c.key];
        if (v == null) return;
        const cell = row.getCell(i + 1);
        cell.value = v;
        if (c.type && c.type !== "text" && (typeof v === "number" || v instanceof Date)) cell.numFmt = FORMATS[c.type];
      });
    });
    sheet.columns.forEach((c, i) => {
      const longest = Math.max(c.header.length * 0.8, ...sheet.rows.slice(0, 200).map((r) => (r[c.key] instanceof Date ? 10 : String(r[c.key] ?? "").length)));
      ws.getColumn(i + 1).width = Math.min(45, Math.max(10, Math.ceil(longest) + 2));
    });
    ws.views = [{ state: "frozen", ySplit: top + 1 }];
    if (sheet.rows.length) ws.autoFilter = { from: { row: top + 1, column: 1 }, to: { row: top + 1 + sheet.rows.length, column: sheet.columns.length } };
  }
  return book.xlsx.writeBuffer();
}

function save(data: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, " ");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// One month (one entry) or a year: the months with their saved files.
// Answers what went into it, for the message shown.
export async function downloadGstExcel(input: {
  kind: ExcelReturn;
  party: string;
  gstin: string;
  months: { month: string; docs: FileDoc[] }[];
  // "FY 2026-27" for a year's workbook
  year?: string;
  onProgress?: (text: string) => void;
}): Promise<{ months: number; skipped: string[] }> {
  const { kind, party, gstin } = input;
  const done: { month: string; sheets: SheetData[] }[] = [];
  const skipped: string[] = [];
  for (const [n, m] of input.months.entries()) {
    input.onProgress?.(`Reading ${monthName(m.month)}${input.months.length > 1 ? ` (${n + 1} of ${input.months.length})` : ""}…`);
    try {
      const sheets = await monthSheets(kind, m.docs);
      if (sheets.some((s) => s.rows.length)) done.push({ month: m.month, sheets });
      else skipped.push(`${monthName(m.month)}: nothing in the file`);
    } catch (error) {
      skipped.push(`${monthName(m.month)}: ${error instanceof Error ? error.message : "couldn't be read"}`);
    }
  }
  if (!done.length) throw new Error(skipped.join(" · ") || "No saved file to read");
  const what = RETURN_NAMES[kind];
  const period = input.year ?? monthName(done[0].month);
  const sheets = input.year ? yearSheets(done) : done[0].sheets;
  const files = input.months.reduce((s, m) => s + m.docs.length, 0);
  input.onProgress?.("Writing the Excel file…");
  const data = await workbook(sheets, [
    `${party} – ${what} – ${period}`,
    `GSTIN ${gstin}`,
    `Made from ${files} saved JSON file${files === 1 ? "" : "s"}${input.year ? ` (${done.length} month${done.length === 1 ? "" : "s"})` : ""} on ${new Date().toLocaleDateString("en-IN")}`,
    ...(skipped.length ? [`Not included: ${skipped.join(" · ")}`] : []),
  ]);
  save(data as ArrayBuffer, `${party} - ${what} - ${period}.xlsx`);
  return { months: done.length, skipped };
}
