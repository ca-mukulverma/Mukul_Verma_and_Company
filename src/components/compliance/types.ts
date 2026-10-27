import axios from "axios";
import type { SheetItem } from "@/lib/compliance-sheet";

// Shared by the Compliance page's components (see docs/COMPLIANCE.md)

export type { SheetItem };

export type ItemStatus = SheetItem["status"];
export type ItemKind = SheetItem["kind"];

export interface ClientCell {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  // The responsible person's email (the owner's when the owner is responsible)
  email: string | null;
  ownerIsResponsible: boolean;
  responsibleName: string | null;
  // The responsible person has no WhatsApp number: reminders can't go on WhatsApp
  noWhatsapp: boolean;
}

export const STATUS_LABELS: Record<ItemStatus, string> = {
  pending: "Pending",
  data_received: "Data received",
  filed: "Filed",
  completed: "Completed",
  not_required: "Not required",
};

export const DOC_KIND_LABELS: Record<string, string> = {
  RETURN_PDF: "Return PDF",
  RETURN_JSON: "Return JSON",
  GSTR1A_PDF: "GSTR-1A PDF",
  GSTR1A_JSON: "GSTR-1A JSON",
  CHALLAN: "Challan",
  CERTIFICATE: "Form 16/16A",
  OTHER: "Other",
};

// Same colours as the old Excel sheet: grey pending, yellow data received,
// blue filed (files or steps pending), green completed, red overdue
export function statusClasses(item: Pick<SheetItem, "status" | "overdue">) {
  if (item.overdue) return "bg-red-100 text-red-900 border-red-300 dark:bg-red-950/50 dark:text-red-200 dark:border-red-900";
  switch (item.status) {
    case "data_received":
      return "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900";
    case "filed":
      return "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-900";
    case "completed":
      return "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900";
    case "not_required":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-background text-foreground border-border";
  }
}

// Short text for a cell
export function cellText(item: SheetItem) {
  if (item.status === "filed") return item.missing.length ? "Filed · files pending" : "Filed";
  if (item.status === "completed") return item.kind === "TDS_PAYMENT" ? (item.noTds ? "No TDS" : "Paid") : "Completed";
  if (item.overdue) return `Overdue (${shortDate(item.dueDate)})`;
  return STATUS_LABELS[item.status];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-20" → "20 Nov"
export function shortDate(key: string | null) {
  if (!key) return "";
  const [, m, d] = key.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function longDate(key: string | null) {
  if (!key) return "";
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function rupees(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function currentMonthKey() {
  return todayKey().slice(0, 7);
}

export function apiError(error: unknown, fallback = "Something went wrong") {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === "string") return error.response.data.error;
  return fallback;
}

export async function runItemAction(id: string, body: Record<string, unknown>): Promise<SheetItem> {
  const { data } = await axios.patch(`/api/compliance/items/${id}`, body);
  return data;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Figures asked for when a return is filed (same keys as lib/compliance.ts)
export const FIGURE_FIELDS: Partial<Record<ItemKind, { key: string; label: string }[]>> = {
  GSTR1: [
    { key: "taxable", label: "Taxable value" },
    { key: "tax", label: "Total tax" },
  ],
  GSTR3B: [
    { key: "taxable", label: "Outward taxable value (3.1a)" },
    { key: "outputTax", label: "Outward tax" },
    { key: "itcClaimed", label: "ITC claimed" },
    { key: "itc2b", label: "ITC as per GSTR-2B" },
    { key: "rcmTax", label: "RCM tax paid" },
    { key: "cashPaid", label: "Tax paid in cash" },
  ],
  TDS_RETURN: [
    { key: "deducted", label: "TDS deducted" },
    { key: "deposited", label: "TDS deposited" },
    { key: "deductees", label: "No. of deductees" },
    { key: "challans", label: "No. of challans" },
  ],
};

export const GSTR1A_FIGURES = [
  { key: "taxable1A", label: "Change in taxable value" },
  { key: "tax1A", label: "Change in tax" },
];

export const TDS_SECTIONS = [
  "192", "192A", "193", "194", "194A", "194B", "194C", "194D", "194H", "194I(a)", "194I(b)",
  "194IA", "194IB", "194J(a)", "194J(b)", "194M", "194N", "194O", "194Q", "194R", "194S", "195", "Other",
];

export const RCM_CATEGORIES = [
  "Rent – unregistered landlord",
  "Goods transport (GTA)",
  "Legal services (advocate)",
  "Security services",
  "Director's remuneration / sitting fees",
  "Sponsorship",
  "Import of services",
  "Other",
];
