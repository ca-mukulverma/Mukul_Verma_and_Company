import type { BillDocument } from "@/lib/bill-document";
import { BillTypeValue } from "@/lib/billing-constants";

// The firm's bill formats, one per bill type, as approved by the firm: the
// letterhead, bank details, UPI QR code and signature printed on the PDF.
// The logos, QR codes and font are in assets/bills (see its README).

export type BillImage = "caLogo" | "advocateLogo" | "bedgeLogo" | "qrGst" | "qrNonGst" | "qrNonGstHv" | "qrNonGstVla" | "qrBedge";
type RGB = [number, number, number];

export interface BillFormat {
  name: string;
  nameColor: RGB;
  nameUnderline: boolean;
  subtitle: string;
  subtitleColor: RGB;
  // Address, PAN/GSTIN and phone lines under the subtitle
  lines: string[];
  email: string;
  // Colour of the labels and letterhead text
  text: RGB;
  titleColor: RGB;
  logo: { image: BillImage; width: number; height: number };
  numberLabel: string;
  // B Edge shows Other Charges and Discount rows; the others a Round Off row
  totalsStyle: "roundOff" | "chargesDiscount";
  forLine: string | null;
  signLines: string[];
  bank: [string, string][];
  // UPI / GPay / PhonePe lines under the bank details
  pay: [string, string][];
  qr: { image: BillImage; upiId: string };
}

// MVC & Company is registered in Madhya Pradesh: GST on its bills is CGST +
// SGST for clients in the state, IGST for clients registered elsewhere
export const MVC_GST_STATE_CODE = "23";

const BLACK: RGB = [0, 0, 0];
const NAVY: RGB = [31, 56, 100];
const ADDRESS = ["Flat No. 101, Plot No. 141 Siddharth Homes, Zone 2,", "MP Nagar Bhopal, M.P. - 462011"];
const CA = {
  nameColor: BLACK,
  nameUnderline: false,
  subtitle: "Chartered Accountant",
  subtitleColor: BLACK,
  text: BLACK,
  titleColor: NAVY,
  logo: { image: "caLogo" as BillImage, width: 28, height: 27 },
  numberLabel: "Document No.",
  totalsStyle: "roundOff" as const,
};

export const BILL_FORMATS: Record<BillTypeValue, BillFormat> = {
  GST: {
    ...CA,
    name: "M V C & COMPANY",
    lines: [...ADDRESS, "PAN : ABSFM5069N", "GSTIN : 23ABSFM5069N1ZI", "+91-9165544594, +91-7000774130"],
    email: "camukulverma@gmail.com",
    forLine: "For M/s M V C & Company",
    signLines: ["CA Mukul Verma", "Partner"],
    bank: [
      ["A/c Name.:", "Mukul Verma & Co."],
      ["A/c No.:", "44402937256"],
      ["IFSC:", "SBIN0007242"],
    ],
    pay: [],
    qr: { image: "qrGst", upiId: "44402937256@sbi" },
  },
  NON_GST: {
    ...CA,
    name: "CA MUKUL VERMA",
    lines: [...ADDRESS, "+91-9165544594"],
    email: "camukulverma@gmail.com",
    forLine: null,
    signLines: ["CA Mukul Verma", "Chartered Accountant"],
    bank: [
      ["Bank:", "HDFC Bank"],
      ["A/c Name:", "Mukul Verma & Co."],
      ["A/c No.:", "50200049069462"],
      ["IFSC:", "HDFC0001768"],
    ],
    pay: [
      ["UPI:", "camukulverma@okhdfcbank"],
      ["Gpay Number:", "+91-9165544594"],
      ["Phone pe Number:", "+91-9165544594"],
    ],
    qr: { image: "qrNonGst", upiId: "9165544594@hdfc" },
  },
  NON_GST_HV: {
    ...CA,
    name: "CA HARSH VERMA",
    lines: [...ADDRESS, "+91-7000774130"],
    email: "caharshverma17@gmail.com",
    forLine: null,
    signLines: ["CA Harsh Verma", "Chartered Accountant"],
    bank: [
      ["Account Name:", "Harsh Verma"],
      ["Account No.:", "2602 2484 1290 8029"],
      ["IFSC Code:", "AUBL0002484"],
      ["Branch:", "Hamidiya Road, Bhopal"],
    ],
    pay: [],
    qr: { image: "qrNonGstHv", upiId: "7000774130@ybl" },
  },
  NON_GST_VLA: {
    ...CA,
    name: "VERMA LAW ASSOCIATES",
    subtitle: "Advocates",
    lines: [...ADDRESS, "+91-8962197740"],
    email: "vermayash170598@gmail.com",
    logo: { image: "advocateLogo", width: 26, height: 26 },
    forLine: "For Verma Law Associates",
    signLines: ["Authorised Signatory"],
    bank: [
      ["A/c Name:", "Verma Law Associates"],
      ["A/c No.:", "44404382030"],
      ["IFSC:", "SBIN0064470"],
    ],
    pay: [],
    qr: { image: "qrNonGstVla", upiId: "8962197740@sbi" },
  },
  BEDGE: {
    name: "B-EDGE BUSINESS CONSULTANTS LLP",
    nameColor: [31, 92, 140],
    nameUnderline: true,
    subtitle: '"One Stop Solution for all Business Needs"',
    subtitleColor: [31, 92, 140],
    lines: ["Flat No 101, Plot No 141 Siddharth Homes", "M P Nagar Zone 2", "Bhopal, M.P. - 462011", "+91-9981212097"],
    email: "bedgebusinessconsultants@gmail.com",
    text: [89, 89, 89],
    titleColor: [89, 89, 89],
    logo: { image: "bedgeLogo", width: 62, height: 22.4 },
    numberLabel: "INVOICE NO.",
    totalsStyle: "chargesDiscount",
    forLine: "For B-Edge Business Consultants LLP",
    signLines: ["Partner"],
    bank: [
      ["Bank Name:", "State Bank of India"],
      ["A/c No.:", "43471559687"],
      ["IFSC:", "SBIN0064470"],
      ["UPI:", "43471559687@sbi"],
    ],
    pay: [],
    qr: { image: "qrBedge", upiId: "43471559687@sbi" },
  },
};

// Amounts as printed under the "(Rs.)" headings, e.g. "2,360.00"
export const formatAmount = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// The rows beside "Amount in Words": label and value, the same on the PDF and the Word file
export function billTotalRows(doc: BillDocument): [string, string][] {
  if (BILL_FORMATS[doc.type].totalsStyle === "chargesDiscount") {
    return [
      ["Sub Total (Rs.)", formatAmount(doc.fee)],
      ["Other Charges (Rs.)", "-"],
      ["Discount (Rs.)", "-"],
      ["Total (Rs.)", formatAmount(doc.total)],
    ];
  }
  const tax = (prefix: string) => doc.taxLines.find((line) => line.label.startsWith(prefix));
  return [
    ["Sub Total (Rs.)", formatAmount(doc.fee)],
    // GST bills show all three; the ones not charged as "-"
    ...(doc.isGst
      ? ["CGST @ 9%", "SGST @ 9%", "IGST @ 18%"].map((label): [string, string] => {
          const line = tax(label.slice(0, 4));
          return [label, line ? formatAmount(line.amount) : "-"];
        })
      : []),
    ["Round Off", doc.roundOff ? formatAmount(doc.roundOff) : "-"],
    ["Total (Rs.)", formatAmount(doc.total)],
  ];
}
