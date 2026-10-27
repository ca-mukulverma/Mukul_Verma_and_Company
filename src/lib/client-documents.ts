import { z } from "zod";

// The client's own documents (Client → Documents): registrations kept once
// and yearly papers kept per financial year. Stored like compliance files
// (ComplianceDocument without an item, in Cloudflare R2) with a docType from
// this list. Send to Client picks them by type and year.
//
// Aadhaar is deliberately not a type: sharing Aadhaar copies is restricted,
// so it is kept off email altogether.

export type ClientDocGroup = "Registrations" | "Income tax" | "GST" | "Financials" | "Company";

export interface ClientDocType {
  key: string;
  label: string;
  group: ClientDocGroup;
  // Kept per financial year
  yearly: boolean;
}

export const CLIENT_DOC_TYPES: ClientDocType[] = [
  { key: "PAN_CARD", label: "PAN card", group: "Registrations", yearly: false },
  { key: "TAN_ALLOTMENT", label: "TAN allotment letter", group: "Registrations", yearly: false },
  { key: "GST_CERTIFICATE", label: "GST registration certificate", group: "Registrations", yearly: false },
  { key: "UDYAM", label: "Udyam / MSME certificate", group: "Registrations", yearly: false },
  { key: "SHOP_ACT", label: "Shop & Establishment registration", group: "Registrations", yearly: false },
  { key: "IEC", label: "Import Export Code (IEC)", group: "Registrations", yearly: false },
  { key: "PF_REGISTRATION", label: "PF registration", group: "Registrations", yearly: false },
  { key: "ESIC_REGISTRATION", label: "ESIC registration", group: "Registrations", yearly: false },
  { key: "PT_REGISTRATION", label: "Professional Tax registration", group: "Registrations", yearly: false },
  { key: "CANCELLED_CHEQUE", label: "Cancelled cheque", group: "Registrations", yearly: false },
  { key: "OTHER_REGISTRATION", label: "Other registration", group: "Registrations", yearly: false },

  { key: "INCORPORATION", label: "Certificate of incorporation", group: "Company", yearly: false },
  { key: "MOA_AOA", label: "MOA / AOA", group: "Company", yearly: false },
  { key: "PARTNERSHIP_DEED", label: "Partnership / LLP deed", group: "Company", yearly: false },
  { key: "AOC4", label: "AOC-4 (financial statements filed with ROC)", group: "Company", yearly: true },
  { key: "MGT7", label: "MGT-7 (annual return filed with ROC)", group: "Company", yearly: true },

  { key: "ITR_ACK", label: "ITR acknowledgement (ITR-V)", group: "Income tax", yearly: true },
  { key: "ITR_FORM", label: "ITR form", group: "Income tax", yearly: true },
  { key: "COMPUTATION", label: "Computation of income", group: "Income tax", yearly: true },
  { key: "FORM_26AS", label: "Form 26AS", group: "Income tax", yearly: true },
  { key: "AIS", label: "AIS", group: "Income tax", yearly: true },
  { key: "TIS", label: "TIS", group: "Income tax", yearly: true },
  { key: "TAX_AUDIT_REPORT", label: "Tax audit report (3CA/3CB-3CD)", group: "Income tax", yearly: true },
  { key: "ADVANCE_TAX_CHALLAN", label: "Advance tax challan", group: "Income tax", yearly: true },
  { key: "SELF_ASSESSMENT_CHALLAN", label: "Self-assessment tax challan", group: "Income tax", yearly: true },
  { key: "INTIMATION_143", label: "Intimation u/s 143(1)", group: "Income tax", yearly: true },
  { key: "REFUND", label: "Refund / order", group: "Income tax", yearly: true },

  { key: "GSTR9", label: "GSTR-9 annual return", group: "GST", yearly: true },
  { key: "GSTR9C", label: "GSTR-9C reconciliation", group: "GST", yearly: true },
  { key: "LUT", label: "LUT acknowledgement", group: "GST", yearly: true },

  { key: "FINANCIALS", label: "Balance sheet & P&L", group: "Financials", yearly: true },
  { key: "AUDIT_REPORT", label: "Audit report", group: "Financials", yearly: true },
  { key: "OTHER_YEARLY", label: "Other yearly document", group: "Financials", yearly: true },
];

export const CLIENT_DOC_GROUPS: ClientDocGroup[] = ["Registrations", "Company", "Income tax", "GST", "Financials"];

export const CLIENT_DOC_TYPE_KEYS = CLIENT_DOC_TYPES.map((t) => t.key) as [string, ...string[]];

export function clientDocType(key: string | null | undefined): ClientDocType | null {
  return CLIENT_DOC_TYPES.find((t) => t.key === key) ?? null;
}

// 2025 → "FY 2025-26"
export function fyLabel(startYear: number) {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// The financial year (by its starting year) a date falls in
export function fyOf(date: Date) {
  return date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

// A document as shown in the client's Documents tab: "ITR form – FY 2025-26"
export function clientDocLabel(doc: { docType: string | null; financialYear: number | null }) {
  const type = clientDocType(doc.docType);
  if (!type) return "Document";
  return type.yearly && doc.financialYear ? `${type.label} – ${fyLabel(doc.financialYear)}` : type.label;
}

// ─── Registration numbers on the client record ──────────────────────────────

export const REGISTRATION_FIELDS = [
  { key: "pan", label: "PAN", placeholder: "ABCDE1234F", maxLength: 10, pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/ },
  { key: "tan", label: "TAN", placeholder: "BPLA12345B", maxLength: 10, pattern: /^[A-Z]{4}[0-9]{5}[A-Z]$/ },
  { key: "cin", label: "CIN / LLPIN", placeholder: "U74999MP2020PTC012345", maxLength: 21, pattern: /^([A-Z0-9]{21}|[A-Z]{3}-[0-9]{4})$/ },
  { key: "udyamNumber", label: "Udyam number", placeholder: "UDYAM-MP-12-0012345", maxLength: 19, pattern: /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/ },
  { key: "iec", label: "IEC", placeholder: "ABCDE1234F", maxLength: 10, pattern: /^[A-Z0-9]{10}$/ },
] as const;
export type RegistrationField = (typeof REGISTRATION_FIELDS)[number]["key"];
export type RegistrationValues = Record<RegistrationField, string>;

export function emptyRegistrations(): RegistrationValues {
  return { pan: "", tan: "", cin: "", udyamNumber: "", iec: "" };
}

export function registrationsOf(client: Partial<Record<RegistrationField, string | null>>): RegistrationValues {
  return Object.fromEntries(REGISTRATION_FIELDS.map((f) => [f.key, client[f.key] ?? ""])) as RegistrationValues;
}

// Upper-cased, empty → null; what the client API takes
export function registrationsPayload(values: Partial<Record<RegistrationField, string | null | undefined>>) {
  const out: Partial<Record<RegistrationField, string | null>> = {};
  for (const f of REGISTRATION_FIELDS) {
    const v = values[f.key];
    if (v !== undefined) out[f.key] = v?.trim().toUpperCase().replace(/\s+/g, "") || null;
  }
  return out;
}

// The first wrongly formatted number, or null
export function registrationsProblem(values: Partial<Record<RegistrationField, string | null | undefined>>): string | null {
  const clean = registrationsPayload(values);
  for (const f of REGISTRATION_FIELDS) {
    const v = clean[f.key];
    if (v && !f.pattern.test(v)) return `Check the ${f.label}: it should look like ${f.placeholder}`;
  }
  return null;
}

// Client API input; checked with registrationsProblem before saving
export const registrationsSchema = z.object({
  pan: z.string().max(25).nullable().optional(),
  tan: z.string().max(25).nullable().optional(),
  cin: z.string().max(30).nullable().optional(),
  udyamNumber: z.string().max(30).nullable().optional(),
  iec: z.string().max(25).nullable().optional(),
});
