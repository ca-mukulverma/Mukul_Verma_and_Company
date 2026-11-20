// Recovery figures for a firm's debtors, worked out from the ledgers synced
// from Tally (docs/TALLY_DEBTORS.md, "Recovery"). Nothing here touches the
// database: the server loads the ledgers and calls these.
//
// How a ledger line counts:
//   debit, voucher type "Sales…"                 → billed
//   debit, any other voucher                      → other debits (refunds, journals)
//   credit, voucher type "…Receipt…"              → received
//   credit, other ledger "…TDS…"                  → TDS (counted as recovered)
//   credit, any other voucher (credit notes,
//   journals, write-offs)                         → adjustments
//
// Recovery % = (received + TDS) ÷ (dues at the start of the month + billed in it).

import { istToday, type LedgerEntry } from "@/lib/tally-debtors-shared";

export interface RecoveryLedger {
  id: string;
  name: string;
  group: string; // the ledger's own group in Tally
  opening: number; // balance at the start of the kept period, debit positive
  entries: LedgerEntry[];
}

export interface RecoveryInput {
  ledgers: RecoveryLedger[];
  rootGroup: string;
  groups: { name: string; parent: string }[];
  periodFrom: string; // kept from (YYYY-MM-DD)
  month: string; // YYYY-MM
  today?: string; // YYYY-MM-DD (India); default today
  // WhatsApp sends of ledgers: { ledgerName, at }
  sends?: { ledgerName: string; at: string }[];
}

export type LineKind = "billed" | "otherDr" | "received" | "tds" | "adjusted";

export function lineKind(e: LedgerEntry): LineKind {
  if (e.dr > 0) return /sales/i.test(e.t) ? "billed" : "otherDr";
  if (/receipt/i.test(e.t)) return "received";
  if (/\btds\b|tax deducted/i.test(e.p)) return "tds";
  return "adjusted";
}

const round = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");

export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export interface MonthFigures {
  month: string;
  from: string;
  to: string; // the month's last day, or today for the running month
  openingDue: number; // debit balances at the start of the month
  advances: number; // credit balances at the start of the month (shown positive)
  billed: number;
  otherDebits: number;
  received: number;
  tds: number;
  adjusted: number; // credit notes, journals, write-offs
  recovered: number; // received + TDS
  closingDue: number; // debit balances at `to`
  recoveryPct: number | null;
  oldDuesRecovered: number; // of openingDue, collected in the month (oldest first)
  ageing: { d0_30: number; d31_90: number; d91_180: number; d181_365: number; over365: number };
  over90: number;
  daysToCollect: number | null; // closing dues ÷ billing of the last 90 days × 90
}

// One ledger's figures for a period, and its balance before it
function ledgerPeriod(l: RecoveryLedger, from: string, to: string) {
  let before = l.opening;
  const sums = { billed: 0, otherDr: 0, received: 0, tds: 0, adjusted: 0 };
  for (const e of l.entries) {
    if (e.d < from) before += e.dr - e.cr;
    else if (e.d <= to) sums[lineKind(e)] += e.dr || e.cr;
  }
  const after = before + sums.billed + sums.otherDr - sums.received - sums.tds - sums.adjusted;
  return { before, after, ...sums };
}

// How old the balance at `asOf` is: the latest debits are taken as unpaid
// first (payments go to the oldest bills). A balance from before the kept
// period counts as of its start.
function ledgerAgeing(l: RecoveryLedger, periodFrom: string, asOf: string, balance: number) {
  const out = { d0_30: 0, d31_90: 0, d91_180: 0, d181_365: 0, over365: 0 };
  let left = balance;
  if (left <= 0) return out;
  const put = (day: string, amt: number) => {
    const age = dayDiff(asOf, day);
    if (age <= 30) out.d0_30 += amt;
    else if (age <= 90) out.d31_90 += amt;
    else if (age <= 180) out.d91_180 += amt;
    else if (age <= 365) out.d181_365 += amt;
    else out.over365 += amt;
  };
  const debits = l.entries.filter((e) => e.dr > 0 && e.d <= asOf);
  for (let i = debits.length - 1; i >= 0 && left > 0; i--) {
    const take = Math.min(left, debits[i].dr);
    put(debits[i].d, take);
    left -= take;
  }
  if (left > 0) put(periodFrom, left);
  return out;
}

function figuresFor(ledgers: RecoveryLedger[], month: string, periodFrom: string, today: string): MonthFigures {
  const b = monthBounds(month);
  const to = b.to > today ? today : b.to;
  const from = b.from;
  const last90 = new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  const f: MonthFigures = {
    month,
    from,
    to,
    openingDue: 0,
    advances: 0,
    billed: 0,
    otherDebits: 0,
    received: 0,
    tds: 0,
    adjusted: 0,
    recovered: 0,
    closingDue: 0,
    recoveryPct: null,
    oldDuesRecovered: 0,
    ageing: { d0_30: 0, d31_90: 0, d91_180: 0, d181_365: 0, over365: 0 },
    over90: 0,
    daysToCollect: null,
  };
  let billed90 = 0;
  for (const l of ledgers) {
    const p = ledgerPeriod(l, from, to);
    if (p.before > 0) f.openingDue += p.before;
    else f.advances -= p.before;
    f.billed += p.billed;
    f.otherDebits += p.otherDr;
    f.received += p.received;
    f.tds += p.tds;
    f.adjusted += p.adjusted;
    if (p.after > 0) {
      f.closingDue += p.after;
      const a = ledgerAgeing(l, periodFrom, to, p.after);
      for (const k of Object.keys(a) as (keyof typeof a)[]) f.ageing[k] += a[k];
    }
    if (p.before > 0) f.oldDuesRecovered += Math.min(p.before, p.received + p.tds);
    for (const e of l.entries) if (e.dr > 0 && e.d >= last90 && e.d <= to && lineKind(e) === "billed") billed90 += e.dr;
  }
  f.recovered = f.received + f.tds;
  const base = f.openingDue + f.billed;
  f.recoveryPct = base > 0 ? Math.round((f.recovered / base) * 1000) / 10 : null;
  f.over90 = f.ageing.d91_180 + f.ageing.d181_365 + f.ageing.over365;
  f.daysToCollect = billed90 > 0 ? Math.round((f.closingDue / billed90) * 90) : null;
  for (const k of ["openingDue", "advances", "billed", "otherDebits", "received", "tds", "adjusted", "recovered", "closingDue", "oldDuesRecovered", "over90"] as const) {
    f[k] = round(f[k]);
  }
  for (const k of Object.keys(f.ageing) as (keyof MonthFigures["ageing"])[]) f.ageing[k] = round(f.ageing[k]);
  return f;
}

// The group right under Sundry Debtors that a ledger's group sits in
function topGroups(rootGroup: string, groups: { name: string; parent: string }[]) {
  const key = (s: string) => s.trim().toLowerCase();
  const parent = new Map(groups.map((g) => [key(g.name), g.parent]));
  return (group: string) => {
    let g = group;
    for (let i = 0; i < 50; i++) {
      const p = parent.get(key(g));
      if (!p || key(p) === key(rootGroup)) return p ? g : rootGroup;
      g = p;
    }
    return g;
  };
}

export interface ActionRow {
  id: string;
  name: string;
  group: string;
  due: number;
  over90: number;
  lastRecoveredDate: string | null;
  daysSinceRecovery: number | null;
  lastSentAt: string | null;
}

export interface Recovery {
  month: MonthFigures;
  trend: { month: string; billed: number; recovered: number; recoveryPct: number | null; closingDue: number }[];
  groups: { group: string; openingDue: number; billed: number; recovered: number; closingDue: number; over90: number; recoveryPct: number | null }[];
  actions: ActionRow[];
  followUp: { sent: number; paid: number; paidAmount: number };
}

export function recovery(input: RecoveryInput): Recovery {
  const today = input.today ?? istToday();
  const month = figuresFor(input.ledgers, input.month, input.periodFrom, today);

  // The last 12 months up to the chosen one (within the kept entries)
  const firstMonth = input.periodFrom.slice(0, 7);
  const trend: Recovery["trend"] = [];
  for (let i = 11; i >= 0; i--) {
    const m = addMonths(input.month, -i);
    if (m < firstMonth) continue;
    const f = i === 0 ? month : figuresFor(input.ledgers, m, input.periodFrom, today);
    trend.push({ month: m, billed: f.billed, recovered: f.recovered, recoveryPct: f.recoveryPct, closingDue: f.closingDue });
  }

  // By the groups right under Sundry Debtors (Tally's groups by who brings the client)
  const top = topGroups(input.rootGroup, input.groups);
  const byGroup = new Map<string, RecoveryLedger[]>();
  for (const l of input.ledgers) {
    const g = top(l.group);
    byGroup.set(g, [...(byGroup.get(g) ?? []), l]);
  }
  const groups = [...byGroup.entries()]
    .map(([group, ledgers]) => {
      const f = figuresFor(ledgers, input.month, input.periodFrom, today);
      return { group, openingDue: f.openingDue, billed: f.billed, recovered: f.recovered, closingDue: f.closingDue, over90: f.over90, recoveryPct: f.recoveryPct };
    })
    .sort((a, b) => b.closingDue - a.closingDue);

  // Whom to chase: dues at the end of the period, oldest money first
  const lastSent = new Map<string, string>();
  for (const s of input.sends ?? []) {
    const k = s.ledgerName.trim().toLowerCase();
    if (!lastSent.has(k) || lastSent.get(k)! < s.at) lastSent.set(k, s.at);
  }
  const actions: ActionRow[] = [];
  for (const l of input.ledgers) {
    const p = ledgerPeriod(l, month.from, month.to);
    if (p.after <= 0.5) continue;
    const a = ledgerAgeing(l, input.periodFrom, month.to, p.after);
    let last: string | null = null;
    for (const e of l.entries) {
      const k = lineKind(e);
      if ((k === "received" || k === "tds") && e.d <= month.to && (!last || e.d > last)) last = e.d;
    }
    actions.push({
      id: l.id,
      name: l.name,
      group: l.group,
      due: round(p.after),
      over90: round(a.d91_180 + a.d181_365 + a.over365),
      lastRecoveredDate: last,
      daysSinceRecovery: last ? dayDiff(month.to, last) : null,
      lastSentAt: lastSent.get(l.name.trim().toLowerCase()) ?? null,
    });
  }
  actions.sort((x, y) => y.over90 - x.over90 || y.due - x.due);

  // Ledgers sent on WhatsApp in the month, and how many paid within 15 days
  const firstSend = new Map<string, string>();
  for (const s of input.sends ?? []) {
    // The day in India
    const day = new Date(Date.parse(s.at) + 330 * 60_000).toISOString().slice(0, 10);
    if (day < month.from || day > month.to) continue;
    const k = s.ledgerName.trim().toLowerCase();
    if (!firstSend.has(k) || firstSend.get(k)! > day) firstSend.set(k, day);
  }
  let paid = 0;
  let paidAmount = 0;
  const byName = new Map(input.ledgers.map((l) => [l.name.trim().toLowerCase(), l]));
  for (const [k, day] of firstSend) {
    const l = byName.get(k);
    if (!l) continue;
    const until = new Date(Date.parse(`${day}T00:00:00Z`) + 15 * 86_400_000).toISOString().slice(0, 10);
    let amt = 0;
    for (const e of l.entries) {
      const kind = lineKind(e);
      if ((kind === "received" || kind === "tds") && e.d >= day && e.d <= until) amt += e.cr;
    }
    if (amt > 0) {
      paid++;
      paidAmount += amt;
    }
  }

  return { month, trend, groups, actions: actions.slice(0, 30), followUp: { sent: firstSend.size, paid, paidAmount: round(paidAmount) } };
}
