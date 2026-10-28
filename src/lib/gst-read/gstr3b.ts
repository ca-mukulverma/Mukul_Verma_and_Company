import { Gstr3bRead, Heads, ZERO } from "./types";
import { amountsAfter, findLine, isoDate, monthOfPeriod } from "./pdf-lines";

// GSTR-3B: the filed PDF from the portal. Each table row is found by its
// label; its amounts are on the same line or just after (long labels wrap).

export function isGstr3bPdf(lines: string[]) {
  return lines.slice(0, 6).some((l) => /Form GSTR-3B/i.test(l));
}

const outwardRow = (a: number[] | null): Heads | null =>
  a && a.length >= 5 ? { taxable: a[a.length - 5], igst: a[a.length - 4], cgst: a[a.length - 3], sgst: a[a.length - 2], cess: a[a.length - 1] } : null;

const itcRow = (a: number[] | null): Heads | null =>
  a && a.length >= 4 ? { taxable: 0, igst: a[a.length - 4], cgst: a[a.length - 3], sgst: a[a.length - 2], cess: a[a.length - 1] } : null;

export function readGstr3bPdf(lines: string[]): Gstr3bRead | null {
  const head = lines.slice(0, 14).join("\n");
  const fy = head.match(/^Year\s+(\d{4}-\d{2})/m)?.[1];
  const period = head.match(/^Period\s+([A-Za-z]+(?:\s*[-–]\s*[A-Za-z]+)?)/m)?.[1];
  const gstin = head.match(/GSTIN of the supplier\s+(\d{2}[A-Z0-9]{13})/)?.[1];
  const when = fy && period ? monthOfPeriod(fy, period) : null;
  if (!when || !gstin) return null;

  const unread: string[] = [];
  // Rows are looked for in order, each after the previous one
  let from = 0;
  const row = (label: string, pattern: RegExp, read: (a: number[] | null) => Heads | null, min: number): Heads => {
    const at = findLine(lines, pattern, from);
    const value = at >= 0 ? read(amountsAfter(lines, at, min)) : null;
    if (at >= 0) from = at + 1;
    if (!value) {
      unread.push(label);
      return { ...ZERO };
    }
    return value;
  };

  const outward = row("3.1(a)", /^\(a\) Outward taxable supplies \(other than zero rated/i, outwardRow, 5);
  const zeroRated = row("3.1(b)", /^\(b\) Outward taxable supplies \(zero rated\)/i, outwardRow, 5);
  const nilExempt = row("3.1(c)", /^\(c\s*\) Other outward supplies/i, outwardRow, 5);
  const rcmInward = row("3.1(d)", /^\(d\) Inward supplies \(liable to reverse charge\)/i, outwardRow, 5);
  const nonGst = row("3.1(e)", /^\(e\) Non-GST outward supplies/i, outwardRow, 5);
  from = Math.max(from, findLine(lines, /^4\.\s*Eligible ITC/i, from));
  const importGoods = row("4A(1)", /^\(1\) Import of goods/i, itcRow, 4);
  const importServices = row("4A(2)", /^\(2\) Import of services/i, itcRow, 4);
  const rcm = row("4A(3)", /^\(3\) Inward supplies liable to reverse charge/i, itcRow, 4);
  const isd = row("4A(4)", /^\(4\) Inward supplies from ISD/i, itcRow, 4);
  const other = row("4A(5)", /^\(5\) All other ITC/i, itcRow, 4);
  const reversedRules = row("4B(1)", /^\(1\) As per rules 38/i, itcRow, 4);
  const reversedOthers = row("4B(2)", /^\(2\) Others/i, itcRow, 4);
  const net = row("4C", /^C\. Net ITC available/i, itcRow, 4);
  const ineligible = row("4D(2)", /^\(2\) Ineligible ITC/i, itcRow, 4);

  return {
    form: "GSTR3B",
    source: "PDF",
    gstin,
    month: when.month,
    quarterly: when.quarterly,
    arn: head.match(/2\(c\)\.?\s*ARN\s+([A-Z0-9]{10,20})/)?.[1] ?? null,
    filedAt: isoDate(head.match(/Date of ARN\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1]),
    outward,
    zeroRated,
    nilExempt,
    rcmInward,
    nonGst,
    itc: { importGoods, importServices, rcm, isd, other, reversedRules, reversedOthers, net, ineligible },
    unread,
  };
}
