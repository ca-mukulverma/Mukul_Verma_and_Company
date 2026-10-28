import {
  addHeads,
  FORM_LABELS,
  Gstr2bRead,
  Gstr3bRead,
  GstRead,
  Heads,
  isNil,
  netSales,
  round2,
  SalesRead,
  SalesRows,
  subHeads,
  totalTax,
  ZERO,
} from "./types";

// The firm's GST working for one return period (a month, or a quarter of a
// QRMP filer), built from the files uploaded for it. Plain functions, so the
// same result is shown on screen, in the Excel/PDF and in the checks.

export interface DocRead {
  id: string;
  fileName: string;
  createdAt: string;
  read: GstRead;
}

export interface ItemInfo {
  status: string;
  filedAt: string | null;
  arn: string | null;
  dueDate: string;
  gstr1aFiled: boolean;
}

export interface PeriodInput {
  // First month ("2026-04") and every month of the period
  start: string;
  months: string[];
  quarterly: boolean;
  docs: DocRead[];
  gstr1: ItemInfo | null;
  gstr3b: ItemInfo | null;
}

export type RowKey =
  | "g1_b2b" | "g1_b2c" | "g1_amend" | "g1_cn" | "g1_dn" | "g1_free" | "g1_exp" | "g1_adv" | "g1_net"
  | "a_b2b" | "a_b2c" | "a_amend" | "a_cn" | "a_dn" | "a_free" | "a_exp" | "a_adv" | "a_net"
  | "net_after_1a" | "g3_sales" | "diff_sales"
  | "rcm_out" | "rcm_in" | "rcm_diff"
  | "itc_in" | "itc_rev" | "itc_net" | "itc_2b" | "itc_diff"
  | "inel_3b" | "inel_2b" | "inel_diff" | "rej_2b";

// The rows of the working, in the firm's format. "optional" rows are shown
// only when some period has a figure in them.
export const WORKING_ROWS: ({ key: RowKey; label: string; optional?: boolean; difference?: boolean } | { heading: string })[] = [
  { heading: "GSTR 1" },
  { key: "g1_b2b", label: "B2B SALES" },
  { key: "g1_b2c", label: "B2C SALES" },
  { key: "g1_amend", label: "AMENDMENTS" },
  { key: "g1_cn", label: "CREDIT NOTES" },
  { key: "g1_dn", label: "DEBIT NOTES" },
  { key: "g1_free", label: "TAX FREE" },
  { key: "g1_exp", label: "EXPORTS" },
  { key: "g1_adv", label: "ADVANCES (NET)", optional: true },
  { key: "g1_net", label: "NET SALES" },
  { heading: "GSTR 1A" },
  { key: "a_b2b", label: "B2B SALES" },
  { key: "a_b2c", label: "B2C SALES" },
  { key: "a_amend", label: "AMENDMENTS" },
  { key: "a_cn", label: "CREDIT NOTES" },
  { key: "a_dn", label: "DEBIT NOTES" },
  { key: "a_free", label: "TAX FREE" },
  { key: "a_exp", label: "EXPORTS" },
  { key: "a_adv", label: "ADVANCES (NET)", optional: true },
  { key: "a_net", label: "NET SALES" },
  { key: "net_after_1a", label: "TOTAL NET AFTER GSTR 1A" },
  { heading: "GSTR 3B" },
  { key: "g3_sales", label: "SALES" },
  { key: "diff_sales", label: "DIFFERENCE BETWEEN GSTR 1 ALONG WITH 1A AND GSTR 3B", difference: true },
  { heading: "RCM" },
  { key: "rcm_out", label: "RCM OUTPUT AS PER GSTR 3B" },
  { key: "rcm_in", label: "RCM INPUT AS PER GSTR 3B" },
  { key: "rcm_diff", label: "DIFFERENCE", difference: true },
  { heading: "INPUT" },
  { key: "itc_in", label: "INPUT AS PER GSTR 3B OTHER THAN RCM" },
  { key: "itc_rev", label: "REVERSAL" },
  { key: "itc_net", label: "NET ITC OTHER THAN RCM" },
  { key: "itc_2b", label: "ALLOWABLE ITC AS PER GSTR 2B OTHER THAN RCM" },
  { key: "itc_diff", label: "DIFFERENCE", difference: true },
  { heading: "INELIGIBLE ITC" },
  { key: "inel_3b", label: "INELIGIBLE ITC AS PER GSTR 3B (4D)" },
  { key: "inel_2b", label: "ITC NOT AVAILABLE AS PER GSTR 2B" },
  { key: "inel_diff", label: "DIFFERENCE", difference: true },
  { key: "rej_2b", label: "ITC REJECTED IN GSTR 2B", optional: true },
];

export type Severity = "difference" | "missing" | "check";
export interface Issue {
  severity: Severity;
  text: string;
}

export interface FileCheck {
  label: string;
  // "optional": not needed if that return wasn't filed (IFF, GSTR-1A)
  state: "ok" | "missing" | "optional";
  docId: string | null;
}

export interface PeriodResult {
  start: string;
  months: string[];
  quarterly: boolean;
  rows: Partial<Record<RowKey, Heads>>;
  issues: Issue[];
  files: FileCheck[];
  hasDifference: boolean;
  // Figures for the swing check and the reconciliation figures on the items
  netSales: number | null;
  netSalesTax: number | null;
  itcNet: number | null;
  creditNotes: number | null;
  nil: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const short = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1];
const rupees = (n: number) => `₹${round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The latest file of a kind (a file uploaded again replaces the older one)
function latest<T extends GstRead>(docs: DocRead[], match: (r: GstRead) => r is T): { doc: DocRead; read: T } | null {
  const found = docs.filter((d) => match(d.read)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return found ? { doc: found, read: found.read as T } : null;
}

const isSales = (forms: string[], source: string, month: string) => (r: GstRead): r is SalesRead =>
  forms.includes(r.form) && r.source === source && r.month === month;

function salesRowsOf(prefix: "g1" | "a", rows: SalesRows | null): Partial<Record<RowKey, Heads>> {
  if (!rows) return {};
  return {
    [`${prefix}_b2b`]: rows.b2b,
    [`${prefix}_b2c`]: rows.b2c,
    [`${prefix}_amend`]: rows.amendments,
    [`${prefix}_cn`]: rows.creditNotes,
    [`${prefix}_dn`]: rows.debitNotes,
    [`${prefix}_free`]: rows.taxFree,
    [`${prefix}_exp`]: rows.exports,
    [`${prefix}_adv`]: rows.advances,
    [`${prefix}_net`]: netSales(rows),
  } as Partial<Record<RowKey, Heads>>;
}

function addRows(a: SalesRows | null, b: SalesRows): SalesRows {
  if (!a) return b;
  return {
    b2b: addHeads(a.b2b, b.b2b),
    b2c: addHeads(a.b2c, b.b2c),
    amendments: addHeads(a.amendments, b.amendments),
    creditNotes: addHeads(a.creditNotes, b.creditNotes),
    debitNotes: addHeads(a.debitNotes, b.debitNotes),
    taxFree: addHeads(a.taxFree, b.taxFree),
    exports: addHeads(a.exports, b.exports),
    advances: addHeads(a.advances, b.advances),
  };
}

// "IGST ₹10, CGST ₹5" for the heads that differ
function headsText(h: Heads, withTaxable = true) {
  const parts: string[] = [];
  if (withTaxable && Math.abs(h.taxable) >= 1) parts.push(`taxable ${rupees(h.taxable)}`);
  if (Math.abs(h.igst) >= 1) parts.push(`IGST ${rupees(h.igst)}`);
  if (Math.abs(h.cgst) >= 1) parts.push(`CGST ${rupees(h.cgst)}`);
  if (Math.abs(h.sgst) >= 1) parts.push(`SGST ${rupees(h.sgst)}`);
  if (Math.abs(h.cess) >= 1) parts.push(`cess ${rupees(h.cess)}`);
  return parts.join(", ");
}

function daysLate(filedAt: string | null, due: string | null) {
  if (!filedAt || !due) return 0;
  return Math.round((Date.parse(filedAt) - Date.parse(due)) / 86_400_000);
}

// IFF and a QRMP filer's months: due on the 13th of the next month
function iffDue(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-13` : `${y}-${String(m + 1).padStart(2, "0")}-13`;
}

export function buildPeriod(input: PeriodInput): PeriodResult {
  const { docs, months, quarterly } = input;
  const last = months[months.length - 1];
  const issues: Issue[] = [];
  const files: FileCheck[] = [];
  const file = (label: string, found: { doc: DocRead } | null, optional = false) =>
    files.push({ label, state: found ? "ok" : optional ? "optional" : "missing", docId: found?.doc.id ?? null });

  // ── GSTR-1 (and IFF): the JSON for every row, the PDF for amendments ──
  let sales: SalesRows | null = null;
  let salesMonths = 0;
  for (const month of months) {
    const iff = quarterly && month !== last;
    const name = iff ? "IFF" : "GSTR-1";
    const json = latest(docs, isSales(["GSTR1", "IFF"], "JSON", month));
    const pdf = latest(docs, isSales(["GSTR1", "IFF"], "PDF", month));
    file(`${name} JSON${quarterly || months.length > 1 ? ` ${short(month)}` : ""}`, json, iff);
    file(`${name} PDF${quarterly || months.length > 1 ? ` ${short(month)}` : ""}`, pdf, iff);
    if (!json && !pdf) {
      if (!iff) issues.push({ severity: "missing", text: `${name} for ${monthLabel(month)} not uploaded` });
      else issues.push({ severity: "check", text: `No IFF for ${monthLabel(month)} uploaded (fine if no IFF was filed)` });
      continue;
    }
    let rows: SalesRows;
    if (json) {
      rows = { ...json.read.rows };
      if (pdf) {
        rows.amendments = pdf.read.rows.amendments;
        // The JSON and PDF must be the same return
        const fromJson = netSales({ ...rows, advances: ZERO });
        const fromPdf = netSales({ ...pdf.read.rows, advances: ZERO });
        const gap = subHeads(fromJson, fromPdf);
        if (!isNil(gap)) {
          issues.push({ severity: "check", text: `${name} JSON and PDF of ${monthLabel(month)} differ (${headsText(gap)}): upload the latest of both` });
        }
      } else {
        if (json.read.hasAmendments) issues.push({ severity: "missing", text: `${name} of ${monthLabel(month)} has amendments: upload its PDF for their effect` });
        rows.amendments = { ...ZERO };
      }
    } else {
      rows = pdf!.read.rows;
      if (!isNil(rows.creditNotes)) issues.push({ severity: "check", text: `${name} JSON of ${monthLabel(month)} not uploaded: credit and debit notes are shown net` });
    }
    if (pdf?.read.unbalanced) issues.push({ severity: "check", text: `${name} PDF of ${monthLabel(month)} doesn't add up to its own total: check the file` });
    sales = addRows(sales, rows);
    salesMonths++;

    // Late filing
    const filed = pdf?.read.filedAt ?? (iff ? null : input.gstr1?.filedAt ?? null);
    const late = daysLate(filed, iff ? iffDue(month) : input.gstr1?.dueDate ?? null);
    if (late > 0) issues.push({ severity: "check", text: `${name} of ${monthLabel(month)} filed ${late} day${late === 1 ? "" : "s"} late` });
  }

  // ── GSTR-1A (from its PDF; a quarterly filer's 1A is for the quarter) ──
  let oneA: SalesRows | null = null;
  for (const month of months) {
    const read = latest(docs, (r): r is SalesRead => r.form === "GSTR1A" && r.month === month);
    if (read) {
      oneA = addRows(oneA, read.read.rows);
      file(`GSTR-1A PDF${months.length > 1 ? ` ${short(month)}` : ""}`, read);
    }
  }
  if (!oneA && input.gstr1?.gstr1aFiled) {
    file("GSTR-1A PDF", null);
    issues.push({ severity: "missing", text: "GSTR-1A was filed: upload its PDF" });
  }

  // ── GSTR-3B ──
  const threeB = latest(docs, (r): r is Gstr3bRead => r.form === "GSTR3B" && r.month === last);
  file("GSTR-3B PDF", threeB);
  if (!threeB) issues.push({ severity: "missing", text: "GSTR-3B PDF not uploaded" });
  else {
    if (threeB.read.unread.length) issues.push({ severity: "check", text: `GSTR-3B tables not read: ${threeB.read.unread.join(", ")}` });
    const late = daysLate(threeB.read.filedAt ?? input.gstr3b?.filedAt ?? null, input.gstr3b?.dueDate ?? null);
    if (late > 0) issues.push({ severity: "check", text: `GSTR-3B filed ${late} day${late === 1 ? "" : "s"} late` });
  }

  // ── GSTR-2B: a QRMP filer's quarterly 2B, else each month's ──
  const twoBs: Gstr2bRead[] = [];
  let twoBMissing = false;
  const quarter2b = quarterly ? latest(docs, (r): r is Gstr2bRead => r.form === "GSTR2B" && r.quarterly && r.month === last && r.part !== "part") : null;
  for (const month of quarter2b ? [last] : months) {
    const summary = quarter2b ?? latest(docs, (r): r is Gstr2bRead => r.form === "GSTR2B" && r.month === month && r.part !== "part" && r.quarterly === false);
    file(`GSTR-2B${!quarter2b && months.length > 1 ? ` ${short(month)}` : ""}`, summary);
    if (!summary) {
      twoBMissing = true;
      const parts = docs.filter((d) => d.read.form === "GSTR2B" && d.read.month === month);
      issues.push({
        severity: "missing",
        text: parts.length ? `GSTR-2B of ${monthLabel(month)}: only part files uploaded; upload its summary file` : `GSTR-2B of ${monthLabel(month)} not uploaded`,
      });
      continue;
    }
    twoBs.push(summary.read);
    if (summary.read.part === "summary" && summary.read.fileCount) {
      const have = new Set(docs.filter((d) => d.read.form === "GSTR2B" && d.read.month === summary.read.month && (d.read as Gstr2bRead).part === "part").map((d) => (d.read as Gstr2bRead).partNo));
      const missing = Array.from({ length: summary.read.fileCount }, (_, i) => i + 1).filter((n) => !have.has(n));
      if (missing.length) issues.push({ severity: "check", text: `GSTR-2B of ${monthLabel(summary.read.month)}: part file${missing.length > 1 ? "s" : ""} ${missing.join(", ")} of ${summary.read.fileCount} not uploaded (totals are complete from the summary)` });
    }
  }

  // ── The rows ──
  const rows: Partial<Record<RowKey, Heads>> = {};
  Object.assign(rows, salesRowsOf("g1", sales), salesRowsOf("a", oneA));
  const g1Net = sales ? netSales(sales) : null;
  const aNet = oneA ? netSales(oneA) : null;
  if (g1Net || aNet) rows.net_after_1a = addHeads(g1Net, aNet);
  if (threeB) {
    const r = threeB.read;
    rows.g3_sales = addHeads(r.outward, r.zeroRated, r.nilExempt, r.nonGst);
    rows.rcm_out = r.rcmInward;
    rows.rcm_in = addHeads(r.itc.importServices, r.itc.rcm);
    rows.rcm_diff = subHeads({ ...rows.rcm_out, taxable: 0 }, rows.rcm_in);
    rows.itc_in = addHeads(r.itc.importGoods, r.itc.isd, r.itc.other);
    rows.itc_rev = addHeads(r.itc.reversedRules, r.itc.reversedOthers);
    rows.itc_net = subHeads(rows.itc_in, rows.itc_rev);
    rows.inel_3b = r.itc.ineligible;
  }
  if (twoBs.length && !twoBMissing) {
    rows.itc_2b = addHeads(...twoBs.map((b) => b.available));
    rows.inel_2b = addHeads(...twoBs.map((b) => b.unavailable));
    const rejected = addHeads(...twoBs.map((b) => b.rejected));
    if (!isNil(rejected, 0.01)) rows.rej_2b = rejected;
  }
  // A sales difference needs every GSTR-1 month (IFF months may be nil)
  const salesComplete = salesMonths > 0 && !issues.some((i) => i.severity === "missing" && /^GSTR-1 for/.test(i.text));
  if (rows.g3_sales && rows.net_after_1a && salesComplete) rows.diff_sales = subHeads(rows.g3_sales, rows.net_after_1a);
  if (rows.itc_net && rows.itc_2b) rows.itc_diff = subHeads(rows.itc_net, rows.itc_2b);
  if (rows.inel_3b && rows.inel_2b) rows.inel_diff = subHeads(rows.inel_3b, rows.inel_2b);

  // ── Differences ──
  const diffs: [RowKey, string][] = [
    ["diff_sales", "GSTR-3B sales differ from GSTR-1 (+1A)"],
    ["rcm_diff", "RCM paid (3.1d) differs from RCM ITC taken"],
    ["itc_diff", rows.itc_diff && totalTax(rows.itc_diff) > 0 ? "ITC claimed is more than GSTR-2B" : "ITC claimed is less than GSTR-2B"],
    ["inel_diff", "Ineligible ITC in 3B (4D) differs from ITC not available in 2B"],
  ];
  for (const [key, text] of diffs) {
    const d = rows[key];
    if (d && !isNil(d)) {
      issues.unshift({ severity: "difference", text: `${text}: ${headsText(d, key === "diff_sales")}` });
    }
  }

  return {
    start: input.start,
    months,
    quarterly,
    rows,
    issues,
    files,
    hasDifference: issues.some((i) => i.severity === "difference"),
    netSales: rows.net_after_1a?.taxable ?? null,
    netSalesTax: rows.net_after_1a ? totalTax(rows.net_after_1a) : null,
    itcNet: rows.itc_net ? totalTax(rows.itc_net) : null,
    creditNotes: rows.g1_cn ? rows.g1_cn.taxable + (rows.a_cn?.taxable ?? 0) : null,
    nil: !!threeB && isNil(addHeads(rows.g3_sales, rows.itc_net, rows.rcm_out), 0.01),
  };
}

// Sales, ITC or credit notes far from the average of the last 3 periods
export function swingIssues(series: PeriodResult[], percent: number) {
  const measures: [keyof PeriodResult, string][] = [
    ["netSales", "Sales"],
    ["itcNet", "ITC"],
    ["creditNotes", "Credit notes"],
  ];
  series.forEach((p, i) => {
    for (const [key, label] of measures) {
      const value = p[key] as number | null;
      if (value === null) continue;
      const before = series.slice(Math.max(0, i - 3), i).map((q) => q[key] as number | null).filter((v): v is number => v !== null);
      if (before.length === 0) continue;
      const average = before.reduce((s, v) => s + v, 0) / before.length;
      // Too little before to compare with
      if (Math.abs(average) < 1000) continue;
      const change = ((value - average) / Math.abs(average)) * 100;
      if (Math.abs(change) > percent) {
        p.issues.push({
          severity: "check",
          text: `${label} ${rupees(value)} is ${Math.round(Math.abs(change))}% ${change > 0 ? "above" : "below"} the average of the last ${before.length} period${before.length > 1 ? "s" : ""} (${rupees(average)})`,
        });
      }
    }
  });
}

export function sumRows(periods: PeriodResult[]): Partial<Record<RowKey, Heads>> {
  const total: Partial<Record<RowKey, Heads>> = {};
  for (const p of periods) {
    for (const [key, value] of Object.entries(p.rows) as [RowKey, Heads][]) total[key] = addHeads(total[key], value);
  }
  return total;
}

export const describeRead = (r: GstRead) => `${FORM_LABELS[r.form]} ${r.source} ${monthLabel(r.month)}${r.quarterly ? " (quarter)" : ""}`;
