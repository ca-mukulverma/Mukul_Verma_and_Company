// Figures read from GST return files downloaded from the portal (see
// docs/GST_WORKING.md). Plain data, so the same shapes are used in the
// browser (which reads the files) and on the server (which builds the working).

// Taxable value and tax by head. ITC tables have no taxable value (0).
export interface Heads {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

// GSTR-1, IFF and GSTR-1A, in the rows of the firm's working
export interface SalesRows {
  b2b: Heads;
  b2c: Heads;
  amendments: Heads;
  creditNotes: Heads;
  debitNotes: Heads;
  taxFree: Heads;
  exports: Heads;
  // Advances received less advances adjusted (table 11); usually nil
  advances: Heads;
}

export const SALES_ROWS = ["b2b", "b2c", "amendments", "creditNotes", "debitNotes", "taxFree", "exports", "advances"] as const;
export type SalesRow = (typeof SALES_ROWS)[number];

interface ReadBase {
  gstin: string;
  // The month the file is for ("2026-06"); a quarterly return's last month
  month: string;
  // GSTR-3B and GSTR-2B of a quarterly (QRMP) filer cover the whole quarter
  quarterly: boolean;
  arn: string | null;
  // "2026-07-20"
  filedAt: string | null;
}

export interface SalesRead extends ReadBase {
  form: "GSTR1" | "IFF" | "GSTR1A";
  source: "JSON" | "PDF";
  rows: SalesRows;
  // PDF: credit and debit notes come netted off, all in creditNotes
  notesNetted: boolean;
  // JSON: amendment tables are present, but their difference is only in the PDF
  hasAmendments: boolean;
  // PDF: the rows didn't add up to the PDF's own total liability
  unbalanced: boolean;
}

export interface Gstr3bRead extends ReadBase {
  form: "GSTR3B";
  source: "PDF";
  outward: Heads; // 3.1(a)
  zeroRated: Heads; // 3.1(b)
  nilExempt: Heads; // 3.1(c)
  rcmInward: Heads; // 3.1(d)
  nonGst: Heads; // 3.1(e)
  itc: {
    importGoods: Heads; // 4A(1)
    importServices: Heads; // 4A(2)
    rcm: Heads; // 4A(3)
    isd: Heads; // 4A(4)
    other: Heads; // 4A(5)
    reversedRules: Heads; // 4B(1)
    reversedOthers: Heads; // 4B(2)
    net: Heads; // 4C
    ineligible: Heads; // 4D(2)
  };
  // Labels of tables that couldn't be read (the file is then flagged)
  unread: string[];
}

export interface Gstr2bRead extends ReadBase {
  form: "GSTR2B";
  source: "JSON";
  // A large 2B comes as a summary file plus part files with the documents
  part: "whole" | "summary" | "part";
  // Summary: how many part files there are; part: its number
  fileCount: number | null;
  partNo: number | null;
  // Summary figures (null in a part file)
  available: Heads | null; // ITC available other than reverse charge, after credit notes
  rcm: Heads | null;
  unavailable: Heads | null;
  rejected: Heads | null;
}

export type GstRead = SalesRead | Gstr3bRead | Gstr2bRead;

export const ZERO: Heads = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
const KEYS = ["taxable", "igst", "cgst", "sgst", "cess"] as const;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function addHeads(...list: (Heads | null | undefined)[]): Heads {
  const out = { ...ZERO };
  for (const h of list) if (h) for (const k of KEYS) out[k] = round2(out[k] + (h[k] ?? 0));
  return out;
}

export function subHeads(a: Heads, b: Heads): Heads {
  const out = { ...ZERO };
  for (const k of KEYS) out[k] = round2(a[k] - b[k]);
  return out;
}

export const totalTax = (h: Heads) => round2(h.igst + h.cgst + h.sgst + h.cess);

// Differences under a rupee are rounding
export const isNil = (h: Heads, tolerance = 1) => KEYS.every((k) => Math.abs(h[k]) < tolerance);

export function emptySales(): SalesRows {
  return { b2b: { ...ZERO }, b2c: { ...ZERO }, amendments: { ...ZERO }, creditNotes: { ...ZERO }, debitNotes: { ...ZERO }, taxFree: { ...ZERO }, exports: { ...ZERO }, advances: { ...ZERO } };
}

// Net sales of a return: everything, credit notes taken off
export function netSales(rows: SalesRows): Heads {
  return subHeads(addHeads(rows.b2b, rows.b2c, rows.amendments, rows.debitNotes, rows.taxFree, rows.exports, rows.advances), rows.creditNotes);
}

export const FORM_LABELS: Record<GstRead["form"], string> = {
  GSTR1: "GSTR-1",
  IFF: "IFF",
  GSTR1A: "GSTR-1A",
  GSTR3B: "GSTR-3B",
  GSTR2B: "GSTR-2B",
};
