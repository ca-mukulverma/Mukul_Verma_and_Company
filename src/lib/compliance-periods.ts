import { ComplianceFrequency } from "@prisma/client";

// Periods of compliance work. Dates are calendar days stored as UTC midnight
// (Postgres DATE), so "2026-10-01" means 1 October 2026 everywhere.
// Quarters and years follow the financial year: Q1 is April–June.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function utcDate(year: number, month: number, day = 1): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// month is 1–12; adds n months (n may be negative)
export function addMonths(date: Date, n: number): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1 + n, 1);
}

// Today's date in India, as a UTC-midnight date
export function todayIST(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = parts.split("-").map(Number);
  return utcDate(y, m, d);
}

export function monthsIn(frequency: ComplianceFrequency) {
  return frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12;
}

// The period of the given frequency that contains the date
export function periodContaining(frequency: ComplianceFrequency, date: Date): { start: Date; end: Date } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  let start: Date;
  if (frequency === "MONTHLY") {
    start = utcDate(y, m);
  } else if (frequency === "QUARTERLY") {
    // Apr, Jul, Oct, Jan
    const fyMonthIndex = (m + 8) % 12; // Apr → 0
    start = addMonths(utcDate(y, m), -(fyMonthIndex % 3));
  } else {
    start = m >= 4 ? utcDate(y, 4) : utcDate(y - 1, 4);
  }
  return { start, end: periodEndOf(frequency, start) };
}

// Last day of the period that starts on `start`
export function periodEndOf(frequency: ComplianceFrequency, start: Date): Date {
  const lastMonth = addMonths(start, monthsIn(frequency) - 1);
  const y = lastMonth.getUTCFullYear();
  const m = lastMonth.getUTCMonth() + 1;
  return utcDate(y, m, daysInMonth(y, m));
}

export function previousPeriodStart(frequency: ComplianceFrequency, start: Date): Date {
  return addMonths(start, -monthsIn(frequency));
}

export function nextPeriodStart(frequency: ComplianceFrequency, start: Date): Date {
  return addMonths(start, monthsIn(frequency));
}

// "2026-27" for any date from April 2026 to March 2027
export function financialYearLabel(date: Date): string {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() + 1 >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// "Oct 2026", "Q3 (Oct–Dec) 2026-27", "FY 2026-27"
export function periodLabel(frequency: ComplianceFrequency, start: Date): string {
  const m = start.getUTCMonth();
  if (frequency === "MONTHLY") return `${MONTHS[m]} ${start.getUTCFullYear()}`;
  if (frequency === "YEARLY") return `FY ${financialYearLabel(start)}`;
  const quarter = Math.floor(((m + 9) % 12) / 3) + 1;
  return `Q${quarter} (${MONTHS[m]}–${MONTHS[(m + 2) % 12]}) ${financialYearLabel(start)}`;
}

// Financial-year quarter number (1–4) of a date
export function quarterOf(date: Date): number {
  return Math.floor(((date.getUTCMonth() + 9) % 12) / 3) + 1;
}

// "2026-10" ↔ date
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseMonthKey(key: string | null | undefined): Date | null {
  const match = key?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return utcDate(Number(match[1]), month);
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// "2026-10-25" → date (calendar day); null if invalid
export function parseDateKey(key: string | null | undefined): Date | null {
  const match = key?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return dateKey(date) === key ? date : null;
}

// GST state codes whose quarterly GSTR-3B is due on the 22nd (the rest: 24th)
const GSTR3B_22ND_STATES = new Set([
  "22", "23", "24", "25", "26", "27", "29", "30", "31", "32", "33", "34", "35", "36", "37",
]);

export interface DueRule {
  kind: string;
  dueDay: number;
  dueMonthOffset: number;
  quarterlyDueDay: number | null;
  quarterlyDueMonthOffset: number | null;
  dueExceptions: unknown;
}

// Due date of a period: the rule's day, so many months after the period ends.
// Exceptions are keyed by the month (1–12) in which the period ends.
export function dueDateFor(rule: DueRule, frequency: ComplianceFrequency, periodEnd: Date, gstin?: string | null): Date {
  let day = rule.dueDay;
  let offset = rule.dueMonthOffset;
  if (frequency === "QUARTERLY" && rule.quarterlyDueDay !== null) {
    day = rule.quarterlyDueDay;
    offset = rule.quarterlyDueMonthOffset ?? offset;
    // Quarterly GSTR-3B: 22nd or 24th depending on the client's state
    if (rule.kind === "GSTR3B") day = gstin && !GSTR3B_22ND_STATES.has(gstin.slice(0, 2)) ? 24 : 22;
  }
  const exceptions = (rule.dueExceptions ?? {}) as Record<string, { day?: number; offset?: number }>;
  const exception = exceptions[String(periodEnd.getUTCMonth() + 1)];
  if (exception) {
    day = exception.day ?? day;
    offset = exception.offset ?? offset;
  }
  const month = addMonths(periodEnd, offset);
  const y = month.getUTCFullYear();
  const m = month.getUTCMonth() + 1;
  return utcDate(y, m, Math.min(day, daysInMonth(y, m)));
}

export function formatDay(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
