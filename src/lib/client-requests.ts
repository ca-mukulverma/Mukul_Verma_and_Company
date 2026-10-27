import { z } from "zod";

// Send to Client: ready-made requests that pick a client's files and details
// for one-click emailing (see docs/CLIENT_REQUESTS.md). Shared by the server
// and the browser; the picking itself is in lib/client-dispatch.ts.

// Default period for return files, challans and bills; staff can change it
// before sending
export const RANGE_OPTIONS = {
  none: "Not used",
  lastMonth: "Last month",
  lastQuarter: "Last quarter",
  last12Months: "Last 12 months",
  currentFY: "This financial year so far",
  lastFY: "Last financial year",
} as const;
export type RangeOption = keyof typeof RANGE_OPTIONS;

// Compliance works whose files can be picked: the seeded kinds by code, any
// other work by its name (e.g. "Income Tax Return")
export const RETURN_WORKS: { key: string; label: string }[] = [
  { key: "GSTR1", label: "GSTR-1" },
  { key: "GSTR3B", label: "GSTR-3B" },
  { key: "TDS_PAYMENT", label: "TDS Payment" },
  { key: "TDS_RETURN", label: "TDS Returns (24Q / 26Q)" },
  { key: "Advance Tax", label: "Advance Tax" },
  { key: "Income Tax Return", label: "Income Tax Return" },
];

export const RETURN_DOC_KINDS = ["RETURN_PDF", "RETURN_JSON", "GSTR1A_PDF", "GSTR1A_JSON", "CHALLAN", "CERTIFICATE", "OTHER"] as const;

// Client details written into the email
export const DETAIL_FIELDS = {
  contactPerson: "Name",
  companyName: "Firm / company",
  pan: "PAN",
  tan: "TAN",
  gstin: "GSTIN",
  cin: "CIN / LLPIN",
  udyamNumber: "Udyam number",
  iec: "IEC",
  address: "Address",
  email: "Email",
  phone: "Mobile",
} as const;
export type DetailField = keyof typeof DETAIL_FIELDS;
const DETAIL_KEYS = Object.keys(DETAIL_FIELDS) as [DetailField, ...DetailField[]];

// Portal logins (Client → Credentials) are matched to a portal by their title.
// Only Admin can send them.
export const PORTALS = {
  GST: { label: "GST portal", pattern: /\bgst/i },
  INCOME_TAX: { label: "Income Tax portal", pattern: /income|\bitr\b|e-?filing|\bit\b/i },
  TRACES: { label: "TRACES", pattern: /traces/i },
  MCA: { label: "MCA", pattern: /\bmca\b|\broc\b/i },
  EPFO: { label: "EPFO", pattern: /\bepfo?\b|\bpf\b|provident/i },
  ESIC: { label: "ESIC", pattern: /esic/i },
} as const;
export type Portal = keyof typeof PORTALS;
const PORTAL_KEYS = Object.keys(PORTALS) as [Portal, ...Portal[]];

export function portalOf(title: string): Portal | null {
  return PORTAL_KEYS.find((p) => PORTALS[p].pattern.test(title)) ?? null;
}

export const requestConfigSchema = z.object({
  range: z.enum(Object.keys(RANGE_OPTIONS) as [RangeOption, ...RangeOption[]]).default("none"),
  // Financial years of yearly documents and yearly works (latest N)
  years: z.number().int().min(1).max(10).default(1),
  returnWorks: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  returnDocs: z.array(z.enum(RETURN_DOC_KINDS)).max(RETURN_DOC_KINDS.length).default([]),
  documents: z.array(z.string().min(1).max(40)).max(60).default([]),
  details: z.array(z.enum(DETAIL_KEYS)).default([]),
  logins: z.array(z.enum(PORTAL_KEYS)).default([]),
  // Bill copies: none, the latest bill, or all bills in the period
  bills: z.enum(["none", "latest", "range"]).default("none"),
  // A statement of the bills in the period, in the email
  statement: z.boolean().default(false),
});
export type RequestConfig = z.infer<typeof requestConfigSchema>;

export const REQUEST_CATEGORIES = ["GST", "Income tax", "TDS", "Financials & company", "Registrations", "Packs", "Details", "Billing", "Other"] as const;

export const requestTypeSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(100),
  description: z.string().trim().max(300).nullable().optional(),
  category: z.enum(REQUEST_CATEGORIES),
  config: requestConfigSchema,
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

// Requests with portal logins are Admin-only
export const isAdminOnly = (config: RequestConfig) => config.logins.length > 0;

export interface RequestTypeView {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  category: string;
  config: RequestConfig;
  active: boolean;
  sortOrder: number;
  adminOnly: boolean;
}

const c = (config: Partial<RequestConfig>): RequestConfig => requestConfigSchema.parse(config);
const gstReturns = (): Partial<RequestConfig> => ({ returnWorks: ["GSTR1", "GSTR3B"], returnDocs: ["RETURN_PDF", "GSTR1A_PDF"] });
const itr = (): Partial<RequestConfig> => ({ returnWorks: ["Income Tax Return"], returnDocs: ["RETURN_PDF"] });
const PROFILE: DetailField[] = ["contactPerson", "companyName", "pan", "gstin", "address"];

// Added to every installation; Admin can edit or switch them off
export const BUILT_IN_REQUESTS: { key: string; name: string; description: string; category: (typeof REQUEST_CATEGORIES)[number]; config: RequestConfig }[] = [
  // GST
  { key: "gst-registration", category: "GST", name: "GST registration certificate and details", description: "GST certificate with GSTIN, name and address", config: c({ documents: ["GST_CERTIFICATE"], details: ["companyName", "contactPerson", "gstin", "address"] }) },
  { key: "gst-returns-period", category: "GST", name: "Filed GST returns for a period", description: "GSTR-1 and GSTR-3B PDFs, with filing dates and ARNs", config: c({ range: "lastMonth", ...gstReturns() }) },
  { key: "gst-returns-year", category: "GST", name: "GST returns for a financial year", description: "All GSTR-1 and GSTR-3B PDFs of the year", config: c({ range: "lastFY", ...gstReturns() }) },
  { key: "gstr9", category: "GST", name: "GSTR-9 / 9C annual return", description: "Latest annual return and reconciliation", config: c({ documents: ["GSTR9", "GSTR9C"] }) },
  { key: "gst-challans", category: "GST", name: "GST challans", description: "GST payment challans for a period", config: c({ range: "lastMonth", returnWorks: ["GSTR3B"], returnDocs: ["CHALLAN"] }) },
  { key: "lut", category: "GST", name: "LUT acknowledgement", description: "For exporters", config: c({ documents: ["LUT"] }) },
  // Income tax
  { key: "itr-latest", category: "Income tax", name: "Latest ITR", description: "ITR acknowledgement, ITR form and computation of the latest year", config: c({ years: 1, documents: ["ITR_ACK", "ITR_FORM", "COMPUTATION"], ...itr() }) },
  { key: "itr-3-years", category: "Income tax", name: "ITRs for the last 3 years", description: "ITR acknowledgements and computations", config: c({ years: 3, documents: ["ITR_ACK", "COMPUTATION"], ...itr() }) },
  { key: "26as-ais", category: "Income tax", name: "Form 26AS / AIS / TIS", description: "Tax credit statements of the latest year", config: c({ documents: ["FORM_26AS", "AIS", "TIS"] }) },
  { key: "tax-audit", category: "Income tax", name: "Tax audit report", description: "3CA/3CB with 3CD", config: c({ documents: ["TAX_AUDIT_REPORT"] }) },
  { key: "tax-challans", category: "Income tax", name: "Advance tax and self-assessment tax challans", description: "Challans of the last 12 months and the latest year", config: c({ range: "last12Months", returnWorks: ["Advance Tax"], returnDocs: ["CHALLAN"], documents: ["ADVANCE_TAX_CHALLAN", "SELF_ASSESSMENT_CHALLAN"] }) },
  { key: "intimation-refund", category: "Income tax", name: "Intimation u/s 143(1) and refund", description: "Latest intimation and refund / order", config: c({ documents: ["INTIMATION_143", "REFUND"] }) },
  // TDS
  { key: "tds-returns", category: "TDS", name: "TDS returns filed", description: "24Q / 26Q return PDFs for a period", config: c({ range: "lastQuarter", returnWorks: ["TDS_RETURN"], returnDocs: ["RETURN_PDF"] }) },
  { key: "tds-challans", category: "TDS", name: "TDS challans", description: "TDS payment challans for a period", config: c({ range: "lastMonth", returnWorks: ["TDS_PAYMENT"], returnDocs: ["CHALLAN"] }) },
  { key: "form-16", category: "TDS", name: "Form 16 / 16A", description: "TDS certificates for a period", config: c({ range: "lastFY", returnWorks: ["TDS_RETURN"], returnDocs: ["CERTIFICATE"] }) },
  // Financials & company
  { key: "financials", category: "Financials & company", name: "Balance sheet and P&L", description: "Latest financial statements", config: c({ documents: ["FINANCIALS"] }) },
  { key: "audit-report", category: "Financials & company", name: "Audit report", description: "Latest audit report", config: c({ documents: ["AUDIT_REPORT"] }) },
  { key: "company-documents", category: "Financials & company", name: "Company documents", description: "Incorporation certificate, MOA/AOA or deed, PAN and TAN", config: c({ documents: ["INCORPORATION", "MOA_AOA", "PARTNERSHIP_DEED", "PAN_CARD", "TAN_ALLOTMENT"], details: ["companyName", "cin", "pan", "tan"] }) },
  { key: "roc-filings", category: "Financials & company", name: "ROC filings (AOC-4, MGT-7)", description: "Latest annual filings with the ROC", config: c({ documents: ["AOC4", "MGT7"] }) },
  // Registrations
  { key: "pan", category: "Registrations", name: "PAN card", description: "PAN card and number", config: c({ documents: ["PAN_CARD"], details: ["contactPerson", "companyName", "pan"] }) },
  { key: "udyam", category: "Registrations", name: "Udyam / MSME certificate", description: "Certificate and Udyam number", config: c({ documents: ["UDYAM"], details: ["companyName", "udyamNumber"] }) },
  { key: "other-registrations", category: "Registrations", name: "Other registrations", description: "Shop & Establishment, IEC, PF, ESIC, Professional Tax", config: c({ documents: ["SHOP_ACT", "IEC", "PF_REGISTRATION", "ESIC_REGISTRATION", "PT_REGISTRATION", "OTHER_REGISTRATION"], details: ["iec"] }) },
  // Packs
  { key: "bank-loan-pack", category: "Packs", name: "Bank loan pack", description: "3 years of ITRs and financials, 12 months of GSTR-3B, GST certificate, PAN, Udyam", config: c({ years: 3, range: "last12Months", returnWorks: ["GSTR3B", "Income Tax Return"], returnDocs: ["RETURN_PDF"], documents: ["ITR_ACK", "COMPUTATION", "FINANCIALS", "AUDIT_REPORT", "GST_CERTIFICATE", "PAN_CARD", "UDYAM"], details: [...PROFILE, "udyamNumber"] }) },
  { key: "visa-pack", category: "Packs", name: "Visa / travel pack", description: "3 years of ITRs and computations, PAN", config: c({ years: 3, ...itr(), documents: ["ITR_ACK", "COMPUTATION", "PAN_CARD"], details: ["contactPerson", "pan"] }) },
  { key: "tender-pack", category: "Packs", name: "Tender pack", description: "PAN, GST certificate, Udyam, 3 years of ITRs and audited financials", config: c({ years: 3, ...itr(), documents: ["PAN_CARD", "GST_CERTIFICATE", "UDYAM", "ITR_ACK", "FINANCIALS", "AUDIT_REPORT"], details: [...PROFILE, "udyamNumber"] }) },
  { key: "kyc-pack", category: "Packs", name: "Vendor / KYC pack", description: "PAN, GST certificate, Udyam and cancelled cheque", config: c({ documents: ["PAN_CARD", "GST_CERTIFICATE", "UDYAM", "CANCELLED_CHEQUE"], details: [...PROFILE, "udyamNumber"] }) },
  // Details only
  { key: "client-profile", category: "Details", name: "Client profile", description: "GSTIN, PAN, TAN, CIN, address and contact details in the email", config: c({ details: [...DETAIL_KEYS] }) },
  { key: "portal-logins", category: "Details", name: "Portal logins", description: "GST, Income Tax, TRACES, MCA, EPFO and ESIC logins (Admin only)", config: c({ logins: [...PORTAL_KEYS] }) },
  // Billing
  { key: "bill-statement", category: "Billing", name: "Statement of bills", description: "Bills issued in a period, with totals", config: c({ range: "lastFY", statement: true }) },
  { key: "bill-copy", category: "Billing", name: "Copy of bill", description: "The latest bill (pick others before sending)", config: c({ bills: "latest" }) },
];
