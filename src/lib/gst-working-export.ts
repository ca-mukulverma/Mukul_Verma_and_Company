import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { Heads, totalTax } from "@/lib/gst-read/types";
import { RowKey, WORKING_ROWS } from "@/lib/gst-read/working";
import type { ClientWorking } from "@/lib/gst-working";

// The GST working as Excel and PDF, in the firm's format: the year's total,
// then every month (or quarter), each with taxable value, IGST, CGST, SGST,
// cess (only when there is any), total tax and total value.

type Column = { key: keyof Heads | "tax" | "value"; label: string };

function columnsOf(working: ClientWorking): Column[] {
  return [
    { key: "taxable", label: "TAXABLE VALUE" },
    { key: "igst", label: "IGST" },
    { key: "cgst", label: "CGST" },
    { key: "sgst", label: "SGST" },
    ...(working.hasCess ? [{ key: "cess" as const, label: "CESS" }] : []),
    { key: "tax", label: "TOTAL TAX" },
    { key: "value", label: "TOTAL VALUE" },
  ];
}

const valueOf = (h: Heads, key: Column["key"]) => (key === "tax" ? totalTax(h) : key === "value" ? h.taxable + totalTax(h) : h[key]);

// The rows shown: optional rows only when some period has a figure
function rowsOf(working: ClientWorking) {
  return WORKING_ROWS.filter((r) => !("key" in r) || !r.optional || working.periods.some((p) => p.rows[r.key] && valueOf(p.rows[r.key]!, "value") !== 0));
}

const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
export const workingFileName = (working: ClientWorking, ext: string) =>
  `GST working ${working.client.name.replace(/[^\w &.-]+/g, "")} FY ${fyLabel(working.fy)}.${ext}`;

// Indian grouping (12,34,567.89) for Excel
const INDIAN = '[>=10000000]##\\,##\\,##\\,##0.00;[<=-10000000]-##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;[<=-100000]-##\\,##\\,##0.00;##,##0.00;-##,##0.00';

export async function workingExcel(working: ClientWorking): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("GST working", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
  const columns = columnsOf(working);
  const groups: { title: string; rows: Partial<Record<RowKey, Heads>> }[] = [
    { title: "TOTAL", rows: working.total },
    ...working.periods.map((p) => ({ title: p.title.toUpperCase(), rows: p.rows })),
  ];

  sheet.getCell(1, 1).value = `${working.client.name}${working.client.gstin ? ` · GSTIN ${working.client.gstin}` : ""} · GST working FY ${fyLabel(working.fy)}`;
  sheet.getCell(1, 1).font = { bold: true, size: 12 };
  sheet.getCell(3, 1).value = "SALES WORKING";
  sheet.getColumn(1).width = 52;
  groups.forEach((g, gi) => {
    const first = 2 + gi * columns.length;
    sheet.mergeCells(3, first, 3, first + columns.length - 1);
    sheet.getCell(3, first).value = g.title;
    sheet.getCell(3, first).alignment = { horizontal: "center" };
    columns.forEach((c, ci) => {
      const cell = sheet.getCell(4, first + ci);
      cell.value = c.label;
      cell.alignment = { horizontal: "center", wrapText: true };
      sheet.getColumn(first + ci).width = c.key === "taxable" || c.key === "value" ? 16 : 13;
    });
  });
  for (const r of [3, 4]) sheet.getRow(r).font = { bold: true };

  let rowNo = 5;
  for (const def of rowsOf(working)) {
    if ("heading" in def) {
      // A blank row, then the heading
      rowNo++;
      const heading = sheet.getRow(rowNo++).getCell(1);
      heading.value = def.heading;
      heading.font = { bold: true, underline: true };
      continue;
    }
    const row = sheet.getRow(rowNo++);
    row.getCell(1).value = def.label;
    if (def.key.endsWith("_net") || def.key === "net_after_1a") row.font = { bold: true };
    groups.forEach((g, gi) => {
      const h = g.rows[def.key];
      if (!h) return;
      columns.forEach((c, ci) => {
        const cell = row.getCell(2 + gi * columns.length + ci);
        cell.value = Math.round(valueOf(h, c.key) * 100) / 100;
        cell.numFmt = INDIAN;
        if (def.difference && Math.abs(cell.value as number) >= 1) cell.font = { bold: true, color: { argb: "FFC00000" } };
      });
    });
  }
  sheet.eachRow((row, n) => n >= 3 && row.eachCell((cell) => (cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } })));

  const checks = book.addWorksheet("Checks");
  checks.columns = [
    { header: "Period", width: 26 },
    { header: "Type", width: 12 },
    { header: "What", width: 100 },
  ];
  checks.getRow(1).font = { bold: true };
  for (const p of working.periods) {
    for (const issue of p.issues) checks.addRow([p.title, issue.severity === "difference" ? "Difference" : issue.severity === "missing" ? "Missing" : "Check", issue.text]);
  }

  const files = book.addWorksheet("Files");
  files.columns = [
    { header: "Period", width: 26 },
    { header: "File", width: 30 },
    { header: "Status", width: 14 },
  ];
  files.getRow(1).font = { bold: true };
  for (const p of working.periods.filter((x) => x.over)) {
    for (const f of p.files) files.addRow([p.title, f.label, f.state === "ok" ? "Uploaded" : f.state === "missing" ? "Missing" : "Not uploaded (optional)"]);
  }

  return Buffer.from(await book.xlsx.writeBuffer());
}

// 12,34,567.89
function indian(n: number) {
  const negative = n < 0;
  const [whole, paise] = Math.abs(n).toFixed(2).split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${rest ? `${rest},` : ""}${last3}.${paise}`;
}

export function workingPdf(working: ClientWorking): Buffer {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const columns = columnsOf(working);
  const groups: { title: string; rows: Partial<Record<RowKey, Heads>> }[] = [
    { title: "TOTAL", rows: working.total },
    ...working.periods.map((p) => ({ title: p.title.toUpperCase(), rows: p.rows })),
  ];
  const left = 8;
  const labelWidth = 56;
  // Two column groups a page; amounts up to 99,99,99,999.99 fit
  const colWidth = (281 - left - labelWidth) / (2 * columns.length);
  const perPage = 2;
  const defs = rowsOf(working);
  const title = `${working.client.name}${working.client.gstin ? ` · GSTIN ${working.client.gstin}` : ""} · GST working FY ${fyLabel(working.fy)}`;

  for (let start = 0; start < groups.length; start += perPage) {
    if (start > 0) pdf.addPage();
    const shown = groups.slice(start, start + perPage);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(title, left, 10);
    let y = 18;
    pdf.setFontSize(6);
    shown.forEach((g, gi) => {
      const x = left + labelWidth + gi * columns.length * colWidth;
      pdf.rect(x, y - 4, columns.length * colWidth, 5);
      pdf.text(g.title, x + (columns.length * colWidth) / 2, y - 0.6, { align: "center" });
      columns.forEach((c, ci) => {
        pdf.rect(x + ci * colWidth, y + 1, colWidth, 7);
        pdf.text(c.label.split(" "), x + ci * colWidth + colWidth / 2, y + 3.8, { align: "center" });
      });
    });
    pdf.text("SALES WORKING", left + 1, y + 5.4);
    pdf.rect(left, y - 4, labelWidth, 12);
    y += 8;
    for (const def of defs) {
      if ("heading" in def) {
        y += 1.5;
        pdf.setFont("helvetica", "bold");
        pdf.text(def.heading, left + 1, y + 3);
        y += 4.2;
        continue;
      }
      const strong = def.key.endsWith("_net") || def.key === "net_after_1a" || !!def.difference;
      pdf.setFont("helvetica", strong ? "bold" : "normal");
      pdf.setTextColor(0, 0, 0);
      const label = pdf.splitTextToSize(def.label, labelWidth - 2) as string[];
      const height = 4.2 + (label.length - 1) * 2.6;
      pdf.rect(left, y, labelWidth, height);
      pdf.text(label, left + 1, y + 3);
      shown.forEach((g, gi) => {
        const x = left + labelWidth + gi * columns.length * colWidth;
        const h = g.rows[def.key];
        columns.forEach((c, ci) => {
          pdf.rect(x + ci * colWidth, y, colWidth, height);
          if (!h) return;
          const v = valueOf(h, c.key);
          if (def.difference && Math.abs(v) >= 1) pdf.setTextColor(192, 0, 0);
          pdf.text(indian(v), x + (ci + 1) * colWidth - 0.8, y + 3, { align: "right" });
          pdf.setTextColor(0, 0, 0);
        });
      });
      y += height;
    }
  }

  // What needs attention, period by period
  const notes = working.periods.flatMap((p) => [
    ...p.issues.map((i) => `${p.title}: ${i.severity === "difference" ? "DIFFERENCE" : i.severity === "missing" ? "MISSING" : "CHECK"} – ${i.text}`),
  ]);
  if (notes.length) {
    pdf.addPage();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(`${title} · checks`, left, 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    let y = 18;
    for (const note of notes) {
      // The PDF font has no rupee sign
      const lines = pdf.splitTextToSize(note.replace(/₹/g, "Rs. "), 270) as string[];
      if (y + lines.length * 4 > 200) {
        pdf.addPage();
        y = 12;
      }
      pdf.text(lines, left, y);
      y += lines.length * 4 + 1;
    }
  }
  return Buffer.from(pdf.output("arraybuffer"));
}
