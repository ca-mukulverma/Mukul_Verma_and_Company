import { addHeads, emptySales, Heads, round2, SalesRead, SalesRows, subHeads, ZERO } from "./types";
import { amountsAfter, findLine, isoDate, monthOfPeriod } from "./pdf-lines";

// GSTR-1, IFF and GSTR-1A: the JSON downloaded from the portal (every invoice)
// and the filed PDF (table totals). The JSON splits credit and debit notes;
// only the PDF has the difference made by amendments.

type Num = number | undefined;
interface ItemValues {
  txval?: Num;
  iamt?: Num;
  camt?: Num;
  samt?: Num;
  csamt?: Num;
  ad_amt?: Num;
}

const heads = (v: ItemValues): Heads => ({
  taxable: v.txval ?? v.ad_amt ?? 0,
  igst: v.iamt ?? 0,
  cgst: v.camt ?? 0,
  sgst: v.samt ?? 0,
  cess: v.csamt ?? 0,
});

const itemsTotal = (items: { itm_det?: ItemValues }[] | undefined) =>
  addHeads(...(items ?? []).map((i) => heads(i.itm_det ?? (i as ItemValues))));

const EXPORT_TYPES = new Set(["SEWP", "SEWOP", "DE"]);
const AMENDMENT_TABLES = ["b2ba", "b2cla", "b2csa", "cdnra", "cdnura", "expa", "ata", "txpda"];

/* eslint-disable @typescript-eslint/no-explicit-any */
export function isGstr1Json(data: any): boolean {
  return !!data && typeof data === "object" && /^(0[1-9]|1[0-2])20\d{2}$/.test(data.fp ?? "") && typeof data.gstin === "string";
}

export function readGstr1Json(data: any, fileName: string): SalesRead {
  const rows = emptySales();
  for (const party of data.b2b ?? []) {
    for (const inv of party.inv ?? []) {
      const value = itemsTotal(inv.itms);
      if (EXPORT_TYPES.has(inv.inv_typ)) rows.exports = addHeads(rows.exports, value);
      else rows.b2b = addHeads(rows.b2b, value);
    }
  }
  for (const place of data.b2cl ?? []) for (const inv of place.inv ?? []) rows.b2c = addHeads(rows.b2c, itemsTotal(inv.itms));
  rows.b2c = addHeads(rows.b2c, itemsTotal(data.b2cs));
  for (const exp of data.exp ?? []) for (const inv of exp.inv ?? []) rows.exports = addHeads(rows.exports, itemsTotal(inv.itms));
  const notes = [...(data.cdnr ?? []).flatMap((p: any) => p.nt ?? []), ...(data.cdnur ?? [])];
  for (const note of notes) {
    const value = itemsTotal(note.itms);
    if (note.ntty === "D") rows.debitNotes = addHeads(rows.debitNotes, value);
    else rows.creditNotes = addHeads(rows.creditNotes, value);
  }
  for (const n of data.nil?.inv ?? []) {
    rows.taxFree = addHeads(rows.taxFree, { ...ZERO, taxable: (n.nil_amt ?? 0) + (n.expt_amt ?? 0) + (n.ngsup_amt ?? 0) });
  }
  rows.advances = subHeads(itemsTotal((data.at ?? []).flatMap((a: any) => a.itms ?? [])), itemsTotal((data.txpd ?? []).flatMap((a: any) => a.itms ?? [])));

  const fp: string = data.fp;
  const monthNo = Number(fp.slice(0, 2));
  const quarterly = data.filing_typ === "Q";
  const form = /r1a|gstr-?1a/i.test(fileName) ? "GSTR1A" : quarterly && ![3, 6, 9, 12].includes(monthNo) ? "IFF" : "GSTR1";
  return {
    form,
    source: "JSON",
    gstin: String(data.gstin).toUpperCase(),
    month: `${fp.slice(2)}-${fp.slice(0, 2)}`,
    quarterly: false,
    arn: null,
    filedAt: null,
    rows,
    notesNetted: false,
    hasAmendments: AMENDMENT_TABLES.some((t) => Array.isArray(data[t]) && data[t].length > 0),
    unbalanced: false,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Amounts of a PDF row: value, IGST, CGST, SGST, cess (or value, IGST, cess
// for inter-state tables; value only for nil-rated)
function toHeads(amounts: number[] | null): Heads {
  if (!amounts) return { ...ZERO };
  if (amounts.length >= 5) {
    const [taxable, igst, cgst, sgst, cess] = amounts.slice(-5);
    return { taxable, igst, cgst, sgst, cess };
  }
  if (amounts.length === 3) return { ...ZERO, taxable: amounts[0], igst: amounts[1], cess: amounts[2] };
  return { ...ZERO, taxable: amounts[0] };
}

type Part = "b2b" | "b2bRcm" | "b2c" | "exports" | "taxFree" | "amend" | "notes" | "notesAmend" | "advIn" | "advOut" | "advInAmend" | "advOutAmend" | "end";

const SECTIONS: [RegExp, Part][] = [
  [/^4A\s*[-–]/, "b2b"],
  [/^4B\s*[-–]/, "b2bRcm"],
  [/^5\s*[-–]/, "b2c"],
  [/^6[ABC]\s*[-–]/, "exports"],
  [/^7\s*[-–]/, "b2c"],
  [/^8\s*[-–]/, "taxFree"],
  [/^9A\s*[-–]/, "amend"],
  [/^9B\s*[-–]/, "notes"],
  [/^9C\s*[-–]/, "notesAmend"],
  [/^10\s*[-–]/, "amend"],
  [/^11A\(1\)/, "advIn"],
  [/^11B\(1\)/, "advOut"],
  [/^11A\s*[-–]/, "advInAmend"],
  [/^11B\s*[-–]/, "advOutAmend"],
  [/^1[2-5]A?\s*(\([IV]+\)\s*)?[-–]/, "end"],
];

// Which line of a section holds its figures
const VALUE_LINE: Record<Exclude<Part, "end">, RegExp> = {
  b2b: /^Total\b/,
  b2bRcm: /^Total\b/,
  b2c: /^Total\b/,
  exports: /^Total\b/,
  taxFree: /^Total\b/,
  amend: /^Net differential amount/i,
  notes: /^Total - Net off/i,
  notesAmend: /^Net differential amount/i,
  advIn: /^Total\b/,
  advOut: /^Total\b/,
  advInAmend: /^Total\b/,
  advOutAmend: /^Total\b/,
};

export function isSalesPdf(lines: string[]) {
  return lines.slice(0, 6).some((l) => /FORM GSTR-1A?\b|Invoice Furnishing Facility/i.test(l));
}

export function readSalesPdf(lines: string[]): SalesRead | null {
  const head = lines.slice(0, 12).join("\n");
  const form = /GSTR-1A/i.test(head) ? "GSTR1A" : /Invoice Furnishing Facility/i.test(head) ? "IFF" : "GSTR1";
  const fy = head.match(/^Financial year\s+(\d{4}-\d{2})/im)?.[1];
  const period = head.match(/^Tax period\s+([A-Za-z]+(?:\s*[-–]\s*[A-Za-z]+)?)/im)?.[1];
  const gstin = head.match(/GSTIN\s+(\d{2}[A-Z0-9]{13})/)?.[1];
  const when = fy && period ? monthOfPeriod(fy, period) : null;
  if (!when || !gstin) return null;

  const parts: Record<Exclude<Part, "end">, Heads> = {
    b2b: { ...ZERO }, b2bRcm: { ...ZERO }, b2c: { ...ZERO }, exports: { ...ZERO }, taxFree: { ...ZERO }, amend: { ...ZERO },
    notes: { ...ZERO }, notesAmend: { ...ZERO }, advIn: { ...ZERO }, advOut: { ...ZERO }, advInAmend: { ...ZERO }, advOutAmend: { ...ZERO },
  };
  let current: Exclude<Part, "end"> | null = null;
  let taken = false;
  for (let i = 0; i < lines.length; i++) {
    const section = SECTIONS.find(([re]) => re.test(lines[i]));
    if (section) {
      if (section[1] === "end") break;
      current = section[1];
      taken = false;
      continue;
    }
    if (!current || taken || !VALUE_LINE[current].test(lines[i])) continue;
    parts[current] = addHeads(parts[current], toHeads(amountsAfter(lines, i)));
    taken = true;
  }

  const notesNet = addHeads(parts.notes);
  const rows: SalesRows = {
    ...emptySales(),
    b2b: addHeads(parts.b2b, parts.b2bRcm),
    b2c: parts.b2c,
    exports: parts.exports,
    taxFree: parts.taxFree,
    amendments: addHeads(parts.amend, parts.notesAmend),
    // Netted (debit notes – credit notes) in the PDF: kept as net credit notes
    creditNotes: subHeads(ZERO, notesNet),
    advances: subHeads(addHeads(parts.advIn, parts.advInAmend), addHeads(parts.advOut, parts.advOutAmend)),
  };

  // The PDF's own total liability (other than reverse charge) checks the reading
  const total = findLine(lines, /^Total Liability \(Outward supplies other than Reverse charge\)/i);
  let unbalanced = false;
  if (total >= 0) {
    const stated = toHeads(amountsAfter(lines, total, 5));
    const read = addHeads(parts.b2b, parts.b2c, parts.exports, parts.amend, parts.notes, parts.notesAmend, parts.advIn, parts.advInAmend);
    const minusAdjusted = subHeads(read, addHeads(parts.advOut, parts.advOutAmend));
    unbalanced = Math.abs(round2(minusAdjusted.taxable - stated.taxable)) >= 1 && Math.abs(round2(read.taxable - stated.taxable)) >= 1;
  }

  return {
    form,
    source: "PDF",
    gstin,
    month: when.month,
    quarterly: false,
    arn: head.match(/\(c\)\s*ARN\s+([A-Z0-9]{10,20})/)?.[1] ?? null,
    filedAt: isoDate(head.match(/ARN date\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1]),
    rows,
    notesNetted: true,
    hasAmendments: Math.abs(rows.amendments.taxable) >= 0.01,
    unbalanced,
  };
}
