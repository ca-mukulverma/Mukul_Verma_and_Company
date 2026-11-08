import type { FileCheck, FileDoc, ItemInfo, PortalFile } from "@/lib/gst-read/working";

// GST portal downloads with the browser extension
// (docs/GST_PORTAL_EXTENSION_PLAN.md): which of a period's return files are
// saved in the app, which are missing and worth fetching, and which can't be
// on the portal yet. Plain functions, used by the API and in the browser.

export type { PortalFile } from "@/lib/gst-read/working";

// saved: in the app · missing: should be on the portal, not saved (ticked by
// default) · not_yet: the return isn't due or filed yet (2B: not generated) ·
// if_filed: only there if that return was filed (IFF, GSTR-1A)
export type PortalFileState = "saved" | "missing" | "not_yet" | "if_filed";

export interface PortalFileRow {
  kind: PortalFile;
  month: string;
  label: string;
  state: PortalFileState;
  docId: string | null;
  // Every saved document of the file, newest first (a 2B's summary and parts)
  docs: FileDoc[];
}

export interface PortalPeriod {
  start: string;
  title: string;
  quarterly: boolean;
  files: PortalFileRow[];
}

// For filters: the box on the portal's Returns Dashboard each file comes from
export const PORTAL_RETURNS = ["GSTR1", "GSTR3B", "GSTR2B"] as const;
export type PortalReturn = (typeof PORTAL_RETURNS)[number];
export const RETURN_LABELS: Record<PortalReturn, string> = { GSTR1: "GSTR-1", GSTR3B: "GSTR-3B", GSTR2B: "GSTR-2B" };
export const RETURN_OF: Record<PortalFile, PortalReturn> = {
  GSTR1_JSON: "GSTR1",
  GSTR1_PDF: "GSTR1",
  GSTR1A_PDF: "GSTR1",
  GSTR3B_PDF: "GSTR3B",
  GSTR2B_JSON: "GSTR2B",
};

export const STATE_LABELS: Record<PortalFileState, string> = {
  saved: "Saved",
  missing: "Missing",
  not_yet: "Not due yet",
  if_filed: "Only if filed",
};

const FILED = new Set(["filed", "completed"]);

// "2026-06" → "2026-07-<day>"
function nextMonthDay(month: string, day: number) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return `${next}-${String(day).padStart(2, "0")}`;
}

// Usual due days when the period has no item in the sheet (GSTR-1 on the
// 11th, IFF on the 13th, GSTR-3B on the 20th); GSTR-2B is generated on the 14th
function expected(info: ItemInfo | null, fallbackDue: string, today: string) {
  if (info && FILED.has(info.status)) return true;
  if (info?.status === "not_required") return false;
  return today > (info?.dueDate ?? fallbackDue);
}

// today: "2026-11-02" (IST)
export function portalState(file: FileCheck, period: { gstr1: ItemInfo | null; gstr3b: ItemInfo | null; quarterly: boolean }, today: string): PortalFileState {
  if (file.state === "ok") return "saved";
  if (file.state === "optional") return "if_filed";
  // The month itself isn't over
  if (file.month >= today.slice(0, 7)) return "not_yet";
  switch (file.kind) {
    case "GSTR1_JSON":
    case "GSTR1_PDF":
      return expected(period.gstr1, nextMonthDay(file.month, period.quarterly ? 13 : 11), today) ? "missing" : "not_yet";
    case "GSTR1A_PDF":
      // Listed as missing only when the GSTR-1A is marked filed
      return "missing";
    case "GSTR3B_PDF":
      return expected(period.gstr3b, nextMonthDay(file.month, 20), today) ? "missing" : "not_yet";
    case "GSTR2B_JSON":
      return today >= nextMonthDay(file.month, 14) ? "missing" : "not_yet";
  }
}

// A client's GST portal login: a credential titled with "GST", but not the
// e-way bill or e-invoice portal
export function isGstPortalLogin(title: string) {
  return /gst/i.test(title) && !/e[\s-]*way|\bewb\b|e[\s-]*invoice|\beinv|\birp\b/i.test(title);
}

export const fileKey = (f: Pick<PortalFileRow, "kind" | "month">) => `${f.kind}:${f.month}`;
