import { GST_STATES } from "@/lib/gst-states";

// GSTR-1 and GSTR-2B JSON (as downloaded from the GST portal) laid out as
// Excel sheets, one sheet per section with the portal's names and columns
// (GSTR-1: the offline tool's Excel template; GSTR-2B: the portal's own 2B
// Excel). Plain data only: the browser writes the workbook (gst-excel-file.ts)
// and the tests check the rows. Nothing here touches the database or R2.

export type CellType = "text" | "amount" | "rate" | "date" | "number";
export type Cell = string | number | Date | null;

export interface Column {
  header: string;
  key: string;
  type?: CellType;
}

export interface SheetData {
  name: string;
  columns: Column[];
  rows: Record<string, Cell>[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-09" → "Sep 2026"
export const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
// "092026" → "2026-09"
export const periodMonth = (fp: string) => `${fp.slice(2)}-${fp.slice(0, 2)}`;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

// "05-09-2026" (portal) → a date; anything else stays text
function date(v: unknown): Date | string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : s;
}

// "27" → "27-Maharashtra", as the portal shows a place of supply
function pos(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const code = s.padStart(2, "0");
  return GST_STATES[code] ? `${code}-${GST_STATES[code]}` : s;
}

const yesNo = (v: unknown) => (v === "Y" ? "Y" : v === "N" ? "N" : str(v));

const TAX_COLUMNS: Column[] = [
  { header: "Integrated Tax", key: "igst", type: "amount" },
  { header: "Central Tax", key: "cgst", type: "amount" },
  { header: "State/UT Tax", key: "sgst", type: "amount" },
  { header: "Cess", key: "cess", type: "amount" },
];
const IGST_COLUMNS: Column[] = [
  { header: "Integrated Tax", key: "igst", type: "amount" },
  { header: "Cess", key: "cess", type: "amount" },
];

// An item's (or row's) amounts; GSTR-1 items keep them under itm_det
function amounts(source: Json, taxableKey = "txval") {
  const v = source?.itm_det ?? source ?? {};
  return {
    rate: num(v.rt),
    taxable: num(v[taxableKey]) ?? 0,
    igst: num(v.iamt ?? v.igst) ?? 0,
    cgst: num(v.camt ?? v.cgst) ?? 0,
    sgst: num(v.samt ?? v.sgst) ?? 0,
    cess: num(v.csamt ?? v.cess) ?? 0,
  };
}

// ─── GSTR-1 ─────────────────────────────────────────────────────────────────

const INVOICE_TYPES: Record<string, string> = {
  R: "Regular B2B",
  SEWP: "SEZ supplies with payment",
  SEWOP: "SEZ supplies without payment",
  DE: "Deemed Exp",
  CBW: "Intra-State supplies attracting IGST",
};
const NOTE_TYPES: Record<string, string> = { C: "Credit Note", D: "Debit Note" };
const EXPORT_TYPES: Record<string, string> = { WPAY: "WPAY", WOPAY: "WOPAY" };
const NIL_TYPES: Record<string, string> = {
  INTRB2B: "Inter-State supplies to registered persons",
  INTRAB2B: "Intra-State supplies to registered persons",
  INTRB2C: "Inter-State supplies to unregistered persons",
  INTRAB2C: "Intra-State supplies to unregistered persons",
};
const DOC_NATURES: Record<number, string> = {
  1: "Invoices for outward supply",
  2: "Invoices for inward supply from unregistered person",
  3: "Revised Invoice",
  4: "Debit Note",
  5: "Credit Note",
  6: "Receipt voucher",
  7: "Payment Voucher",
  8: "Refund voucher",
  9: "Delivery Challan for job work",
  10: "Delivery Challan for supply on approval",
  11: "Delivery Challan in case of liquid gas",
  12: "Delivery Challan in cases other than by way of supply (excluding at S no. 9 to 11)",
};

const RATE: Column = { header: "Rate", key: "rate", type: "rate" };
const TAXABLE: Column = { header: "Taxable Value", key: "taxable", type: "amount" };
const DIFF: Column = { header: "Applicable % of Tax Rate", key: "diff", type: "rate" };

interface Section {
  name: string;
  // The JSON's table
  table: string;
  columns: Column[];
  // Rows of one file; key: what makes a row the same in another file of the
  // same month (a re-download), so it isn't counted twice
  rows: (data: Json) => Record<string, Cell>[];
  key: (row: Record<string, Cell>) => string;
  // Counted in the summary as documents (invoices, notes) or as rows
  docKey?: (row: Record<string, Cell>) => string;
}

const k = (...parts: Cell[]) => parts.map((p) => (p instanceof Date ? p.toISOString().slice(0, 10) : String(p ?? ""))).join("|");

const items = (list: Json, base: Record<string, Cell>, taxableKey = "txval") =>
  (Array.isArray(list) && list.length ? list : [{}]).map((it: Json, i: number) => {
    const a = amounts(it, taxableKey);
    return { ...base, item: num(it?.num) ?? i + 1, rate: a.rate, taxable: a.taxable, igst: a.igst, cgst: a.cgst, sgst: a.sgst, cess: a.cess };
  });

const GSTR1_SECTIONS: Section[] = [
  {
    name: "b2b, sez, de",
    table: "b2b",
    columns: [
      { header: "GSTIN/UIN of Recipient", key: "ctin" },
      { header: "Invoice Number", key: "inum" },
      { header: "Invoice date", key: "idt", type: "date" },
      { header: "Invoice Value", key: "val", type: "amount" },
      { header: "Place Of Supply", key: "pos" },
      { header: "Reverse Charge", key: "rchrg" },
      DIFF,
      { header: "Invoice Type", key: "typ" },
      { header: "E-Commerce GSTIN", key: "etin" },
      RATE,
      TAXABLE,
      ...TAX_COLUMNS,
      { header: "IRN", key: "irn" },
      { header: "IRN date", key: "irndt", type: "date" },
    ],
    rows: (d) =>
      (d.b2b ?? []).flatMap((p: Json) =>
        (p.inv ?? []).flatMap((inv: Json) =>
          items(inv.itms, {
            ctin: str(p.ctin),
            inum: str(inv.inum),
            idt: date(inv.idt),
            val: num(inv.val),
            pos: pos(inv.pos),
            rchrg: yesNo(inv.rchrg),
            diff: num(inv.diff_percent),
            typ: INVOICE_TYPES[inv.inv_typ] ?? str(inv.inv_typ),
            etin: str(inv.etin),
            irn: str(inv.irn),
            irndt: date(inv.irngendate),
          })
        )
      ),
    key: (r) => k(r.ctin, r.inum, r.item, r.rate),
    docKey: (r) => k(r.ctin, r.inum),
  },
  {
    name: "b2ba",
    table: "b2ba",
    columns: [
      { header: "GSTIN/UIN of Recipient", key: "ctin" },
      { header: "Original Invoice Number", key: "oinum" },
      { header: "Original Invoice date", key: "oidt", type: "date" },
      { header: "Revised Invoice Number", key: "inum" },
      { header: "Revised Invoice date", key: "idt", type: "date" },
      { header: "Invoice Value", key: "val", type: "amount" },
      { header: "Place Of Supply", key: "pos" },
      { header: "Reverse Charge", key: "rchrg" },
      DIFF,
      { header: "Invoice Type", key: "typ" },
      { header: "E-Commerce GSTIN", key: "etin" },
      RATE,
      TAXABLE,
      ...TAX_COLUMNS,
    ],
    rows: (d) =>
      (d.b2ba ?? []).flatMap((p: Json) =>
        (p.inv ?? []).flatMap((inv: Json) =>
          items(inv.itms, {
            ctin: str(p.ctin),
            oinum: str(inv.oinum),
            oidt: date(inv.oidt),
            inum: str(inv.inum),
            idt: date(inv.idt),
            val: num(inv.val),
            pos: pos(inv.pos),
            rchrg: yesNo(inv.rchrg),
            diff: num(inv.diff_percent),
            typ: INVOICE_TYPES[inv.inv_typ] ?? str(inv.inv_typ),
            etin: str(inv.etin),
          })
        )
      ),
    key: (r) => k(r.ctin, r.oinum, r.inum, r.item, r.rate),
    docKey: (r) => k(r.ctin, r.inum),
  },
  {
    name: "b2cl",
    table: "b2cl",
    columns: [
      { header: "Invoice Number", key: "inum" },
      { header: "Invoice date", key: "idt", type: "date" },
      { header: "Invoice Value", key: "val", type: "amount" },
      { header: "Place Of Supply", key: "pos" },
      DIFF,
      RATE,
      TAXABLE,
      ...IGST_COLUMNS,
      { header: "E-Commerce GSTIN", key: "etin" },
    ],
    rows: (d) =>
      (d.b2cl ?? []).flatMap((p: Json) =>
        (p.inv ?? []).flatMap((inv: Json) =>
          items(inv.itms, { inum: str(inv.inum), idt: date(inv.idt), val: num(inv.val), pos: pos(p.pos), diff: num(inv.diff_percent), etin: str(inv.etin) })
        )
      ),
    key: (r) => k(r.inum, r.item, r.rate),
    docKey: (r) => k(r.inum),
  },
  {
    name: "b2cla",
    table: "b2cla",
    columns: [
      { header: "Original Invoice Number", key: "oinum" },
      { header: "Original Invoice date", key: "oidt", type: "date" },
      { header: "Original Place Of Supply", key: "pos" },
      { header: "Revised Invoice Number", key: "inum" },
      { header: "Revised Invoice date", key: "idt", type: "date" },
      { header: "Invoice Value", key: "val", type: "amount" },
      DIFF,
      RATE,
      TAXABLE,
      ...IGST_COLUMNS,
      { header: "E-Commerce GSTIN", key: "etin" },
    ],
    rows: (d) =>
      (d.b2cla ?? []).flatMap((p: Json) =>
        (p.inv ?? []).flatMap((inv: Json) =>
          items(inv.itms, {
            oinum: str(inv.oinum),
            oidt: date(inv.oidt),
            pos: pos(p.pos),
            inum: str(inv.inum),
            idt: date(inv.idt),
            val: num(inv.val),
            diff: num(inv.diff_percent),
            etin: str(inv.etin),
          })
        )
      ),
    key: (r) => k(r.oinum, r.inum, r.item, r.rate),
    docKey: (r) => k(r.inum),
  },
  {
    name: "b2cs",
    table: "b2cs",
    columns: [
      { header: "Type", key: "typ" },
      { header: "Place Of Supply", key: "pos" },
      DIFF,
      RATE,
      TAXABLE,
      ...TAX_COLUMNS,
      { header: "E-Commerce GSTIN", key: "etin" },
    ],
    rows: (d) =>
      (d.b2cs ?? []).map((r: Json) => {
        const a = amounts(r);
        return { typ: str(r.typ), pos: pos(r.pos), diff: num(r.diff_percent), rate: a.rate, taxable: a.taxable, igst: a.igst, cgst: a.cgst, sgst: a.sgst, cess: a.cess, etin: str(r.etin), supply: str(r.sply_ty) };
      }),
    key: (r) => k(r.typ, r.pos, r.supply, r.rate, r.diff, r.etin),
  },
  {
    name: "b2csa",
    table: "b2csa",
    columns: [
      { header: "Original Month", key: "omon" },
      { header: "Place Of Supply", key: "pos" },
      { header: "Type", key: "typ" },
      DIFF,
      RATE,
      TAXABLE,
      ...TAX_COLUMNS,
      { header: "E-Commerce GSTIN", key: "etin" },
    ],
    rows: (d) =>
      (d.b2csa ?? []).flatMap((r: Json) =>
        items(r.itms, { omon: /^\d{6}$/.test(String(r.omon ?? "")) ? monthName(periodMonth(String(r.omon))) : str(r.omon), pos: pos(r.pos), typ: str(r.typ), diff: num(r.diff_percent), etin: str(r.etin) })
      ),
    key: (r) => k(r.omon, r.pos, r.typ, r.rate, r.etin),
  },
  {
    name: "cdnr",
    table: "cdnr",
    columns: [
      { header: "GSTIN/UIN of Recipient", key: "ctin" },
      { header: "Note Number", key: "nt_num" },
      { header: "Note Date", key: "nt_dt", type: "date" },
      { header: "Note Type", key: "ntty" },
      { header: "Place Of Supply", key: "pos" },
      { header: "Reverse Charge", key: "rchrg" },
      { header: "Note Supply Type", key: "typ" },
      { header: "Note Value", key: "val", type: "amount" },
      DIFF,
      RATE,
      TAXABLE,
      ...TAX_COLUMNS,
      { header: "IRN", key: "irn" },
      { header: "IRN date", key: "irndt", type: "date" },
    ],
    rows: (d) =>
      (d.cdnr ?? []).flatMap((p: Json) =>
        (p.nt ?? []).flatMap((nt: Json) =>
          items(nt.itms, {
            ctin: str(p.ctin),
            nt_num: str(nt.nt_num),
            nt_dt: date(nt.nt_dt),
            ntty: NOTE_TYPES[nt.ntty] ?? str(nt.ntty),
            pos: pos(nt.pos),
            rchrg: yesNo(nt.rchrg),
            typ: INVOICE_TYPES[nt.inv_typ] ?? str(nt.inv_typ),
            val: num(nt.val),
            diff: num(nt.diff_percent),
            irn: str(nt.irn),
            irndt: date(nt.irngendate),
          })
        )
      ),
    key: (r) => k(r.ctin, r.nt_num, r.item, r.rate),
    docKey: (r) => k(r.ctin, r.nt_num),
  },
  {
    name: "cdnra",
    table: "cdnra",
    columns: [
      { header: "GSTIN/UIN of Recipient", key: "ctin" },
      { header: "Original Note Number", key: "ont_num" },
      { header: "Original Note Date", key: "ont_dt", type: "date" },
      { header: "Revised Note Number", key: "nt_num" },
      { header: "Revised Note Date", key: "nt_dt", type: "date" },
      { header: "Note Type", key: "ntty" },
      { header: "Place Of Supply", key: "pos" },
      { header: "Reverse Charge", key: "rchrg" },
      { header: "Note Supply Type", key: "typ" },
      { header: "Note Value", key: "val", type: "amount" },
      DIFF,
      RATE,
      TAXABLE,
      ...TAX_COLUMNS,
    ],
    rows: (d) =>
      (d.cdnra ?? []).flatMap((p: Json) =>
        (p.nt ?? []).flatMap((nt: Json) =>
          items(nt.itms, {
            ctin: str(p.ctin),
            ont_num: str(nt.ont_num),
            ont_dt: date(nt.ont_dt),
            nt_num: str(nt.nt_num),
            nt_dt: date(nt.nt_dt),
            ntty: NOTE_TYPES[nt.ntty] ?? str(nt.ntty),
            pos: pos(nt.pos),
            rchrg: yesNo(nt.rchrg),
            typ: INVOICE_TYPES[nt.inv_typ] ?? str(nt.inv_typ),
            val: num(nt.val),
            diff: num(nt.diff_percent),
          })
        )
      ),
    key: (r) => k(r.ctin, r.ont_num, r.nt_num, r.item, r.rate),
    docKey: (r) => k(r.ctin, r.nt_num),
  },
  {
    name: "cdnur",
    table: "cdnur",
    columns: [
      { header: "UR Type", key: "typ" },
      { header: "Note Number", key: "nt_num" },
      { header: "Note Date", key: "nt_dt", type: "date" },
      { header: "Note Type", key: "ntty" },
      { header: "Place Of Supply", key: "pos" },
      { header: "Note Value", key: "val", type: "amount" },
      DIFF,
      RATE,
      TAXABLE,
      ...IGST_COLUMNS,
    ],
    rows: (d) =>
      (d.cdnur ?? []).flatMap((nt: Json) =>
        items(nt.itms, { typ: str(nt.typ), nt_num: str(nt.nt_num), nt_dt: date(nt.nt_dt), ntty: NOTE_TYPES[nt.ntty] ?? str(nt.ntty), pos: pos(nt.pos), val: num(nt.val), diff: num(nt.diff_percent) })
      ),
    key: (r) => k(r.nt_num, r.item, r.rate),
    docKey: (r) => k(r.nt_num),
  },
  {
    name: "cdnura",
    table: "cdnura",
    columns: [
      { header: "UR Type", key: "typ" },
      { header: "Original Note Number", key: "ont_num" },
      { header: "Original Note Date", key: "ont_dt", type: "date" },
      { header: "Revised Note Number", key: "nt_num" },
      { header: "Revised Note Date", key: "nt_dt", type: "date" },
      { header: "Note Type", key: "ntty" },
      { header: "Place Of Supply", key: "pos" },
      { header: "Note Value", key: "val", type: "amount" },
      DIFF,
      RATE,
      TAXABLE,
      ...IGST_COLUMNS,
    ],
    rows: (d) =>
      (d.cdnura ?? []).flatMap((nt: Json) =>
        items(nt.itms, {
          typ: str(nt.typ),
          ont_num: str(nt.ont_num),
          ont_dt: date(nt.ont_dt),
          nt_num: str(nt.nt_num),
          nt_dt: date(nt.nt_dt),
          ntty: NOTE_TYPES[nt.ntty] ?? str(nt.ntty),
          pos: pos(nt.pos),
          val: num(nt.val),
          diff: num(nt.diff_percent),
        })
      ),
    key: (r) => k(r.ont_num, r.nt_num, r.item, r.rate),
    docKey: (r) => k(r.nt_num),
  },
  {
    name: "exp",
    table: "exp",
    columns: [
      { header: "Export Type", key: "typ" },
      { header: "Invoice Number", key: "inum" },
      { header: "Invoice date", key: "idt", type: "date" },
      { header: "Invoice Value", key: "val", type: "amount" },
      { header: "Port Code", key: "port" },
      { header: "Shipping Bill Number", key: "sbnum" },
      { header: "Shipping Bill Date", key: "sbdt", type: "date" },
      RATE,
      TAXABLE,
      ...IGST_COLUMNS,
      { header: "IRN", key: "irn" },
      { header: "IRN date", key: "irndt", type: "date" },
    ],
    rows: (d) =>
      (d.exp ?? []).flatMap((e: Json) =>
        (e.inv ?? []).flatMap((inv: Json) =>
          items(inv.itms, {
            typ: EXPORT_TYPES[e.exp_typ] ?? str(e.exp_typ),
            inum: str(inv.inum),
            idt: date(inv.idt),
            val: num(inv.val),
            port: str(inv.sbpcode),
            sbnum: str(inv.sbnum),
            sbdt: date(inv.sbdt),
            irn: str(inv.irn),
            irndt: date(inv.irngendate),
          })
        )
      ),
    key: (r) => k(r.inum, r.item, r.rate),
    docKey: (r) => k(r.inum),
  },
  {
    name: "expa",
    table: "expa",
    columns: [
      { header: "Export Type", key: "typ" },
      { header: "Original Invoice Number", key: "oinum" },
      { header: "Original Invoice date", key: "oidt", type: "date" },
      { header: "Revised Invoice Number", key: "inum" },
      { header: "Revised Invoice date", key: "idt", type: "date" },
      { header: "Invoice Value", key: "val", type: "amount" },
      { header: "Port Code", key: "port" },
      { header: "Shipping Bill Number", key: "sbnum" },
      { header: "Shipping Bill Date", key: "sbdt", type: "date" },
      RATE,
      TAXABLE,
      ...IGST_COLUMNS,
    ],
    rows: (d) =>
      (d.expa ?? []).flatMap((e: Json) =>
        (e.inv ?? []).flatMap((inv: Json) =>
          items(inv.itms, {
            typ: EXPORT_TYPES[e.exp_typ] ?? str(e.exp_typ),
            oinum: str(inv.oinum),
            oidt: date(inv.oidt),
            inum: str(inv.inum),
            idt: date(inv.idt),
            val: num(inv.val),
            port: str(inv.sbpcode),
            sbnum: str(inv.sbnum),
            sbdt: date(inv.sbdt),
          })
        )
      ),
    key: (r) => k(r.oinum, r.inum, r.item, r.rate),
    docKey: (r) => k(r.inum),
  },
  ...(["at", "ata", "txpd", "txpda"] as const).map(
    (table): Section => ({
      name: { at: "at", ata: "ata", txpd: "atadj", txpda: "atadja" }[table],
      table,
      columns: [
        ...(table === "ata" || table === "txpda" ? [{ header: "Original Month", key: "omon" }] : []),
        { header: "Place Of Supply", key: "pos" },
        DIFF,
        RATE,
        { header: table.startsWith("at") ? "Gross Advance Received" : "Gross Advance Adjusted", key: "taxable", type: "amount" },
        ...TAX_COLUMNS,
      ],
      rows: (d) =>
        (d[table] ?? []).flatMap((r: Json) =>
          items(
            r.itms,
            { omon: /^\d{6}$/.test(String(r.omon ?? "")) ? monthName(periodMonth(String(r.omon))) : str(r.omon), pos: pos(r.pos), diff: num(r.diff_percent), supply: str(r.sply_ty) },
            "ad_amt"
          )
        ),
      key: (r) => k(r.omon, r.pos, r.supply, r.rate),
    })
  ),
  {
    name: "exemp",
    table: "nil",
    columns: [
      { header: "Description", key: "desc" },
      { header: "Nil Rated Supplies", key: "nil", type: "amount" },
      { header: "Exempted(other than nil rated/non GST supply)", key: "expt", type: "amount" },
      { header: "Non-GST supplies", key: "ngsup", type: "amount" },
    ],
    rows: (d) =>
      (d.nil?.inv ?? []).map((r: Json) => ({ desc: NIL_TYPES[r.sply_ty] ?? str(r.sply_ty), nil: num(r.nil_amt) ?? 0, expt: num(r.expt_amt) ?? 0, ngsup: num(r.ngsup_amt) ?? 0 })),
    key: (r) => k(r.desc),
  },
  ...(
    [
      ["hsn", "data"],
      ["hsn(b2b)", "hsn_b2b"],
      ["hsn(b2c)", "hsn_b2c"],
    ] as const
  ).map(
    ([name, list]): Section => ({
      name,
      table: "hsn",
      columns: [
        { header: "HSN", key: "hsn" },
        { header: "Description", key: "desc" },
        { header: "UQC", key: "uqc" },
        { header: "Total Quantity", key: "qty", type: "number" },
        { header: "Total Value", key: "val", type: "amount" },
        RATE,
        TAXABLE,
        ...TAX_COLUMNS,
      ],
      rows: (d) =>
        (d.hsn?.[list] ?? []).map((r: Json) => {
          const a = amounts(r);
          return { hsn: str(r.hsn_sc), desc: str(r.desc ?? r.user_desc), uqc: str(r.uqc), qty: num(r.qty), val: num(r.val), rate: a.rate, taxable: a.taxable, igst: a.igst, cgst: a.cgst, sgst: a.sgst, cess: a.cess };
        }),
      key: (r) => k(r.hsn, r.desc, r.uqc, r.rate),
    })
  ),
  {
    name: "docs",
    table: "doc_issue",
    columns: [
      { header: "Nature of Document", key: "nature" },
      { header: "Sr. No. From", key: "from" },
      { header: "Sr. No. To", key: "to" },
      { header: "Total Number", key: "total", type: "number" },
      { header: "Cancelled", key: "cancel", type: "number" },
      { header: "Net Issued", key: "net", type: "number" },
    ],
    rows: (d) =>
      (d.doc_issue?.doc_det ?? []).flatMap((det: Json) =>
        (det.docs ?? []).map((r: Json) => ({
          nature: DOC_NATURES[Number(det.doc_num)] ?? str(det.doc_typ ?? det.doc_num),
          from: str(r.from),
          to: str(r.to),
          total: num(r.totnum),
          cancel: num(r.cancel),
          net: num(r.net_issue),
        }))
      ),
    key: (r) => k(r.nature, r.from, r.to),
  },
];

// Section totals (what the Summary sheet shows)
const SUMMARY_COLUMNS: Column[] = [
  { header: "Section", key: "section" },
  { header: "Documents / rows", key: "count", type: "number" },
  { header: "Taxable Value", key: "taxable", type: "amount" },
  ...TAX_COLUMNS,
];

function totalsOf(name: string, rows: Record<string, Cell>[], docKey?: (r: Record<string, Cell>) => string): Record<string, Cell> {
  const sum = (key: string) => Math.round(rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0) * 100) / 100;
  const taxable = rows.some((r) => typeof r.taxable === "number") ? sum("taxable") : sum("nil") + sum("expt") + sum("ngsup");
  return { section: name, count: docKey ? new Set(rows.map(docKey)).size : rows.length, taxable, igst: sum("igst"), cgst: sum("cgst"), sgst: sum("sgst"), cess: sum("cess") };
}

// One month's GSTR-1 from its JSON files, newest first (a big GSTR-1 comes in
// several files; a re-download repeats rows, which are kept once)
export function gstr1Sheets(files: Json[]): SheetData[] {
  const sheets: SheetData[] = [];
  const summary: Record<string, Cell>[] = [];
  for (const section of GSTR1_SECTIONS) {
    const rows: Record<string, Cell>[] = [];
    const seen = new Set<string>();
    for (const data of files) {
      const mine = section.rows(data ?? {});
      const keys = mine.map(section.key);
      mine.forEach((r, i) => !seen.has(keys[i]) && rows.push(r));
      keys.forEach((key) => seen.add(key));
    }
    if (!rows.length) continue;
    // "item" and "supply" only tell rows apart
    sheets.push({ name: section.name, columns: section.columns, rows });
    if (section.name !== "docs" && !section.name.startsWith("hsn")) summary.push(totalsOf(section.name, rows, section.docKey));
  }
  return [{ name: "Summary", columns: SUMMARY_COLUMNS, rows: summary }, ...sheets];
}

// ─── GSTR-2B ────────────────────────────────────────────────────────────────

const B2B_TYPES: Record<string, string> = { R: "Regular", SEZWP: "SEZ supplies with payment", SEZWOP: "SEZ supplies without payment", DE: "Deemed Exports", CBW: "Intra-State supplies attracting IGST" };
const SUPPLIER: Column[] = [
  { header: "GSTIN of supplier", key: "ctin" },
  { header: "Trade/Legal name", key: "trdnm" },
];
const FILING: Column[] = [
  { header: "GSTR-1/IFF/GSTR-5 Period", key: "supprd" },
  { header: "GSTR-1/IFF/GSTR-5 Filing Date", key: "supfildt", type: "date" },
  { header: "ITC Availability", key: "itcavl" },
  { header: "Reason", key: "rsn" },
  { header: "Applicable % of Tax Rate", key: "diff", type: "rate" },
  { header: "Source", key: "srctyp" },
  { header: "IRN", key: "irn" },
  { header: "IRN Date", key: "irndt", type: "date" },
];
const TAXES_2B: Column[] = [{ header: "Taxable Value", key: "taxable", type: "amount" }, ...TAX_COLUMNS];

// "092026" → "Sep 2026"
const prd = (v: unknown) => (/^\d{6}$/.test(String(v ?? "")) ? monthName(periodMonth(String(v))) : str(v));
const ITC_AVAILABLE: Record<string, string> = { Y: "Yes", N: "No", T: "Temporary" };

// A document's amounts: its own totals, else the sum of its items
function docAmounts(doc: Json) {
  if (["txval", "igst", "cgst", "sgst", "cess"].some((key) => num(doc?.[key]) != null)) {
    return { taxable: num(doc.txval) ?? 0, igst: num(doc.igst) ?? 0, cgst: num(doc.cgst) ?? 0, sgst: num(doc.sgst) ?? 0, cess: num(doc.cess) ?? 0 };
  }
  const list: Json[] = doc?.items ?? [];
  const add = (key: string) => list.reduce((s, it) => s + (num(it?.[key]) ?? 0), 0);
  return { taxable: add("txval"), igst: add("igst"), cgst: add("cgst"), sgst: add("sgst"), cess: add("cess") };
}

const filing = (party: Json, doc: Json) => ({
  supprd: prd(party.supprd),
  supfildt: date(party.supfildt),
  itcavl: ITC_AVAILABLE[doc.itcavl] ?? str(doc.itcavl),
  rsn: str(doc.rsn),
  diff: num(doc.diffprcnt),
  srctyp: str(doc.srctyp),
  irn: str(doc.irn),
  irndt: date(doc.irngendate),
});

interface Table2b {
  name: string;
  table: string;
  columns: Column[];
  rows: (list: Json[]) => Record<string, Cell>[];
  key: (r: Record<string, Cell>) => string;
}

const GSTR2B_TABLES: Table2b[] = [
  {
    name: "B2B",
    table: "b2b",
    columns: [
      ...SUPPLIER,
      { header: "Invoice number", key: "inum" },
      { header: "Invoice type", key: "typ" },
      { header: "Invoice Date", key: "dt", type: "date" },
      { header: "Invoice Value", key: "val", type: "amount" },
      { header: "Place of supply", key: "pos" },
      { header: "Supply Attract Reverse Charge", key: "rev" },
      ...TAXES_2B,
      ...FILING,
    ],
    rows: (list) =>
      list.flatMap((p) =>
        (p.inv ?? []).map((inv: Json) => ({
          ctin: str(p.ctin),
          trdnm: str(p.trdnm),
          inum: str(inv.inum),
          typ: B2B_TYPES[inv.typ] ?? str(inv.typ),
          dt: date(inv.dt),
          val: num(inv.val),
          pos: pos(inv.pos),
          rev: yesNo(inv.rev),
          ...docAmounts(inv),
          ...filing(p, inv),
        }))
      ),
    key: (r) => k(r.ctin, r.inum, r.dt),
  },
  {
    name: "B2BA",
    table: "b2ba",
    columns: [
      ...SUPPLIER,
      { header: "Original Invoice number", key: "oinum" },
      { header: "Original Invoice Date", key: "oidt", type: "date" },
      { header: "Invoice number", key: "inum" },
      { header: "Invoice type", key: "typ" },
      { header: "Invoice Date", key: "dt", type: "date" },
      { header: "Invoice Value", key: "val", type: "amount" },
      { header: "Place of supply", key: "pos" },
      { header: "Supply Attract Reverse Charge", key: "rev" },
      ...TAXES_2B,
      ...FILING,
    ],
    rows: (list) =>
      list.flatMap((p) =>
        (p.inv ?? []).map((inv: Json) => ({
          ctin: str(p.ctin),
          trdnm: str(p.trdnm),
          oinum: str(inv.oinum),
          oidt: date(inv.oidt),
          inum: str(inv.inum),
          typ: B2B_TYPES[inv.typ] ?? str(inv.typ),
          dt: date(inv.dt),
          val: num(inv.val),
          pos: pos(inv.pos),
          rev: yesNo(inv.rev),
          ...docAmounts(inv),
          ...filing(p, inv),
        }))
      ),
    key: (r) => k(r.ctin, r.oinum, r.inum),
  },
  {
    name: "B2B-CDNR",
    table: "cdnr",
    columns: [
      ...SUPPLIER,
      { header: "Note number", key: "ntnum" },
      { header: "Note type", key: "typ" },
      { header: "Note Supply type", key: "suptyp" },
      { header: "Note date", key: "dt", type: "date" },
      { header: "Note Value", key: "val", type: "amount" },
      { header: "Place of supply", key: "pos" },
      { header: "Supply Attract Reverse Charge", key: "rev" },
      ...TAXES_2B,
      ...FILING,
    ],
    rows: (list) =>
      list.flatMap((p) =>
        (p.nt ?? []).map((nt: Json) => ({
          ctin: str(p.ctin),
          trdnm: str(p.trdnm),
          ntnum: str(nt.ntnum),
          typ: NOTE_TYPES[nt.typ] ?? str(nt.typ),
          suptyp: B2B_TYPES[nt.suptyp] ?? str(nt.suptyp),
          dt: date(nt.dt),
          val: num(nt.val),
          pos: pos(nt.pos),
          rev: yesNo(nt.rev),
          ...docAmounts(nt),
          ...filing(p, nt),
        }))
      ),
    key: (r) => k(r.ctin, r.ntnum, r.typ),
  },
  {
    name: "B2B-CDNRA",
    table: "cdnra",
    columns: [
      ...SUPPLIER,
      { header: "Original Note type", key: "otyp" },
      { header: "Original Note number", key: "ontnum" },
      { header: "Original Note date", key: "ontdt", type: "date" },
      { header: "Note number", key: "ntnum" },
      { header: "Note type", key: "typ" },
      { header: "Note Supply type", key: "suptyp" },
      { header: "Note date", key: "dt", type: "date" },
      { header: "Note Value", key: "val", type: "amount" },
      { header: "Place of supply", key: "pos" },
      { header: "Supply Attract Reverse Charge", key: "rev" },
      ...TAXES_2B,
      ...FILING,
    ],
    rows: (list) =>
      list.flatMap((p) =>
        (p.nt ?? []).map((nt: Json) => ({
          ctin: str(p.ctin),
          trdnm: str(p.trdnm),
          otyp: NOTE_TYPES[nt.onttyp] ?? str(nt.onttyp),
          ontnum: str(nt.ontnum),
          ontdt: date(nt.ontdt),
          ntnum: str(nt.ntnum),
          typ: NOTE_TYPES[nt.typ] ?? str(nt.typ),
          suptyp: B2B_TYPES[nt.suptyp] ?? str(nt.suptyp),
          dt: date(nt.dt),
          val: num(nt.val),
          pos: pos(nt.pos),
          rev: yesNo(nt.rev),
          ...docAmounts(nt),
          ...filing(p, nt),
        }))
      ),
    key: (r) => k(r.ctin, r.ontnum, r.ntnum),
  },
  {
    name: "ISD",
    table: "isd",
    columns: [
      { header: "GSTIN of ISD", key: "ctin" },
      { header: "Trade/Legal name", key: "trdnm" },
      { header: "ISD Document type", key: "doctyp" },
      { header: "ISD Invoice number", key: "docnum" },
      { header: "ISD Invoice date", key: "docdt", type: "date" },
      { header: "Original Invoice Number", key: "oinvnum" },
      { header: "Original invoice date", key: "oinvdt", type: "date" },
      ...TAX_COLUMNS,
      { header: "ISD GSTR-6 Period", key: "supprd" },
      { header: "ISD GSTR-6 Filing Date", key: "supfildt", type: "date" },
      { header: "Eligibility of ITC", key: "itcelg" },
    ],
    rows: (list) =>
      list.flatMap((p) =>
        (p.doclist ?? []).map((doc: Json) => ({
          ctin: str(p.ctin),
          trdnm: str(p.trdnm),
          doctyp: str(doc.doctyp),
          docnum: str(doc.docnum),
          docdt: date(doc.docdt),
          oinvnum: str(doc.oinvnum),
          oinvdt: date(doc.oinvdt),
          ...docAmounts(doc),
          supprd: prd(p.supprd),
          supfildt: date(p.supfildt),
          itcelg: ITC_AVAILABLE[doc.itcelg] ?? str(doc.itcelg),
        }))
      ),
    key: (r) => k(r.ctin, r.docnum, r.doctyp),
  },
  {
    name: "ISDA",
    table: "isda",
    columns: [
      { header: "GSTIN of ISD", key: "ctin" },
      { header: "Trade/Legal name", key: "trdnm" },
      { header: "Original ISD Document type", key: "odoctyp" },
      { header: "Original ISD Invoice number", key: "odocnum" },
      { header: "Original ISD Invoice date", key: "odocdt", type: "date" },
      { header: "ISD Document type", key: "doctyp" },
      { header: "ISD Invoice number", key: "docnum" },
      { header: "ISD Invoice date", key: "docdt", type: "date" },
      ...TAX_COLUMNS,
      { header: "ISD GSTR-6 Period", key: "supprd" },
      { header: "ISD GSTR-6 Filing Date", key: "supfildt", type: "date" },
      { header: "Eligibility of ITC", key: "itcelg" },
    ],
    rows: (list) =>
      list.flatMap((p) =>
        (p.doclist ?? []).map((doc: Json) => ({
          ctin: str(p.ctin),
          trdnm: str(p.trdnm),
          odoctyp: str(doc.odoctyp),
          odocnum: str(doc.odocnum),
          odocdt: date(doc.odocdt),
          doctyp: str(doc.doctyp),
          docnum: str(doc.docnum),
          docdt: date(doc.docdt),
          ...docAmounts(doc),
          supprd: prd(p.supprd),
          supfildt: date(p.supfildt),
          itcelg: ITC_AVAILABLE[doc.itcelg] ?? str(doc.itcelg),
        }))
      ),
    key: (r) => k(r.ctin, r.odocnum, r.docnum),
  },
  {
    name: "IMPG",
    table: "impg",
    columns: [
      { header: "ICEGATE Reference Date", key: "refdt", type: "date" },
      { header: "Port Code", key: "portcode" },
      { header: "Bill of Entry Number", key: "boenum" },
      { header: "Bill of Entry Date", key: "boedt", type: "date" },
      { header: "Taxable Value", key: "taxable", type: "amount" },
      ...IGST_COLUMNS,
      { header: "Amended (Yes)", key: "isamd" },
      { header: "Received Date", key: "recdt", type: "date" },
    ],
    rows: (list) =>
      list.map((b: Json) => ({
        refdt: date(b.refdt),
        portcode: str(b.portcode),
        boenum: str(b.boenum),
        boedt: date(b.boedt),
        taxable: num(b.txval) ?? 0,
        igst: num(b.igst) ?? 0,
        cess: num(b.cess) ?? 0,
        isamd: yesNo(b.isamd),
        recdt: date(b.recdt),
      })),
    key: (r) => k(r.portcode, r.boenum, r.boedt),
  },
  {
    name: "IMPGSEZ",
    table: "impgsez",
    columns: [
      ...SUPPLIER,
      { header: "ICEGATE Reference Date", key: "refdt", type: "date" },
      { header: "Port Code", key: "portcode" },
      { header: "Bill of Entry Number", key: "boenum" },
      { header: "Bill of Entry Date", key: "boedt", type: "date" },
      { header: "Taxable Value", key: "taxable", type: "amount" },
      ...IGST_COLUMNS,
      { header: "Amended (Yes)", key: "isamd" },
      { header: "Received Date", key: "recdt", type: "date" },
    ],
    rows: (list) =>
      list.flatMap((p) =>
        (p.boe ?? []).map((b: Json) => ({
          ctin: str(p.ctin),
          trdnm: str(p.trdnm),
          refdt: date(b.refdt),
          portcode: str(b.portcode),
          boenum: str(b.boenum),
          boedt: date(b.boedt),
          taxable: num(b.txval) ?? 0,
          igst: num(b.igst) ?? 0,
          cess: num(b.cess) ?? 0,
          isamd: yesNo(b.isamd),
          recdt: date(b.recdt),
        }))
      ),
    key: (r) => k(r.ctin, r.portcode, r.boenum, r.boedt),
  },
];

// Any other table the 2B holds (e-commerce, new ones): its plain fields
function otherTable(name: string, list: Json[]): SheetData | null {
  const rows: Record<string, Cell>[] = [];
  const walk = (node: Json, inherited: Record<string, Cell>) => {
    const own: Record<string, Cell> = { ...inherited };
    const children: Json[][] = [];
    for (const [key, v] of Object.entries(node ?? {})) {
      if (Array.isArray(v)) children.push(v);
      else if (v == null || typeof v !== "object") own[key] = typeof v === "number" ? v : str(v);
    }
    if (children.length) for (const list of children) for (const child of list) walk(child, own);
    else rows.push(own);
  };
  for (const node of list) walk(node, {});
  if (!rows.length) return null;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return { name, columns: keys.map((key) => ({ header: key, key, type: rows.some((r) => typeof r[key] === "number") ? "amount" : "text" })), rows };
}

const SUMMARY_NAMES: Record<string, string> = {
  itcavl: "ITC Available",
  itcunavl: "ITC not available",
  itcrev: "ITC Reversal",
  itcRejected: "ITC Rejected",
  nonrevsup: "All other ITC - Supplies from registered persons",
  isdsup: "Inward Supplies from ISD",
  revsup: "Inward Supplies liable for reverse charge",
  imports: "Import of Goods",
  othersup: "Others",
  b2b: "B2B - Invoices",
  b2ba: "B2B - Invoices (Amendment)",
  cdnr: "B2B - Credit/Debit notes",
  cdnra: "B2B - Credit/Debit notes (Amendment)",
  isd: "ISD - Invoices",
  isda: "ISD - Invoices (Amendment)",
  impg: "IMPG - Import of goods from overseas",
  impga: "IMPG (Amendment)",
  impgsez: "IMPGSEZ - Import of goods from SEZ",
  impgseza: "IMPGSEZ (Amendment)",
  ecom: "ECO - Supplies through e-commerce operators",
  ecoma: "ECO (Amendment)",
};

// The 2B's own summary (itcsumm), every level with its amounts
function summary2b(summ: Json): Record<string, Cell>[] {
  const rows: Record<string, Cell>[] = [];
  const walk = (node: Json, path: string[]) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (["txval", "igst", "cgst", "sgst", "cess"].some((key) => num(node[key]) != null) && path.length) {
      rows.push({ section: path.join(" › "), taxable: num(node.txval), igst: num(node.igst) ?? 0, cgst: num(node.cgst) ?? 0, sgst: num(node.sgst) ?? 0, cess: num(node.cess) ?? 0 });
    }
    for (const [key, v] of Object.entries(node)) if (v && typeof v === "object" && !Array.isArray(v)) walk(v, [...path, SUMMARY_NAMES[key] ?? key]);
  };
  walk(summ, []);
  return rows;
}

const SUMMARY_2B_COLUMNS: Column[] = [{ header: "Heading", key: "section" }, { header: "Taxable Value", key: "taxable", type: "amount" }, ...TAX_COLUMNS];

// The 2B's data, whether the file wraps it in "data" or not
const body2b = (file: Json) => file?.data ?? file ?? {};

// One month's GSTR-2B: its whole file, or its summary and part files. files:
// newest first; the newest of each (whole, summary, each part) is used.
export function gstr2bSheets(files: { json: Json; part?: string | null; partNo?: number | null }[]): SheetData[] {
  // Which files: the newest whole file, else the newest summary with the
  // newest of each part
  const kind = (f: { json: Json; part?: string | null }) => {
    const d = body2b(f.json);
    return f.part ?? (d.itcsumm && d.docdata ? "whole" : d.itcsumm ? "summary" : "part");
  };
  const newest = new Map<string, Json>();
  for (const f of files) {
    const key = kind(f) === "part" ? `part ${f.partNo ?? newest.size}` : kind(f);
    if (!newest.has(key)) newest.set(key, body2b(f.json));
  }
  const whole = newest.get("whole");
  const summaryFile = whole ?? newest.get("summary");
  const docFiles = whole ? [whole] : [...newest.entries()].filter(([key]) => key.startsWith("part")).map(([, d]) => d);

  const summaryRows = summaryFile?.itcsumm ? summary2b(summaryFile.itcsumm) : [];
  const sheets: SheetData[] = summaryRows.length ? [{ name: "Summary", columns: SUMMARY_2B_COLUMNS, rows: summaryRows }] : [];
  // Documents of ITC available (docdata) and rejected (docRejdata)
  for (const [source, suffix] of [
    ["docdata", ""],
    ["docRejdata", " (rejected)"],
  ] as const) {
    const tables = new Map<string, Json[]>();
    for (const d of docFiles) for (const [table, list] of Object.entries(d?.[source] ?? {})) if (Array.isArray(list)) tables.set(table, [...(tables.get(table) ?? []), ...list]);
    for (const t of GSTR2B_TABLES) {
      const list = tables.get(t.table);
      tables.delete(t.table);
      if (!list?.length) continue;
      const seen = new Set<string>();
      const rows = t.rows(list).filter((r) => {
        const key = t.key(r);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      sheets.push({ name: `${t.name}${suffix}`, columns: t.columns, rows });
    }
    for (const [table, list] of tables) {
      const sheet = otherTable(`${table.toUpperCase()}${suffix}`, list);
      if (sheet) sheets.push(sheet);
    }
  }
  return sheets;
}

// ─── Several months ─────────────────────────────────────────────────────────

// A year's workbook: each month's sheets one under another, with the month
// first; a sheet missing in a month is just absent from it
export function yearSheets(months: { month: string; sheets: SheetData[] }[]): SheetData[] {
  const order: string[] = [];
  const merged = new Map<string, SheetData>();
  for (const { month, sheets } of months) {
    for (const sheet of sheets) {
      let target = merged.get(sheet.name);
      if (!target) {
        target = { name: sheet.name, columns: [{ header: "Month", key: "__month" }], rows: [] };
        merged.set(sheet.name, target);
        order.push(sheet.name);
      }
      for (const c of sheet.columns) if (!target.columns.some((t) => t.key === c.key)) target.columns.push(c);
      for (const r of sheet.rows) target.rows.push({ __month: monthName(month), ...r });
    }
  }
  return order.map((name) => merged.get(name)!);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
