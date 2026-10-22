import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} from "docx";
import { BillDocument } from "@/lib/bill-document";
import { BILL_FORMATS, BillFormat, BillImage, billTotalRows, formatAmount } from "@/lib/bill-formats";
import * as assets from "@/lib/bill-format-assets";
import { formatIndianDate } from "@/lib/billing-constants";

// Word version of the firm's bill formats (the same layout as the PDF), so a
// bill can be adjusted by hand when needed. One framed table per bill: the
// letterhead, bill to, particulars, totals and footer rows.

type RGB = [number, number, number];

// A4 width minus 15 mm side margins (850 twips); column widths must be fixed
// (Word and LibreOffice ignore percentage widths)
const MARGIN = 850;
const CONTENT_WIDTH = 11906 - MARGIN * 2;
const MM = 56.7; // twips per mm

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const THIN = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const THICK = { style: BorderStyle.SINGLE, size: 12, color: "000000" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const NO_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 };
const PADDING = { top: 50, bottom: 50, left: 90, right: 90 };

const hex = (rgb: RGB) => rgb.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
const BLACK = "000000";

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

function run(value: string, options: { size?: number; color?: string; bold?: boolean; underline?: boolean } = {}) {
  return new TextRun({
    text: value,
    bold: options.bold ?? true,
    size: Math.round((options.size ?? 10.5) * 2),
    color: options.color ?? BLACK,
    underline: options.underline ? { type: UnderlineType.SINGLE } : undefined,
  });
}

function para(children: (TextRun | ImageRun)[], options: { align?: Align; before?: number; after?: number; bottomBorder?: boolean } = {}) {
  return new Paragraph({
    children,
    alignment: options.align,
    spacing: { before: options.before ?? 0, after: options.after ?? 0 },
    border: options.bottomBorder ? { bottom: { ...THIN, space: 2 } } : undefined,
  });
}

function picture(name: BillImage, widthMm: number, heightMm: number) {
  // ImageRun sizes are in pixels at 96 dpi
  return new ImageRun({
    type: "png",
    data: Buffer.from(assets[name], "base64"),
    transformation: { width: Math.round((widthMm * 96) / 25.4), height: Math.round((heightMm * 96) / 25.4) },
  });
}

function cell(children: (Paragraph | Table)[], width: number, options: { borders?: object; margins?: object } = {}) {
  return new TableCell({
    children,
    width: { size: width, type: WidthType.DXA },
    borders: options.borders,
    margins: options.margins ?? PADDING,
  });
}

// Column widths in twips from fractions of `total` (the last one takes the rest)
function columns(total: number, fractions: number[]) {
  const widths = fractions.slice(0, -1).map((f) => Math.round(total * f));
  return [...widths, total - widths.reduce((a, b) => a + b, 0)];
}

function table(widths: number[], rows: TableRow[], borders: object = NO_BORDERS) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders,
    rows,
  });
}

// Label / value lines without borders, e.g. the bank details
function pairs(items: [string, string][], width: number, labelFraction: number, labelColor: string, size = 10.5, valueBold = true) {
  const widths = columns(width, [labelFraction, 1 - labelFraction]);
  return table(
    widths,
    items.map(
      ([label, value]) =>
        new TableRow({
          children: [
            cell([para([run(label, { color: labelColor, size })])], widths[0], { margins: NO_MARGINS }),
            cell([para([run(value, { size, bold: valueBold })])], widths[1], { margins: NO_MARGINS }),
          ],
        })
    )
  );
}

function letterhead(format: BillFormat, width: number) {
  const widths = columns(width, [0.6, 0.4]);
  const text = hex(format.text);
  const left = [
    para([run(format.name, { size: 15, color: hex(format.nameColor), underline: format.nameUnderline })], { after: 40 }),
    para([run(format.subtitle, { size: 11, color: hex(format.subtitleColor) })], { after: 60 }),
    ...format.lines.map((line) => para([run(line, { size: 10, color: text })], { after: 30 })),
    para([run(format.email, { size: 10, color: text, underline: true })]),
  ];
  const right = [
    para([run("INVOICE", { size: 21, color: hex(format.titleColor) })], { align: AlignmentType.CENTER, after: 80 }),
    para([picture(format.logo.image, format.logo.width, format.logo.height)], { align: AlignmentType.CENTER }),
  ];
  return table(widths, [new TableRow({ children: [cell(left, widths[0]), cell(right, widths[1])] })]);
}

function billTo(doc: BillDocument, format: BillFormat, width: number) {
  const widths = columns(width, [109 / 180, 35 / 180, 36 / 180]);
  const text = hex(format.text);
  const { client } = doc;
  const field = (label: string, value: string | null) =>
    [label, value ?? ""] as [string, string];
  const top = [field("Name", client.name), field("Add.", client.address)];
  const bottom = [
    field("Contact:", client.contactPerson !== client.name ? client.contactPerson : null),
    field("Email:", client.email),
    field("GST No.:", client.gstin),
  ];
  const fieldRows = (items: [string, string][]) =>
    items.flatMap(([label, value]) => {
      const valueLines = value.split("\n");
      return valueLines.map((line, index) => [index === 0 ? label : "", line.trim()] as [string, string]);
    });
  const details = [
    pairs(fieldRows(top), widths[0] - 180, 0.15, text, 10, false),
    para([run("")], { before: 300 }),
    pairs(fieldRows(bottom), widths[0] - 180, 0.15, text, 10, false),
  ];
  const head = (label: string, w: number) => cell([para([run(label, { color: text })], { align: AlignmentType.CENTER })], w);
  const value = (label: string, w: number) =>
    cell([para([run(label, { size: 10 })], { align: AlignmentType.CENTER })], w, {
      borders: { bottom: THIN, left: THIN, right: NONE, top: NONE },
    });
  return table(
    widths,
    [
      new TableRow({
        children: [cell([para([run("BILL TO", { color: text })], { before: 0 })], widths[0]), head(format.numberLabel, widths[1]), head("INVOICE DATE", widths[2])],
      }),
      new TableRow({
        children: [
          cell(details, widths[0]),
          value(doc.billNumber, widths[1]),
          value(formatIndianDate(doc.billDate, "medium"), widths[2]),
        ],
      }),
    ],
    { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: THIN, insideVertical: THIN }
  );
}

function particulars(doc: BillDocument, format: BillFormat, width: number) {
  const widths = columns(width, [14 / 180, 136 / 180, 30 / 180]);
  const text = hex(format.text);
  const description = [
    ...doc.description.split("\n"),
    ...(doc.reissuedFromNumber ? ["", `(Replaces bill no. ${doc.reissuedFromNumber})`] : []),
  ];
  return table(
    widths,
    [
      new TableRow({
        children: [
          cell([para([run("S. NO.", { color: text })])], widths[0]),
          cell([para([run("DESCRIPTION", { color: text })])], widths[1]),
          cell([para([run("AMOUNT (Rs.)", { color: text })], { align: AlignmentType.RIGHT })], widths[2]),
        ],
      }),
      new TableRow({
        height: { value: Math.round(66 * MM), rule: HeightRule.ATLEAST },
        children: [
          cell([para([run("1", { bold: false })], { align: AlignmentType.CENTER, before: 80 })], widths[0]),
          cell(description.map((line, index) => para([run(line, { bold: false })], { before: index === 0 ? 80 : 0 })), widths[1]),
          cell([para([run(formatAmount(doc.fee), { bold: false })], { align: AlignmentType.RIGHT, before: 80 })], widths[2]),
        ],
      }),
    ],
    { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: THIN, insideVertical: THIN }
  );
}

function totals(doc: BillDocument, format: BillFormat, width: number) {
  const widths = columns(width, [108 / 180, 72 / 180]);
  const text = hex(format.text);
  const rowsWidth = widths[1] - 180;
  const rowWidths = columns(rowsWidth, [0.62, 0.38]);
  const rows = table(
    rowWidths,
    billTotalRows(doc).map(
      ([label, value]) =>
        new TableRow({
          children: [
            cell([para([run(label, { color: text })], { align: AlignmentType.RIGHT })], rowWidths[0], { margins: NO_MARGINS }),
            cell([para([run(value)], { align: AlignmentType.RIGHT })], rowWidths[1], { margins: NO_MARGINS }),
          ],
        })
    )
  );
  return table(
    widths,
    [
      new TableRow({
        children: [
          cell(
            [
              para([run("Amount in Words (Rs.)", { color: text })], { bottomBorder: true, after: 160 }),
              para([run(doc.totalInWords)]),
            ],
            widths[0]
          ),
          cell([rows], widths[1]),
        ],
      }),
    ],
    { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: THIN }
  );
}

function footer(format: BillFormat, width: number) {
  const widths = columns(width, [64 / 180, 36 / 180, 80 / 180]);
  const text = hex(format.text);
  const signature = [
    para([run(format.forLine ?? "", { color: text })], { after: 0 }),
    para([run("")], { before: (7 - format.signLines.length) * 280 }),
    ...format.signLines.map((line) => para([run(line, { color: text })])),
  ];
  const qr = [
    para([run("Scan & Pay", { size: 9, color: text })], { align: AlignmentType.CENTER, after: 40 }),
    para([picture(format.qr.image, 30, 30)], { align: AlignmentType.CENTER, after: 40 }),
    para([run(`UPI: ${format.qr.upiId}`, { size: 8.5, bold: false })], { align: AlignmentType.CENTER }),
  ];
  const bankWidth = widths[2] - 180;
  const bank = [
    para([run("Bank A/c Details", { color: text })], { after: 60 }),
    pairs(format.bank, bankWidth, 0.34, text),
    ...(format.pay.length ? [para([run("")], { after: 60 }), pairs(format.pay, bankWidth, 0.38, text, 10)] : []),
  ];
  return table(widths, [
    new TableRow({ children: [cell(signature, widths[0]), cell(qr, widths[1]), cell(bank, widths[2])] }),
  ]);
}

function billSection(doc: BillDocument) {
  const format = BILL_FORMATS[doc.type];
  const inner = CONTENT_WIDTH;
  const row = (content: Table) =>
    new TableRow({ children: [cell([content], inner, { margins: NO_MARGINS })] });
  const frame = table(
    [inner],
    [
      row(letterhead(format, inner)),
      row(billTo(doc, format, inner)),
      row(particulars(doc, format, inner)),
      row(totals(doc, format, inner)),
      row(footer(format, inner)),
    ],
    { top: THICK, bottom: THICK, left: THICK, right: THICK, insideHorizontal: THIN, insideVertical: NONE }
  );

  return {
    properties: { page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    children: [
      ...(doc.cancelled
        ? [para([run("CANCELLED", { size: 18, color: "DC3C3C" })], { align: AlignmentType.CENTER, after: 120 })]
        : []),
      frame,
    ],
  };
}

// One Word document containing the given bills, each starting on a new page
export async function renderBillsDocx(docs: BillDocument[]): Promise<Buffer> {
  const document = new Document({
    title: docs.length === 1 ? `Bill ${docs[0].billNumber}` : `${docs.length} bills`,
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: docs.map(billSection),
  });
  return Packer.toBuffer(document);
}
