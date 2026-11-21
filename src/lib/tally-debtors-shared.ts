// Debtors from Tally (docs/TALLY_DEBTORS.md): what the server and the pages
// share. Nothing here touches the database, so it runs in the browser too.

// Each firm's own Tally company (the app's Company: MVC, BEDGE)
export const DEBTOR_ENTITIES = ["MVC", "BEDGE"] as const;
export type DebtorEntity = (typeof DEBTOR_ENTITIES)[number];
export const ENTITY_LABELS: Record<DebtorEntity, string> = { MVC: "MVC", BEDGE: "B Edge" };
export const isDebtorEntity = (v: unknown): v is DebtorEntity => DEBTOR_ENTITIES.includes(v as DebtorEntity);

// When the Tally PC sends the debtors (IST), like Gudakesa Desk
export const SYNC_SLOTS = ["11:30", "13:00", "16:00", "19:00"];
// A scheduled update counts as missed this long after its time
const SLOT_GRACE_MIN = 20;
// Days the office works (0 = Sunday): a Sunday without updates is not "missed"
const WORK_DAYS = [1, 2, 3, 4, 5, 6];

const IST_OFFSET_MIN = 330;

// The date and time in India of a moment
export function istParts(date: Date) {
  const t = new Date(date.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
    weekday: t.getUTCDay(),
  };
}

// The moment of a date and time in India
export function istMoment(y: number, m: number, d: number, hh = 0, mm = 0) {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000);
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// Today in India as YYYY-MM-DD
export function istToday(now = new Date()) {
  const p = istParts(now);
  return isoDay(p.y, p.m, p.d);
}

// The financial year (April–March) a day falls in, by its starting year
export function fyStartYear(day: string) {
  const [y, m] = day.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

export const fyLabel = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

// The entries kept: from the start of the previous financial year to the end
// of the current one
export function keptPeriod(now = new Date()) {
  const fy = fyStartYear(istToday(now));
  return { from: isoDay(fy - 1, 4, 1), to: isoDay(fy + 1, 3, 31) };
}

// Sales lines are kept two financial years further back than the debtors'
// entries, so every month of the last financial year has its year-before
// to compare with (Admin's Sales page)
export function salesFrom(now = new Date()) {
  const fy = fyStartYear(istToday(now));
  return isoDay(fy - 2, 4, 1);
}

// The scheduled update times that were due by `now`, latest first (up to 8 days back)
function dueSlots(now: Date) {
  const out: Date[] = [];
  const today = istParts(now);
  for (let back = 0; back <= 8 && out.length < 2; back++) {
    const day = new Date(istMoment(today.y, today.m, today.d, 12).getTime() - back * 86_400_000);
    const p = istParts(day);
    if (!WORK_DAYS.includes(p.weekday)) continue;
    for (const slot of [...SYNC_SLOTS].reverse()) {
      const [hh, mm] = slot.split(":").map(Number);
      const at = istMoment(p.y, p.m, p.d, hh, mm);
      if (at.getTime() + SLOT_GRACE_MIN * 60_000 <= now.getTime()) out.push(at);
      if (out.length >= 2) break;
    }
  }
  return out;
}

// The next scheduled update after `now`
export function nextSlot(now = new Date()) {
  const today = istParts(now);
  for (let ahead = 0; ahead <= 8; ahead++) {
    const day = new Date(istMoment(today.y, today.m, today.d, 12).getTime() + ahead * 86_400_000);
    const p = istParts(day);
    if (!WORK_DAYS.includes(p.weekday)) continue;
    for (const slot of SYNC_SLOTS) {
      const [hh, mm] = slot.split(":").map(Number);
      const at = istMoment(p.y, p.m, p.d, hh, mm);
      if (at > now) return at;
    }
  }
  return null;
}

export type Freshness =
  // Every scheduled update so far has come
  | { level: "fresh"; missedSince: null }
  // The update due at `missedSince` (or more) hasn't come: check before sending
  | { level: "stale"; missedSince: Date }
  // Nothing has come from Tally yet
  | { level: "none"; missedSince: null };

export function freshness(readAt: Date | string | null | undefined, now = new Date()): Freshness {
  if (!readAt) return { level: "none", missedSince: null };
  const read = new Date(readAt).getTime();
  const [latest] = dueSlots(now);
  // The update reads Tally a little after its time; allow a few minutes before it too
  if (!latest || read >= latest.getTime() - 5 * 60_000) return { level: "fresh", missedSince: null };
  return { level: "stale", missedSince: latest };
}

// ─── Ledger entries and the statement ───────────────────────────────────────

// One line of a ledger, as Tally shows it in Ledger Vouchers
export interface LedgerEntry {
  d: string; // date, YYYY-MM-DD
  p: string; // particulars: the ledger on the other side
  t: string; // voucher type
  n: string; // voucher number
  dr: number;
  cr: number;
  r?: string; // narration
}

export interface Statement {
  from: string;
  to: string;
  opening: number; // debit positive
  lines: LedgerEntry[];
  totalDr: number;
  totalCr: number;
  closing: number; // debit positive
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// The ledger for a period: the opening balance at `from` (the balance at the
// start of the kept period plus the entries before `from`), the entries in
// the period, their totals and the closing balance
export function statement(ledger: { opening: number; entries: LedgerEntry[] }, from: string, to: string): Statement {
  let opening = ledger.opening;
  const lines: LedgerEntry[] = [];
  let totalDr = 0;
  let totalCr = 0;
  for (const e of ledger.entries) {
    if (e.d < from) opening += e.dr - e.cr;
    else if (e.d <= to) {
      lines.push(e);
      totalDr += e.dr;
      totalCr += e.cr;
    }
  }
  opening = round2(opening);
  totalDr = round2(totalDr);
  totalCr = round2(totalCr);
  return { from, to, opening, lines, totalDr, totalCr, closing: round2(opening + totalDr - totalCr) };
}

// ─── Formats ────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-04-01" → "1-Apr-26", as Tally writes dates
export function tallyDate(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${d}-${MONTHS[m - 1]}-${String(y % 100).padStart(2, "0")}`;
}

// "2026-04-01" → "1-Apr-2026"
export function longDate(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${d}-${MONTHS[m - 1]}-${y}`;
}

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 118000 → "1,18,000.00"; zero → ""
export function amount(n: number) {
  return n ? INR.format(Math.abs(n)) : "";
}

// 1500 → "1,500.00 Dr", -200 → "200.00 Cr", 0 → "Nil"
export function balance(n: number) {
  if (!n) return "Nil";
  return `${INR.format(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`;
}

// The time of the Tally data, in India: "20-Nov-2026, 4:05 pm"
export function asOfText(at: Date | string) {
  const p = istParts(new Date(at));
  const h12 = p.hh % 12 || 12;
  return `${p.d}-${MONTHS[p.m - 1]}-${p.y}, ${h12}:${pad(p.mm)} ${p.hh < 12 ? "am" : "pm"}`;
}

// "12 min ago", "3 hours ago", "2 days ago"
export function agoText(at: Date | string, now = new Date()) {
  const min = Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// The file name of a downloaded ledger: "Ledger - ABC Traders - 1-Apr-2026 to 20-Nov-2026"
export function ledgerFileName(name: string, from: string, to: string) {
  const safe = name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `Ledger - ${safe} - ${longDate(from)} to ${longDate(to)}`;
}
