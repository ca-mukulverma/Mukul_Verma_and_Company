// GST portal downloads (docs/GST_PORTAL_DOWNLOADS.md): names shared by the
// staff screen, the staff API and the helper API. No server imports, so the
// browser can use it too.

export const GST_PORTAL_RETURNS = ["GSTR1", "GSTR3B", "GSTR2B"] as const;
export type GstPortalReturn = (typeof GST_PORTAL_RETURNS)[number];

export const GST_PORTAL_FORMATS = ["PDF", "JSON", "EXCEL"] as const;
export type GstPortalFormat = (typeof GST_PORTAL_FORMATS)[number];

export const RETURN_LABELS: Record<GstPortalReturn, string> = { GSTR1: "GSTR-1", GSTR3B: "GSTR-3B", GSTR2B: "GSTR-2B" };
export const FORMAT_LABELS: Record<GstPortalFormat, string> = { PDF: "PDF", JSON: "JSON", EXCEL: "Excel" };

// A job the helper is working on, or waiting to start
export const UNFINISHED_STATUSES = ["QUEUED", "CLAIMED", "WAITING_LOGIN", "RUNNING"] as const;
// The helper has the job
export const HELPER_STATUSES = ["CLAIMED", "WAITING_LOGIN", "RUNNING"] as const;
export const FINISHED_STATUSES = ["DONE", "PARTLY_DONE", "FAILED", "CANCELLED"] as const;

export type GstPortalJobStatus = (typeof UNFINISHED_STATUSES)[number] | (typeof FINISHED_STATUSES)[number];

export const STATUS_LABELS: Record<GstPortalJobStatus, string> = {
  QUEUED: "Queued",
  CLAIMED: "Starting",
  WAITING_LOGIN: "Waiting for login",
  RUNNING: "Downloading",
  DONE: "Done",
  PARTLY_DONE: "Partly done",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

// A job with no news from the helper for this long has stopped
export const STALE_JOB_MINUTES = 30;
// The helper counts as running if seen within this time
export const HELPER_SEEN_MINUTES = 30;
// "Helper last seen" is written at most this often
export const HELPER_SEEN_WRITE_MINUTES = 5;
export const HELPER_SEEN_KEY = "gstHelperSeen";

export const MAX_LOG_LINES = 40;

export interface JobLogLine {
  at: string;
  text: string;
}

// Keeps the last MAX_LOG_LINES lines
export function appendLog(log: unknown, lines: string[], at = new Date()): JobLogLine[] {
  const old = Array.isArray(log) ? (log as JobLogLine[]) : [];
  const added = lines.map((text) => ({ at: at.toISOString(), text: text.slice(0, 500) }));
  return [...old, ...added].slice(-MAX_LOG_LINES);
}

// A client's GST portal login: a credential titled with "GST", but not the
// e-way bill or e-invoice portal
export function isGstPortalLogin(title: string) {
  return /gst/i.test(title) && !/e[\s-]*way|\bewb\b|e[\s-]*invoice|\beinv|\birp\b/i.test(title);
}

// "2025-04" → "Apr 2025"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const portalMonthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
