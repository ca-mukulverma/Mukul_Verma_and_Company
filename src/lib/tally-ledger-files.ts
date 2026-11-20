import { jsPDF } from "jspdf";
import ExcelJS from "exceljs";
import { amount, asOfText, longDate, tallyDate, type Statement } from "@/lib/tally-debtors-shared";

// A debtor's ledger as PDF or Excel, laid out as Tally shows it in Ledger
// Vouchers: company, ledger and period on top; Date, Particulars, Vch Type,
// Vch No., Debit, Credit; then Opening Balance, Current Total and Closing
// Balance. No letterhead. The time of the Tally data is printed at the foot,
// so an old copy is never taken for a new one.

export interface LedgerFileInput {
  company: string;
  ledger: string;
  statement: Statement;
  narration: boolean;
  readAt: string | null;
}

const toBy = (dr: number) => (dr > 0 ? "To" : "By");

// ─── PDF ────────────────────────────────────────────────────────────────────

const L = 12;
const R = 198;
const COLS = {
  date: L + 1,
  part: L + 21,
  type: 100,
  no: 127,
  drRight: 173,
  crRight: R - 1,
};
const TOP = 14;
const BOTTOM = 282;

export function ledgerPdf(input: LedgerFileInput): Buffer {
  const { statement: s } = input;
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const centre = (text: string, y: number, size: number, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.text(text, (L + R) / 2, y, { align: "center" });
  };
  const line = (y: number) => {
    pdf.setLineWidth(0.2);
    pdf.line(L, y, R, y);
  };

  let y = TOP;
  const header = (first: boolean) => {
    y = TOP;
    if (first) {
      centre(input.company, y, 13, true);
      y += 6;
      centre(input.ledger, y, 11, true);
      y += 5;
      centre("Ledger Account", y, 9);
      y += 4.5;
      centre(`${longDate(s.from)} to ${longDate(s.to)}`, y, 9);
      y += 4;
    } else {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text(`${input.ledger}  (${longDate(s.from)} to ${longDate(s.to)})`, L, y);
      y += 3;
    }
    line(y);
    y += 4;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text("Date", COLS.date, y);
    pdf.text("Particulars", COLS.part, y);
    pdf.text("Vch Type", COLS.type, y);
    pdf.text("Vch No.", COLS.no, y);
    pdf.text("Debit", COLS.drRight, y, { align: "right" });
    pdf.text("Credit", COLS.crRight, y, { align: "right" });
    y += 2;
    line(y);
    y += 4.5;
  };

  const room = (needed: number) => {
    if (y + needed <= BOTTOM - 8) return;
    pdf.addPage();
    header(false);
  };

  header(true);
  pdf.setFontSize(8.5);
  const fit = (text: string, width: number) => {
    let t = text;
    while (t.length > 1 && pdf.getTextWidth(t) > width) t = t.slice(0, -1);
    return t === text ? t : `${t.slice(0, -1)}…`;
  };

  for (const e of s.lines) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    const narration = input.narration && e.r ? (pdf.splitTextToSize(e.r, COLS.type - COLS.part - 8) as string[]) : [];
    room(4.5 + narration.length * 3.6);
    pdf.text(tallyDate(e.d), COLS.date, y);
    pdf.setFont("helvetica", "normal");
    pdf.text(toBy(e.dr), COLS.part, y);
    pdf.text(fit(e.p, COLS.type - COLS.part - 9), COLS.part + 6, y);
    pdf.text(fit(e.t, COLS.no - COLS.type - 2), COLS.type, y);
    pdf.text(fit(e.n, COLS.drRight - 24 - COLS.no), COLS.no, y);
    if (e.dr) pdf.text(amount(e.dr), COLS.drRight, y, { align: "right" });
    if (e.cr) pdf.text(amount(e.cr), COLS.crRight, y, { align: "right" });
    y += 4.5;
    if (narration.length) {
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(7.5);
      for (const n of narration) {
        pdf.text(n, COLS.part + 6, y - 1);
        y += 3.6;
      }
    }
  }

  // Opening Balance, Current Total, Closing Balance, as at the foot of Tally's screen
  room(22);
  y += 1;
  pdf.setLineWidth(0.2);
  pdf.line(COLS.drRight - 26, y - 3, R, y - 3);
  const summary = (label: string, dr: string, cr: string, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(8.5);
    pdf.text(label, COLS.no - 30, y);
    if (dr) pdf.text(dr, COLS.drRight, y, { align: "right" });
    if (cr) pdf.text(cr, COLS.crRight, y, { align: "right" });
    y += 5;
  };
  summary("Opening Balance :", s.opening > 0 ? amount(s.opening) : "", s.opening < 0 ? amount(s.opening) : "");
  summary("Current Total :", amount(s.totalDr), amount(s.totalCr));
  pdf.line(COLS.drRight - 26, y - 3.5, R, y - 3.5);
  summary("Closing Balance :", s.closing > 0 ? amount(s.closing) : "", s.closing < 0 ? amount(s.closing) : "", true);
  if (!s.closing) {
    pdf.setFont("helvetica", "normal");
    pdf.text("Nil", COLS.crRight, y - 5, { align: "right" });
  }

  // Foot of every page: the time of the Tally data and the page number
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(90);
    if (input.readAt) pdf.text(`As per Tally data of ${asOfText(input.readAt)}`, L, BOTTOM + 6);
    pdf.text(`Page ${i} of ${pages}`, R, BOTTOM + 6, { align: "right" });
    pdf.setTextColor(0);
  }
  return Buffer.from(pdf.output("arraybuffer"));
}

// ─── Excel ──────────────────────────────────────────────────────────────────

const NUMBER = "#,##,##0.00;#,##,##0.00;";

export async function ledgerExcel(input: LedgerFileInput): Promise<Buffer> {
  const { statement: s } = input;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Ledger", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.columns = [
    { key: "date", width: 11 },
    { key: "tb", width: 4 },
    { key: "part", width: 42 },
    { key: "type", width: 14 },
    { key: "no", width: 16 },
    { key: "dr", width: 15 },
    { key: "cr", width: 15 },
  ];
  const title = (text: string, size: number, bold: boolean) => {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, 7);
    row.getCell(1).font = { size, bold };
    row.getCell(1).alignment = { horizontal: "center" };
  };
  title(input.company, 13, true);
  title(input.ledger, 11, true);
  title("Ledger Account", 10, false);
  title(`${longDate(s.from)} to ${longDate(s.to)}`, 10, false);
  sheet.addRow([]);

  const head = sheet.addRow(["Date", "Particulars", "", "Vch Type", "Vch No.", "Debit", "Credit"]);
  sheet.mergeCells(head.number, 2, head.number, 3);
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
  });
  head.getCell(6).alignment = { horizontal: "right" };
  head.getCell(7).alignment = { horizontal: "right" };

  for (const e of s.lines) {
    const row = sheet.addRow([tallyDate(e.d), toBy(e.dr), e.p, e.t, e.n, e.dr || null, e.cr || null]);
    row.getCell(6).numFmt = NUMBER;
    row.getCell(7).numFmt = NUMBER;
    if (input.narration && e.r) {
      const note = sheet.addRow(["", "", e.r]);
      note.getCell(3).font = { italic: true, size: 9 };
      note.getCell(3).alignment = { wrapText: true };
    }
  }

  const summary = (label: string, dr: number | null, cr: number | null, bold = false, top = false) => {
    const row = sheet.addRow(["", "", "", "", label, dr, cr]);
    row.getCell(5).font = { bold };
    row.getCell(5).alignment = { horizontal: "right" };
    for (const c of [6, 7]) {
      row.getCell(c).numFmt = NUMBER;
      row.getCell(c).font = { bold };
      if (top) row.getCell(c).border = { top: { style: "thin" } };
    }
  };
  summary("Opening Balance", s.opening > 0 ? s.opening : null, s.opening < 0 ? -s.opening : null, false, true);
  summary("Current Total", s.totalDr || null, s.totalCr || null);
  summary("Closing Balance", s.closing > 0 ? s.closing : null, s.closing < 0 ? -s.closing : null, true, true);

  if (input.readAt) {
    sheet.addRow([]);
    const foot = sheet.addRow([`As per Tally data of ${asOfText(input.readAt)}`]);
    foot.getCell(1).font = { size: 8, color: { argb: "FF5A5A5A" } };
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
