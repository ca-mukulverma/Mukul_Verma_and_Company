// Billing labels and number formats shared by the server and the browser.
// Keep this file free of server-only imports (Prisma, etc.).

export type CompanyValue = "MVC" | "BEDGE";
export type BillTypeValue = "GST" | "NON_GST" | "NON_GST_HV" | "NON_GST_VLA" | "BEDGE";
export type BillStatusValue =
  | "draft"
  | "awaiting_amount"
  | "amount_entered"
  | "manager_approved"
  | "approved"
  | "cancelled"
  | "not_billable";

export const COMPANY_LABELS: Record<CompanyValue, string> = {
  MVC: "MVC",
  BEDGE: "B Edge",
};

// MVC work is billed by MVC & Company with GST, or without GST in the name
// of one of the other three. B Edge work is always billed by B Edge.
export const MVC_BILL_TYPES = ["GST", "NON_GST", "NON_GST_HV", "NON_GST_VLA"] as const;
export type MvcBillTypeValue = (typeof MVC_BILL_TYPES)[number];
export const BILL_TYPES: BillTypeValue[] = [...MVC_BILL_TYPES, "BEDGE"];

// The bill types of the given companies, in display order
export function billTypesOf(companies: CompanyValue[]): BillTypeValue[] {
  return [...(companies.includes("MVC") ? MVC_BILL_TYPES : []), ...(companies.includes("BEDGE") ? (["BEDGE"] as const) : [])];
}

// The name each type of bill is issued in
export const BILL_ISSUERS: Record<BillTypeValue, string> = {
  GST: "MVC & Company",
  NON_GST: "CA Mukul Verma",
  NON_GST_HV: "CA Harsh Verma",
  NON_GST_VLA: "Verma Law Associates",
  BEDGE: "B Edge",
};

export const BILL_TYPE_LABELS: Record<BillTypeValue, string> = {
  GST: "GST – MVC & Company",
  NON_GST: "Non-GST – CA Mukul Verma",
  NON_GST_HV: "Non-GST – CA Harsh Verma",
  NON_GST_VLA: "Non-GST – Verma Law Associates",
  BEDGE: "B Edge",
};

export const BILL_STATUS_LABELS: Record<BillStatusValue, string> = {
  draft: "Draft",
  awaiting_amount: "Awaiting amount",
  amount_entered: "Amount entered",
  manager_approved: "Awaiting final approval",
  approved: "Approved",
  cancelled: "Cancelled",
  not_billable: "Not billable",
};

export const GST_RATE_PERCENT = 18;

// Statuses in which the billing manager can still change the bill freely
export const EDITABLE_BILL_STATUSES: BillStatusValue[] = [
  "draft",
  "awaiting_amount",
  "amount_entered",
];

// Financial year (1 April – 31 March) of a date in Indian time, e.g. "2026-27"
export function financialYearOf(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Bill number as printed, in the formats the firm already uses:
// GST "26-27/0218", Non-GST "2026-27/26986", B Edge "BE/26150".
// CA Harsh Verma and Verma Law Associates: "HV/2026-27/1", "VLA/2026-27/1".
export function formatBillNumber(
  type: BillTypeValue,
  financialYear: string,
  sequence: number
): string {
  switch (type) {
    case "GST":
      return `${financialYear.slice(2)}/${String(sequence).padStart(4, "0")}`;
    case "NON_GST":
      return `${financialYear}/${sequence}`;
    case "NON_GST_HV":
      return `HV/${financialYear}/${sequence}`;
    case "NON_GST_VLA":
      return `VLA/${financialYear}/${sequence}`;
    case "BEDGE":
      return `BE/${sequence}`;
  }
}

export function gstAmount(amount: number): number {
  return Math.round(amount * GST_RATE_PERCENT) / 100;
}

export function formatRupees(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);
}
