import { GState, jsPDF } from "jspdf";
import { BillDocument } from "@/lib/bill-document";
import { BILL_FORMATS, BillFormat, BillImage } from "@/lib/bill-formats";
import * as assets from "@/lib/bill-format-assets";
import { formatIndianDate } from "@/lib/billing-constants";

// The firm's bill formats (see bill-formats.ts), one bill per A4 page. The
// font has no ₹ sign, so amounts are printed under "(Rs.)" headings.

type RGB = [number, number, number];
const BLACK: RGB = [0, 0, 0];
const FONT = "BillSans";

// Page frame and the lines that divide it, in mm
const L = 15;
const R = 195;
const TOP = 15;
const BOTTOM = 282;
const COL1 = 124; // bill to | number
const COL2 = 159; // number | date
const NO_COL = 29; // S. No. | description
const AMT_COL = 165; // description | amount
const Y_HEAD = 68;
const Y_BILLTO = 74;
const Y_NUMCELL = 86;
const Y_TABLE = 128;
const Y_TABLE_HEAD = 134;
const Y_WORDS = 200;
const Y_FOOT = 233;
const BANK_X = 118;
const QR_SIZE = 30;

const amount = (n: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const image = (name: BillImage) => `data:image/png;base64,${assets[name]}`;

// The rows under "Amount in Words": label and value
function totalRows(doc: BillDocument, format: BillFormat): [string, string][] {
  if (format.totalsStyle === "chargesDiscount") {
    return [
      ["Sub Total (Rs.)", amount(doc.fee)],
      ["Other Charges (Rs.)", "-"],
      ["Discount (Rs.)", "-"],
      ["Total (Rs.)", amount(doc.total)],
    ];
  }
  const tax = (prefix: string) => doc.taxLines.find((line) => line.label.startsWith(prefix));
  return [
    ["Sub Total (Rs.)", amount(doc.fee)],
    ...(doc.isGst
      ? (["CGST @ 9%", "SGST @ 9%", "IGST @ 18%"].map((label) => {
          const line = tax(label.slice(0, 4));
          return [label, line ? amount(line.amount) : "-"];
        }) as [string, string][])
      : []),
    ["Round Off", doc.roundOff ? amount(doc.roundOff) : "-"],
    ["Total (Rs.)", amount(doc.total)],
  ];
}

// Draws one bill on the current page of `pdf`
function drawBill(pdf: jsPDF, doc: BillDocument) {
  const format = BILL_FORMATS[doc.type];
  const set = (size: number, color: RGB = format.text, style: "bold" | "normal" = "bold") => {
    pdf.setFont(FONT, style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
  };
  const underline = (text: string, x: number, y: number, color: RGB) => {
    pdf.setDrawColor(...color);
    pdf.line(x, y + 0.8, x + pdf.getTextWidth(text), y + 0.8);
    pdf.setDrawColor(0);
  };

  // Frame and section lines
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  pdf.rect(L, TOP, R - L, BOTTOM - TOP);
  pdf.setLineWidth(0.25);
  for (const y of [Y_HEAD, Y_BILLTO, Y_TABLE, Y_TABLE_HEAD, Y_WORDS, Y_FOOT]) pdf.line(L, y, R, y);
  pdf.line(COL1, Y_HEAD, COL1, Y_NUMCELL);
  pdf.line(COL2, Y_HEAD, COL2, Y_NUMCELL);
  pdf.line(COL1, Y_NUMCELL, R, Y_NUMCELL);
  pdf.line(NO_COL, Y_TABLE, NO_COL, Y_WORDS);
  pdf.line(AMT_COL, Y_TABLE, AMT_COL, Y_WORDS);
  pdf.line(COL1 - 1, Y_WORDS, COL1 - 1, Y_FOOT);
  pdf.line(L, Y_WORDS + 6, COL1 - 1, Y_WORDS + 6);

  // Letterhead: name and details (left), INVOICE and logo (right)
  let y = TOP + 7;
  set(15, format.nameColor);
  pdf.text(format.name, L + 2, y);
  if (format.nameUnderline) underline(format.name, L + 2, y, format.nameColor);
  y += 6.5;
  set(11, format.subtitleColor);
  pdf.text(format.subtitle, L + 2, y);
  y += 6.5;
  set(10);
  for (const line of format.lines) {
    pdf.text(line, L + 2, y);
    y += 5.6;
  }
  pdf.text(format.email, L + 2, y);
  underline(format.email, L + 2, y, format.text);

  const rightMid = (COL1 + R) / 2 + 3;
  set(21, format.titleColor);
  pdf.text("INVOICE", rightMid, TOP + 11, { align: "center" });
  const { logo } = format;
  pdf.addImage(image(logo.image), "PNG", rightMid - logo.width / 2, TOP + 17, logo.width, logo.height, logo.image, "FAST");

  // Bill to (left), number and date (right)
  set(10.5);
  pdf.text("BILL TO", L + 7, Y_HEAD + 4.3);
  pdf.text(format.numberLabel, (COL1 + COL2) / 2, Y_HEAD + 4.3, { align: "center" });
  pdf.text("INVOICE DATE", (COL2 + R) / 2, Y_HEAD + 4.3, { align: "center" });
  set(10, BLACK);
  pdf.text(doc.billNumber, (COL1 + COL2) / 2, Y_BILLTO + 7, { align: "center" });
  pdf.text(formatIndianDate(doc.billDate, "medium"), (COL2 + R) / 2, Y_BILLTO + 7, { align: "center" });

  const valueX = L + 18;
  const valueWidth = COL1 - valueX - 3;
  const field = (label: string, value: string | null, fieldY: number, maxLines: number) => {
    set(9);
    pdf.text(label, L + 2, fieldY);
    if (!value) return;
    set(10, BLACK, "normal");
    const wrapped = value.split("\n").flatMap((part) => pdf.splitTextToSize(part.trim(), valueWidth) as string[]);
    pdf.text(wrapped.slice(0, maxLines), valueX, fieldY);
  };
  const { client } = doc;
  field("Name", client.name, Y_BILLTO + 6, 1);
  field("Add.", client.address, Y_BILLTO + 12, 5);
  field("Contact:", client.contactPerson !== client.name ? client.contactPerson : null, Y_TABLE - 17, 1);
  field("Email:", client.email, Y_TABLE - 11.5, 1);
  field("GST No.:", client.gstin, Y_TABLE - 6, 1);

  // Particulars
  set(10.5);
  pdf.text("S. NO.", L + 1.5, Y_TABLE + 4.3);
  pdf.text("DESCRIPTION", NO_COL + 2, Y_TABLE + 4.3);
  pdf.text("AMOUNT (Rs.)", R - 2, Y_TABLE + 4.3, { align: "right" });
  set(10.5, BLACK, "normal");
  pdf.text("1", (L + NO_COL) / 2, Y_TABLE_HEAD + 8, { align: "center" });
  pdf.text(amount(doc.fee), R - 2, Y_TABLE_HEAD + 8, { align: "right" });
  const description = [
    ...doc.description.split("\n"),
    ...(doc.reissuedFromNumber ? ["", `(Replaces bill no. ${doc.reissuedFromNumber})`] : []),
  ];
  // A long description is printed smaller so that it fits the table
  const descriptionWidth = AMT_COL - NO_COL - 4;
  const room = Y_WORDS - Y_TABLE_HEAD - 10;
  for (const size of [10.5, 9.5, 8.5, 7.5]) {
    set(size, BLACK, "normal");
    const lineHeight = size * 0.45;
    const lines = description.flatMap((part) => (part.trim() ? (pdf.splitTextToSize(part, descriptionWidth) as string[]) : [""]));
    const fits = Math.floor(room / lineHeight) + 1;
    if (lines.length <= fits || size === 7.5) {
      pdf.text(lines.slice(0, fits), NO_COL + 2, Y_TABLE_HEAD + 8, { lineHeightFactor: 1.15 });
      break;
    }
  }

  // Amount in words (left), totals (right)
  set(10.5);
  pdf.text("Amount in Words (Rs.)", L + 2, Y_WORDS + 4.3);
  set(10.5, BLACK);
  pdf.text(pdf.splitTextToSize(doc.totalInWords, COL1 - L - 6) as string[], L + 2, Y_WORDS + 13);
  let ty = Y_WORDS + 5;
  for (const [label, value] of totalRows(doc, format)) {
    set(10.5);
    pdf.text(label, AMT_COL + 5, ty, { align: "right" });
    set(10.5, BLACK);
    pdf.text(value, R - 2, ty, { align: "right" });
    ty += 5;
  }

  // Signature (left), UPI QR code (middle), bank details (right)
  set(10.5);
  if (format.forLine) pdf.text(format.forLine, L + 2, Y_FOOT + 8);
  pdf.text(format.signLines, L + 2, BOTTOM - 4 - (format.signLines.length - 1) * 5);

  const qrX = BANK_X - QR_SIZE - 6;
  set(9);
  pdf.text("Scan & Pay", qrX + QR_SIZE / 2, Y_FOOT + 6, { align: "center" });
  pdf.addImage(image(format.qr.image), "PNG", qrX, Y_FOOT + 7.5, QR_SIZE, QR_SIZE, format.qr.image, "FAST");
  set(8.5, BLACK, "normal");
  pdf.text(`UPI: ${format.qr.upiId}`, qrX + QR_SIZE / 2, Y_FOOT + QR_SIZE + 11, { align: "center" });

  let by = Y_FOOT + 8;
  set(10.5);
  pdf.text("Bank A/c Details", BANK_X, by);
  by += 5.6;
  const rows = (items: [string, string][], size: number, gap: number) => {
    set(size);
    const labelWidth = Math.max(...items.map(([label]) => pdf.getTextWidth(label))) + gap;
    for (const [label, value] of items) {
      set(size);
      pdf.text(label, BANK_X, by);
      set(size, BLACK);
      pdf.text(value, BANK_X + labelWidth, by);
      by += 5;
    }
  };
  rows(format.bank, 10.5, 3);
  if (format.pay.length) {
    by += 2;
    rows(format.pay, 10, 2.5);
  }

  if (doc.cancelled) {
    // Faint diagonal stamp across the middle of the page; the bill stays readable
    const angle = 35;
    const radians = (angle * Math.PI) / 180;
    pdf.setFont(FONT, "bold");
    pdf.setFontSize(80);
    const halfWidth = pdf.getTextWidth("CANCELLED") / 2;
    pdf.saveGraphicsState();
    pdf.setGState(new GState({ opacity: 0.18 }));
    pdf.setTextColor(220, 40, 40);
    pdf.text("CANCELLED", 105 - halfWidth * Math.cos(radians), 150 + halfWidth * Math.sin(radians), { angle });
    pdf.restoreGraphicsState();
    pdf.setTextColor(0);
  }
}

// One PDF containing the given bills, one bill per page
export function renderBillsPdf(docs: BillDocument[]): Buffer {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.addFileToVFS("BillSans-Bold.ttf", assets.fontBold);
  pdf.addFont("BillSans-Bold.ttf", FONT, "bold");
  pdf.addFileToVFS("BillSans-Regular.ttf", assets.fontRegular);
  pdf.addFont("BillSans-Regular.ttf", FONT, "normal");
  docs.forEach((doc, index) => {
    if (index > 0) pdf.addPage();
    drawBill(pdf, doc);
  });
  pdf.setProperties({ title: docs.length === 1 ? `Bill ${docs[0].billNumber}` : `${docs.length} bills` });
  return Buffer.from(pdf.output("arraybuffer"));
}
