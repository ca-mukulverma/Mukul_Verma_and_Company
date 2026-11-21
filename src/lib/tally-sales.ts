// Sales figures for Admin's Sales page (docs/TALLY_DEBTORS.md, "Sales"),
// worked out from the lines to income ledgers (under Sales Accounts) synced
// from each firm's Tally. Nothing here touches the database.
//
// Sales = credits to income ledgers less debits to them (credit notes,
// returns), so GST and other tax ledgers are not in it. Every figure comes
// with the same period a year before, and the change is explained: by
// service (income ledger), by Tally income group, by voucher type (the firm
// names in one company), by who brings the client (Sundry Debtors group), and
// by client (new, lost, continuing).

import { fyStartYear, isoDay, type DebtorEntity } from "@/lib/tally-debtors-shared";

export interface SalesLine {
  d: string; // YYYY-MM-DD
  l: string; // income ledger
  p: string; // party
  t: string; // voucher type
  n: string; // voucher number
  a: number; // credit positive
}

export interface FirmSales {
  entity: DebtorEntity;
  lines: SalesLine[];
  ledgerGroups: Record<string, string>; // income ledger -> its group in Tally
  // party (lower case) -> its group under Sundry Debtors (who brings the client)
  partyGroups: Record<string, string>;
}

export type PeriodKind = "day" | "week" | "month" | "quarter" | "fy" | "custom";

export interface Period {
  kind: PeriodKind;
  label: string;
  from: string;
  to: string; // cut at today for a running period
  toDate: boolean; // the period is still running
  lyFrom: string;
  lyTo: string;
  lyLabel: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const shortDate = (day: string) => {
  const [y, m, d] = parts(day);
  return `${d}-${MONTHS[m - 1]}-${String(y % 100).padStart(2, "0")}`;
};

// The same calendar day a year before (29 Feb → 28 Feb)
export function yearBefore(day: string) {
  const [y, m, d] = parts(day);
  return isoDay(y - 1, m, Math.min(d, daysIn(y - 1, m)));
}

const fyLabel = (y: number) => `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;

// The period around `date`, cut at `today` if it is still running, and the
// same stretch a year before (a week: the same weekdays, 52 weeks before)
export function salesPeriod(kind: PeriodKind, date: string, today: string, customTo?: string): Period {
  const [y, m] = parts(date);
  let from: string;
  let end: string;
  let label: string;
  switch (kind) {
    case "day":
      from = end = date;
      label = shortDate(date);
      break;
    case "week": {
      const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
      from = addDays(date, -weekday);
      end = addDays(from, 6);
      label = `Week of ${shortDate(from)}`;
      break;
    }
    case "month":
      from = isoDay(y, m, 1);
      end = isoDay(y, m, daysIn(y, m));
      label = `${MONTHS[m - 1]} ${y}`;
      break;
    case "quarter": {
      const fy = fyStartYear(date);
      const q = Math.floor(((m + 8) % 12) / 3); // Apr–Jun 0 … Jan–Mar 3
      const startMonth = ((3 + q * 3) % 12) + 1;
      const startYear = startMonth >= 4 ? fy : fy + 1;
      from = isoDay(startYear, startMonth, 1);
      end = isoDay(startYear, startMonth + 2, daysIn(startYear, startMonth + 2));
      label = `Q${q + 1} ${fyLabel(fy)}`;
      break;
    }
    case "fy": {
      const fy = fyStartYear(date);
      from = isoDay(fy, 4, 1);
      end = isoDay(fy + 1, 3, 31);
      label = fyLabel(fy);
      break;
    }
    case "custom":
      from = date;
      end = customTo && customTo >= date ? customTo : date;
      label = `${shortDate(from)} to ${shortDate(end)}`;
      break;
  }
  const toDate = end > today && from <= today;
  const to = toDate ? today : end;
  const lyFrom = kind === "week" ? addDays(from, -364) : yearBefore(from);
  const lyTo = kind === "week" ? addDays(to, -364) : yearBefore(to);
  const lyLabel = `${shortDate(lyFrom)} to ${shortDate(lyTo)}`;
  return { kind, label: toDate ? `${label} (to ${shortDate(to)})` : label, from, to, toDate, lyFrom, lyTo, lyLabel };
}

const round = (n: number) => Math.round(n * 100) / 100;
export const growthPct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

export interface Totals {
  sales: number;
  bills: number; // vouchers with sales in them
  parties: number;
  avgBill: number | null;
}

export interface Compared {
  now: Totals;
  before: Totals;
  change: number;
  growthPct: number | null;
}

export interface BreakdownRow {
  name: string;
  now: number;
  before: number;
  change: number;
  growthPct: number | null;
}

export interface ClientRow {
  party: string;
  firms: string[];
  now: number;
  before: number;
  change: number;
}

export interface SalesReport {
  period: Period;
  firms: Partial<Record<DebtorEntity, Compared>>;
  total: Compared;
  // Why it moved: each list sorted by the size of the change
  byService: BreakdownRow[];
  byIncomeGroup: BreakdownRow[];
  byVoucherType: BreakdownRow[];
  byDebtorGroup: BreakdownRow[];
  clients: {
    // last year's sales + new − lost + continuing change = this year's sales
    bridge: { before: number; fromNew: number; fromLost: number; fromContinuing: number; now: number };
    newCount: number;
    lostCount: number;
    continuingCount: number;
    topNew: ClientRow[];
    topLost: ClientRow[];
    topUp: ClientRow[];
    topDown: ClientRow[];
  };
  // Month by month: this financial year and the year before
  trend: { month: string; label: string; now: number | null; before: number }[];
  trendYears: { now: string; before: string };
}

type Tagged = SalesLine & { entity: DebtorEntity };

function totals(lines: Tagged[]): Totals {
  const bills = new Map<string, number>();
  const parties = new Set<string>();
  let sales = 0;
  for (const l of lines) {
    sales += l.a;
    const k = `${l.entity}|${l.t}|${l.n}|${l.d}`;
    bills.set(k, (bills.get(k) ?? 0) + l.a);
    if (l.p) parties.add(l.p.trim().toLowerCase());
  }
  const billCount = [...bills.values()].filter((v) => v > 0).length;
  return { sales: round(sales), bills: billCount, parties: parties.size, avgBill: billCount ? round(sales / billCount) : null };
}

function compare(now: Tagged[], before: Tagged[]): Compared {
  const a = totals(now);
  const b = totals(before);
  return { now: a, before: b, change: round(a.sales - b.sales), growthPct: growthPct(a.sales, b.sales) };
}

function breakdown(now: Tagged[], before: Tagged[], keyOf: (l: Tagged) => string): BreakdownRow[] {
  const rows = new Map<string, { now: number; before: number }>();
  for (const l of now) {
    const k = keyOf(l);
    rows.set(k, { now: (rows.get(k)?.now ?? 0) + l.a, before: rows.get(k)?.before ?? 0 });
  }
  for (const l of before) {
    const k = keyOf(l);
    rows.set(k, { now: rows.get(k)?.now ?? 0, before: (rows.get(k)?.before ?? 0) + l.a });
  }
  return [...rows.entries()]
    .map(([name, v]) => ({ name, now: round(v.now), before: round(v.before), change: round(v.now - v.before), growthPct: growthPct(v.now, v.before) }))
    .filter((r) => r.now || r.before)
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || y.now - x.now);
}

const LABELS: Record<DebtorEntity, string> = { MVC: "MVC", BEDGE: "B Edge" };

export function salesReport(firms: FirmSales[], period: Period, today: string): SalesReport {
  const tagged = firms.flatMap((f) => f.lines.map((l) => ({ ...l, entity: f.entity })));
  const within = (from: string, to: string) => tagged.filter((l) => l.d >= from && l.d <= to);
  const now = within(period.from, period.to);
  const before = within(period.lyFrom, period.lyTo);

  const firmOf = new Map(firms.map((f) => [f.entity, f]));
  const many = firms.length > 1;
  const tag = (l: Tagged, name: string) => (many ? `${name} (${LABELS[l.entity]})` : name);

  const byFirm: SalesReport["firms"] = {};
  for (const f of firms) {
    byFirm[f.entity] = compare(
      now.filter((l) => l.entity === f.entity),
      before.filter((l) => l.entity === f.entity)
    );
  }

  // Clients: by party name across the firms shown
  const partyKey = (l: Tagged) => (l.p || "(no party)").trim().toLowerCase();
  const clientRows = new Map<string, ClientRow>();
  const add = (l: Tagged, which: "now" | "before") => {
    const k = partyKey(l);
    const row = clientRows.get(k) ?? { party: l.p || "(no party)", firms: [], now: 0, before: 0, change: 0 };
    row[which] += l.a;
    if (!row.firms.includes(LABELS[l.entity])) row.firms.push(LABELS[l.entity]);
    clientRows.set(k, row);
  };
  for (const l of now) add(l, "now");
  for (const l of before) add(l, "before");
  const rows = [...clientRows.values()].map((r) => ({ ...r, now: round(r.now), before: round(r.before), change: round(r.now - r.before) }));
  const isNew = (r: ClientRow) => r.now > 0 && r.before <= 0;
  const isLost = (r: ClientRow) => r.before > 0 && r.now <= 0;
  const newRows = rows.filter(isNew).sort((a, b) => b.now - a.now);
  const lostRows = rows.filter(isLost).sort((a, b) => b.before - a.before);
  const continuing = rows.filter((r) => !isNew(r) && !isLost(r) && (r.now || r.before));
  const sum = (list: ClientRow[], f: (r: ClientRow) => number) => round(list.reduce((s, r) => s + f(r), 0));
  const total = compare(now, before);

  // Month by month, for the financial year of the period and the one before
  const fy = fyStartYear(period.from);
  const trend: SalesReport["trend"] = [];
  for (let i = 0; i < 12; i++) {
    const month = ((3 + i) % 12) + 1;
    const year = month >= 4 ? fy : fy + 1;
    const key = `${year}-${pad(month)}`;
    const lyKey = `${year - 1}-${pad(month)}`;
    const started = `${key}-01` <= today;
    trend.push({
      month: key,
      label: MONTHS[month - 1],
      now: started ? round(tagged.filter((l) => l.d.startsWith(key)).reduce((s, l) => s + l.a, 0)) : null,
      before: round(tagged.filter((l) => l.d.startsWith(lyKey)).reduce((s, l) => s + l.a, 0)),
    });
  }

  return {
    period,
    firms: byFirm,
    total,
    byService: breakdown(now, before, (l) => tag(l, l.l)),
    byIncomeGroup: breakdown(now, before, (l) => tag(l, firmOf.get(l.entity)?.ledgerGroups[l.l] ?? "(no group)")),
    byVoucherType: breakdown(now, before, (l) => tag(l, l.t || "(no type)")),
    byDebtorGroup: breakdown(now, before, (l) => tag(l, firmOf.get(l.entity)?.partyGroups[partyKey(l)] ?? "Not a Sundry Debtor now")),
    clients: {
      bridge: {
        before: total.before.sales,
        fromNew: sum(newRows, (r) => r.now),
        fromLost: -sum(lostRows, (r) => r.before),
        fromContinuing: sum(continuing, (r) => r.change),
        now: total.now.sales,
      },
      newCount: newRows.length,
      lostCount: lostRows.length,
      continuingCount: continuing.length,
      topNew: newRows.slice(0, 10),
      topLost: lostRows.slice(0, 10),
      topUp: continuing.filter((r) => r.change > 0).sort((a, b) => b.change - a.change).slice(0, 10),
      topDown: continuing.filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, 10),
    },
    trend,
    trendYears: { now: `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`, before: `${fy - 1}-${String(fy % 100).padStart(2, "0")}` },
  };
}
