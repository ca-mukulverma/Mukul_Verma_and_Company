// GST return numbers (docs/BILLING.md → GST return series). Safe to import in
// the browser: no database access here.
//
// A GST bill keeps its own bill number on the bill, in emails and in Tally.
// When the billing manager or Admin pushes it to the firm's GST return it gets
// a second number from this series, used only in the GST return (GSTR-1).
// The series restarts every 1 April; Admin sets where it starts.

// "GR/26-27/001": the financial year as on GST bills, and at least three digits
export function formatGstReturnNumber(financialYear: string, sequence: number): string {
  return `GR/${financialYear.slice(2)}/${String(sequence).padStart(3, "0")}`;
}

// "2026-11" → the financial year of that return month, "2026-27"
export function financialYearOfMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// The month a date falls in, in India: "2026-11"
export function istMonthKey(date: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).formatToParts(
    new Date(date)
  );
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}

// The month before the current one: the return usually being prepared
export function previousMonthKey(from: string = istMonthKey()): string {
  const [year, month] = from.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Stored as a calendar day (Postgres DATE): the 1st of the month at UTC midnight
export function monthDate(monthKey: string): Date {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

export function monthKeyOfDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
