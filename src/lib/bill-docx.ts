import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { BillDocument } from "@/lib/bill-document";
import { formatIndianDate } from "@/lib/billing-constants";

// Word version of the standard bill layout (same content as the PDF), so the
// firm can adjust a bill by hand when needed.

function money(amount: number) {
  return `₹ ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

// A4 width minus the 850-twip side margins; column widths must be fixed
// (Word and LibreOffice ignore percentage widths)
const CONTENT_WIDTH = 11906 - 850 * 2;

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };
const LINE = { style: BorderStyle.SINGLE, size: 4, color: "999999" };

function text(value: string, options: { bold?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({ text: value, bold: options.bold, size: options.size ?? 20, color: options.color });
}

function para(
  runs: TextRun[] | string,
  options: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number } = {}
) {
  return new Paragraph({
    children: typeof runs === "string" ? [text(runs)] : runs,
    alignment: options.align,
    spacing: { after: options.after ?? 40, before: options.before ?? 0 },
  });
}

// Each line of a multi-line value (e.g. an address) as its own paragraph
function lines(value: string, options: Parameters<typeof para>[1] = {}) {
  return value.split("\n").map((line) => para(line, options));
}

function widths(percentages: number[]) {
  return percentages.map((pct) => Math.round((CONTENT_WIDTH * pct) / 100));
}

function table(percentages: number[], rows: TableRow[], borders: object) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths(percentages),
    borders,
    rows,
  });
}

function cell(children: Paragraph[], widthPct: number, shaded = false) {
  return new TableCell({
    children,
    width: { size: Math.round((CONTENT_WIDTH * widthPct) / 100), type: WidthType.DXA },
    shading: shaded ? { type: ShadingType.CLEAR, color: "auto", fill: "EEEEEE" } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });
}

function billSection(doc: BillDocument) {
  const { entity } = doc;
  const children: (Paragraph | Table)[] = [];

  if (doc.cancelled) {
    children.push(para([text("CANCELLED", { bold: true, size: 36, color: "DC3C3C" })], { align: AlignmentType.CENTER, after: 120 }));
  }

  // Letterhead
  children.push(para([text(entity.name, { bold: true, size: 36 })], { align: AlignmentType.CENTER, after: 60 }));
  const letterhead = [
    entity.address,
    [entity.phone && `Phone: ${entity.phone}`, entity.email && `Email: ${entity.email}`].filter(Boolean).join("   "),
    [entity.pan && `PAN: ${entity.pan}`, doc.isGst && entity.gstin && `GSTIN: ${entity.gstin}`].filter(Boolean).join("   "),
  ].filter(Boolean) as string[];
  for (const line of letterhead.flatMap((l) => l.split("\n"))) {
    children.push(para([text(line, { size: 18 })], { align: AlignmentType.CENTER, after: 20 }));
  }
  children.push(
    new Paragraph({
      children: [],
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "000000", space: 1 } },
      spacing: { after: 200 },
    })
  );
  children.push(para([text(doc.title, { bold: true, size: 26 })], { align: AlignmentType.CENTER, after: 200 }));

  // Bill to | bill details
  const billTo = [
    para([text("Bill to", { bold: true })]),
    para([text(doc.client.name)]),
    ...(doc.client.contactPerson !== doc.client.name ? [para(`Attn: ${doc.client.contactPerson}`)] : []),
    ...(doc.client.address ? lines(doc.client.address) : []),
    ...(doc.isGst && doc.client.gstin ? [para(`GSTIN: ${doc.client.gstin}`)] : []),
  ];
  const details: [string, string][] = [
    [doc.isGst ? "Invoice no." : "Bill no.", doc.billNumber],
    ["Date", formatIndianDate(doc.billDate)],
    ...(doc.placeOfSupply ? [["Place of supply", doc.placeOfSupply] as [string, string]] : []),
    ...(doc.reissuedFromNumber ? [["Replaces", doc.reissuedFromNumber] as [string, string]] : []),
  ];
  children.push(
    table(
      [58, 42],
      [
        new TableRow({
          children: [
            cell(billTo, 58),
            cell(details.map(([label, value]) => para([text(`${label}: `, { bold: true }), text(value)])), 42),
          ],
        }),
      ],
      NO_BORDERS
    ),
    para("", { after: 200 })
  );

  // Particulars
  const columns = doc.isGst ? [8, 57, 10, 25] : [8, 67, 25];
  const header = [
    cell([para([text("S.No.", { bold: true })])], 8, true),
    cell([para([text("Particulars", { bold: true })])], doc.isGst ? 57 : 67, true),
    ...(doc.isGst ? [cell([para([text("SAC", { bold: true })])], 10, true)] : []),
    cell([para([text("Amount", { bold: true })], { align: AlignmentType.RIGHT })], 25, true),
  ];
  const row = [
    cell([para("1")], 8),
    cell(
      [
        ...doc.description.split("\n").map((line) => para(line)),
        para([text(`Work done on ${formatIndianDate(doc.workDate)}`, { size: 17, color: "6E6E6E" })]),
      ],
      doc.isGst ? 57 : 67
    ),
    ...(doc.isGst ? [cell([para(entity.sacCode || "")], 10)] : []),
    cell([para(money(doc.fee), { align: AlignmentType.RIGHT })], 25),
  ];
  children.push(
    table(
      columns,
      [new TableRow({ children: header, tableHeader: true }), new TableRow({ children: row })],
      { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE }
    ),
    para("", { after: 120 })
  );

  // Totals
  const totals: [string, string, boolean][] = [
    ...(doc.taxLines.length ? [["Professional fee", money(doc.fee), false] as [string, string, boolean]] : []),
    ...doc.taxLines.map((line) => [line.label, money(line.amount), false] as [string, string, boolean]),
    ...(doc.roundOff ? [["Round off", money(doc.roundOff), false] as [string, string, boolean]] : []),
    ["Total", money(doc.total), true],
  ];
  children.push(
    table(
      [75, 25],
      totals.map(
        ([label, value, bold]) =>
          new TableRow({
            children: [
              cell([para([text(label, { bold })], { align: AlignmentType.RIGHT })], 75),
              cell([para([text(value, { bold })], { align: AlignmentType.RIGHT })], 25),
            ],
          })
      ),
      NO_BORDERS
    ),
    para([text("Amount in words: ", { bold: true }), text(doc.totalInWords)], { before: 160, after: 240 })
  );

  // Bank details
  const bank = [
    entity.bankName && `Bank: ${entity.bankName}`,
    entity.bankAccount && `Account no.: ${entity.bankAccount}`,
    entity.bankIfsc && `IFSC: ${entity.bankIfsc}`,
    entity.bankBranch && `Branch: ${entity.bankBranch}`,
  ].filter(Boolean) as string[];
  if (bank.length) {
    children.push(para([text("Bank details", { bold: true })]));
    for (const line of bank) children.push(para(line));
  }

  // Signature
  children.push(
    para([text(`For ${entity.name}`, { bold: true })], { align: AlignmentType.RIGHT, before: 480, after: 600 }),
    ...(entity.signatory ? [para(entity.signatory, { align: AlignmentType.RIGHT })] : []),
    para("Authorised Signatory", { align: AlignmentType.RIGHT })
  );
  if (entity.footerNote) {
    children.push(para([text(entity.footerNote, { size: 17, color: "6E6E6E" })], { align: AlignmentType.CENTER, before: 400 }));
  }

  return {
    properties: { page: { margin: { top: 850, bottom: 850, left: 850, right: 850 } } },
    children,
  };
}

// One Word document containing the given bills, each starting on a new page
export async function renderBillsDocx(docs: BillDocument[]): Promise<Buffer> {
  const document = new Document({
    title: docs.length === 1 ? `Bill ${docs[0].billNumber}` : `${docs.length} bills`,
    styles: { default: { document: { run: { font: "Arial" } } } },
    sections: docs.map(billSection),
  });
  return Packer.toBuffer(document);
}
