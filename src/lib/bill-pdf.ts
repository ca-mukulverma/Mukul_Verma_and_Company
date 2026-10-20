import { GState, jsPDF } from "jspdf";
import { BillDocument } from "@/lib/bill-document";
import { formatIndianDate } from "@/lib/billing-constants";

// Standard A4 bill layout, used until the firm's own formats are supplied.
// The built-in PDF fonts have no ₹ sign, so amounts are printed as "Rs.".

const PAGE_WIDTH = 210;
const MARGIN = 15;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export function money(amount: number) {
  return `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

// Draws one bill on the current page of `pdf`
function drawBill(pdf: jsPDF, doc: BillDocument) {
  let y = MARGIN + 4;
  const { entity } = doc;

  // Letterhead
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(entity.name, PAGE_WIDTH / 2, y, { align: "center" });
  y += 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  const letterhead = [
    entity.address,
    [entity.phone && `Phone: ${entity.phone}`, entity.email && `Email: ${entity.email}`].filter(Boolean).join("   "),
    [entity.pan && `PAN: ${entity.pan}`, doc.isGst && entity.gstin && `GSTIN: ${entity.gstin}`].filter(Boolean).join("   "),
  ].filter(Boolean) as string[];
  for (const line of letterhead) {
    for (const wrapped of pdf.splitTextToSize(line, CONTENT_WIDTH) as string[]) {
      pdf.text(wrapped, PAGE_WIDTH / 2, y, { align: "center" });
      y += 4.2;
    }
  }
  y += 2;
  pdf.setLineWidth(0.6);
  pdf.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 8;

  // Title
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(doc.title, PAGE_WIDTH / 2, y, { align: "center" });
  y += 8;

  // Bill details (right) and bill-to (left)
  const top = y;
  pdf.setFontSize(10);
  pdf.text("Bill to", MARGIN, y);
  pdf.setFont("helvetica", "normal");
  y += 5;
  const billTo = [
    doc.client.name,
    doc.client.contactPerson !== doc.client.name ? `Attn: ${doc.client.contactPerson}` : null,
    doc.client.address,
    doc.isGst && doc.client.gstin ? `GSTIN: ${doc.client.gstin}` : null,
  ].filter(Boolean) as string[];
  for (const line of billTo) {
    for (const wrapped of pdf.splitTextToSize(line, CONTENT_WIDTH * 0.55) as string[]) {
      pdf.text(wrapped, MARGIN, y);
      y += 4.6;
    }
  }

  const rightX = MARGIN + CONTENT_WIDTH * 0.62;
  let ry = top;
  const details: [string, string][] = [
    [doc.isGst ? "Invoice no." : "Bill no.", doc.billNumber],
    ["Date", formatIndianDate(doc.billDate)],
    ...(doc.placeOfSupply ? [["Place of supply", doc.placeOfSupply] as [string, string]] : []),
    ...(doc.reissuedFromNumber ? [["Replaces", doc.reissuedFromNumber] as [string, string]] : []),
  ];
  for (const [label, value] of details) {
    pdf.setFont("helvetica", "bold");
    pdf.text(label, rightX, ry);
    pdf.setFont("helvetica", "normal");
    pdf.text(pdf.splitTextToSize(value, CONTENT_WIDTH * 0.38 - 28) as string[], rightX + 28, ry);
    ry += 5;
  }
  y = Math.max(y, ry) + 6;

  // Particulars table
  const amountX = PAGE_WIDTH - MARGIN - 2;
  const sacX = MARGIN + CONTENT_WIDTH - 62;
  pdf.setFillColor(238, 238, 238);
  pdf.rect(MARGIN, y - 5, CONTENT_WIDTH, 8, "F");
  pdf.setFont("helvetica", "bold");
  pdf.text("S.No.", MARGIN + 2, y);
  pdf.text("Particulars", MARGIN + 16, y);
  if (doc.isGst) pdf.text("SAC", sacX, y);
  pdf.text("Amount", amountX, y, { align: "right" });
  y += 8;

  pdf.setFont("helvetica", "normal");
  pdf.text("1", MARGIN + 2, y);
  const particularsWidth = (doc.isGst ? sacX : amountX - 40) - (MARGIN + 16) - 4;
  const particulars = pdf.splitTextToSize(doc.description, particularsWidth) as string[];
  pdf.text(particulars, MARGIN + 16, y);
  if (doc.isGst && doc.entity.sacCode) pdf.text(doc.entity.sacCode, sacX, y);
  pdf.text(money(doc.fee), amountX, y, { align: "right" });
  y += particulars.length * 4.6;
  pdf.setFontSize(8.5);
  pdf.setTextColor(110);
  pdf.text(`Work done on ${formatIndianDate(doc.workDate)}`, MARGIN + 16, y);
  pdf.setTextColor(0);
  pdf.setFontSize(10);
  y += 6;
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 6;

  // Totals
  const labelX = amountX - 45;
  const totalRows: [string, number][] = [
    ...(doc.taxLines.length ? [["Professional fee", doc.fee] as [string, number]] : []),
    ...doc.taxLines.map((line) => [line.label, line.amount] as [string, number]),
  ];
  for (const [label, amount] of totalRows) {
    pdf.text(label, labelX, y, { align: "right" });
    pdf.text(money(amount), amountX, y, { align: "right" });
    y += 5.5;
  }
  pdf.setFont("helvetica", "bold");
  pdf.text("Total", labelX, y, { align: "right" });
  pdf.text(money(doc.total), amountX, y, { align: "right" });
  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.text(pdf.splitTextToSize(`Amount in words: ${doc.totalInWords}`, CONTENT_WIDTH) as string[], MARGIN, y);
  y += 12;

  // Bank details
  const bank = [
    doc.entity.bankName && `Bank: ${doc.entity.bankName}`,
    doc.entity.bankAccount && `Account no.: ${doc.entity.bankAccount}`,
    doc.entity.bankIfsc && `IFSC: ${doc.entity.bankIfsc}`,
    doc.entity.bankBranch && `Branch: ${doc.entity.bankBranch}`,
  ].filter(Boolean) as string[];
  if (bank.length) {
    pdf.setFont("helvetica", "bold");
    pdf.text("Bank details", MARGIN, y);
    pdf.setFont("helvetica", "normal");
    y += 5;
    for (const line of bank) {
      pdf.text(line, MARGIN, y);
      y += 4.6;
    }
  }

  // Signature block, bottom right
  const signY = Math.max(y + 8, 235);
  pdf.setFont("helvetica", "bold");
  pdf.text(`For ${doc.entity.name}`, amountX, signY, { align: "right" });
  pdf.setFont("helvetica", "normal");
  if (doc.entity.signatory) pdf.text(doc.entity.signatory, amountX, signY + 18, { align: "right" });
  pdf.text("Authorised Signatory", amountX, signY + 23, { align: "right" });

  if (doc.entity.footerNote) {
    pdf.setFontSize(8.5);
    pdf.setTextColor(110);
    pdf.text(pdf.splitTextToSize(doc.entity.footerNote, CONTENT_WIDTH) as string[], PAGE_WIDTH / 2, 282, { align: "center" });
    pdf.setTextColor(0);
  }

  if (doc.cancelled) {
    // Faint diagonal stamp across the middle of the page; the bill stays readable
    const angle = 35;
    const radians = (angle * Math.PI) / 180;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(80);
    const halfWidth = pdf.getTextWidth("CANCELLED") / 2;
    pdf.saveGraphicsState();
    pdf.setGState(new GState({ opacity: 0.18 }));
    pdf.setTextColor(220, 40, 40);
    pdf.text("CANCELLED", PAGE_WIDTH / 2 - halfWidth * Math.cos(radians), 150 + halfWidth * Math.sin(radians), { angle });
    pdf.restoreGraphicsState();
    pdf.setTextColor(0);
  }
}

// One PDF containing the given bills, one bill per page
export function renderBillsPdf(docs: BillDocument[]): Buffer {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  docs.forEach((doc, index) => {
    if (index > 0) pdf.addPage();
    drawBill(pdf, doc);
  });
  pdf.setProperties({ title: docs.length === 1 ? `Bill ${docs[0].billNumber}` : `${docs.length} bills` });
  return Buffer.from(pdf.output("arraybuffer"));
}
