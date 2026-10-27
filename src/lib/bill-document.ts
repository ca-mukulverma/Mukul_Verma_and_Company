import { BillType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BillingAccess } from "@/lib/billing";
import { GST_RATE_PERCENT } from "@/lib/billing-constants";
import { BILL_FORMATS, MVC_GST_STATE_CODE } from "@/lib/bill-formats";
import { billShowsGstin } from "@/lib/connectors";

// Everything printed on one bill (PDF or Word). Built only for bills in a
// Billing List the user may see, so amounts never reach anyone else.
export interface BillDocument {
  id: string;
  type: BillType;
  isGst: boolean;
  title: string;
  billNumber: string;
  billDate: Date;
  cancelled: boolean;
  description: string;
  workDate: Date;
  fee: number;
  taxLines: { label: string; amount: number }[];
  // Added to reach the total in whole rupees (bills with a Round Off row)
  roundOff: number;
  total: number;
  totalInWords: string;
  placeOfSupply: string | null;
  client: { name: string; contactPerson: string; address: string | null; gstin: string | null; email: string | null };
  entity: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    pan: string | null;
    gstin: string | null;
    sacCode: string | null;
    bankName: string | null;
    bankAccount: string | null;
    bankIfsc: string | null;
    bankBranch: string | null;
    signatory: string | null;
    footerNote: string | null;
  };
  reissuedFromNumber: string | null;
}

export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// GST lines for a GST bill. Within the firm's state (or for a client without
// a GSTIN) it is CGST + SGST; for a client registered in another state, IGST.
// Until Admin enters the firm's state code, a single GST line is shown.
export function gstLines(fee: number, supplierState: string | null, clientGstin: string | null) {
  const clientState = clientGstin && /^\d{2}/.test(clientGstin) ? clientGstin.slice(0, 2) : null;
  const half = GST_RATE_PERCENT / 2;

  if (!supplierState) {
    return {
      placeOfSupply: clientState ? GST_STATES[clientState] ?? clientState : null,
      lines: [{ label: `GST @ ${GST_RATE_PERCENT}%`, amount: round2((fee * GST_RATE_PERCENT) / 100) }],
    };
  }
  const placeState = clientState ?? supplierState;
  const placeOfSupply = `${GST_STATES[placeState] ?? "State"} (${placeState})`;
  if (placeState !== supplierState) {
    return { placeOfSupply, lines: [{ label: `IGST @ ${GST_RATE_PERCENT}%`, amount: round2((fee * GST_RATE_PERCENT) / 100) }] };
  }
  const each = round2((fee * half) / 100);
  return {
    placeOfSupply,
    lines: [
      { label: `CGST @ ${half}%`, amount: each },
      { label: `SGST @ ${half}%`, amount: each },
    ],
  };
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

// Indian numbering: crore, lakh, thousand
function integerInWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${integerInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

// e.g. 23600.5 → "Rupees Twenty Three Thousand Six Hundred and Fifty Paise Only"
export function rupeesInWords(amount: number) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  return `Rupees ${integerInWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}

// GST, round off and total of a bill: the same on the PDF, the Word file and
// the Tally voucher. GST bills charge CGST + SGST or IGST from MVC's state
// (Madhya Pradesh unless Company profiles has another); all bills but B Edge
// round the total to whole rupees.
export function billTotals(type: BillType, fee: number, stateCode: string | null, clientGstin: string | null) {
  const tax = type === "GST" ? gstLines(fee, stateCode || MVC_GST_STATE_CODE, clientGstin) : null;
  const exact = round2(fee + (tax?.lines.reduce((sum, line) => sum + line.amount, 0) ?? 0));
  const total = BILL_FORMATS[type].totalsStyle === "roundOff" ? Math.round(exact) : exact;
  return { taxLines: tax?.lines ?? [], placeOfSupply: tax?.placeOfSupply ?? null, roundOff: round2(total - exact), total };
}

const documentInclude = {
  client: { select: { contactPerson: true, companyName: true, address: true, gstin: true, email: true, connectorId: true } },
  reissuedFrom: { select: { billNumber: true } },
} satisfies Prisma.BillInclude;

// Loads the printable data for the given bills, in the order asked for.
// Bills outside the user's Billing List, or that have no number yet, are left out.
export async function loadBillDocuments(ids: string[], access: BillingAccess): Promise<BillDocument[]> {
  const [bills, entities] = await Promise.all([
    prisma.bill.findMany({
      where: { id: { in: ids }, status: { in: ["approved", "cancelled"] }, billNumber: { not: null } },
      include: documentInclude,
    }),
    prisma.billingEntity.findMany(),
  ]);

  return ids.flatMap((id) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !bill.type || !bill.billNumber || !bill.billDate || !access.listCompanies.includes(bill.company)) return [];
    const entity = entities.find((e) => e.type === bill.type);
    const fee = bill.amount !== null ? Number(bill.amount) : 0;
    const isGst = bill.type === "GST";
    // A saved client, or the name entered under "Other"
    const party = bill.client
      ? {
          name: bill.client.companyName || bill.client.contactPerson,
          contactPerson: bill.client.contactPerson,
          address: bill.client.address || null,
          gstin: bill.client.gstin || null,
          email: bill.client.email?.trim() || null,
        }
      : { name: bill.billToName || "", contactPerson: bill.billToName || "", address: bill.billToAddress, gstin: bill.billToGstin, email: null };
    // Place of supply and CGST + SGST / IGST follow the client's GSTIN even when
    // it isn't printed (a connector's client, billed as B2C)
    const { taxLines, placeOfSupply, roundOff, total } = billTotals(bill.type, fee, entity?.stateCode || null, party.gstin);
    if (bill.client && !billShowsGstin(bill, bill.client.connectorId)) party.gstin = null;

    return [
      {
        id: bill.id,
        type: bill.type,
        isGst,
        title: isGst ? "TAX INVOICE" : "BILL",
        billNumber: bill.billNumber,
        billDate: bill.billDate,
        cancelled: bill.status === "cancelled",
        description: bill.description,
        workDate: bill.workDate,
        fee,
        taxLines,
        roundOff,
        total,
        totalInWords: rupeesInWords(total),
        placeOfSupply,
        client: party,
        entity: {
          name: entity?.name || "",
          address: entity?.address || null,
          phone: entity?.phone || null,
          email: entity?.email || null,
          pan: entity?.pan || null,
          gstin: entity?.gstin || null,
          sacCode: entity?.sacCode || null,
          bankName: entity?.bankName || null,
          bankAccount: entity?.bankAccount || null,
          bankIfsc: entity?.bankIfsc || null,
          bankBranch: entity?.bankBranch || null,
          signatory: entity?.signatory || null,
          footerNote: entity?.footerNote || null,
        },
        reissuedFromNumber: bill.reissuedFrom?.billNumber ?? null,
      },
    ];
  });
}

// "26-27/0218" → "Bill-26-27-0218"; safe as a file name
export function billFileName(doc: Pick<BillDocument, "billNumber" | "cancelled">, extension: string) {
  return `Bill-${doc.billNumber.replace(/[^A-Za-z0-9-]+/g, "-")}${doc.cancelled ? "-CANCELLED" : ""}.${extension}`;
}
