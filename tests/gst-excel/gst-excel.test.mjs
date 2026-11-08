import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import ExcelJS from "exceljs";

// GSTR-1 / GSTR-2B JSON → Excel sheets (src/lib/gst-excel.ts) and the
// workbook the browser writes (src/components/compliance/gst-excel-file.ts),
// with JSON shaped as the portal sends it. Run: node --test tests/gst-excel/gst-excel.test.mjs

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(root, "src") } });
const { gstr1Sheets, gstr2bSheets, yearSheets } = await jiti.import(path.join(root, "src/lib/gst-excel.ts"));
const { workbook } = await jiti.import(path.join(root, "src/components/compliance/gst-excel-file.ts"));

const gstr1 = {
  gstin: "23AAFFC2640H1ZX",
  fp: "092026",
  b2b: [
    {
      ctin: "27AAACB1234C1Z5",
      cfs: "Y",
      inv: [
        {
          inum: "INV/101",
          idt: "05-09-2026",
          val: 23600,
          pos: "27",
          rchrg: "N",
          inv_typ: "R",
          itms: [
            { num: 1801, itm_det: { rt: 18, txval: 10000, iamt: 1800, csamt: 0 } },
            { num: 1201, itm_det: { rt: 12, txval: 10000, iamt: 1200, csamt: 0 } },
          ],
        },
      ],
    },
    { ctin: "23AAACS9999D1Z2", inv: [{ inum: "INV/102", idt: "07-09-2026", val: 5900, pos: "23", rchrg: "N", inv_typ: "SEWP", itms: [{ num: 1, itm_det: { rt: 18, txval: 5000, iamt: 900 } }] }] },
  ],
  b2cs: [{ sply_ty: "INTRA", typ: "OE", pos: "23", rt: 5, txval: 2000, camt: 50, samt: 50, csamt: 0 }],
  cdnr: [{ ctin: "27AAACB1234C1Z5", nt: [{ ntty: "C", nt_num: "CN/1", nt_dt: "20-09-2026", val: 1180, pos: "27", rchrg: "N", inv_typ: "R", itms: [{ num: 1, itm_det: { rt: 18, txval: 1000, iamt: 180 } }] }] }],
  nil: { inv: [{ sply_ty: "INTRAB2C", nil_amt: 300, expt_amt: 200, ngsup_amt: 0 }] },
  hsn: { hsn_b2b: [{ num: 1, hsn_sc: "8708", desc: "Parts", uqc: "NOS", qty: 10, rt: 18, txval: 15000, iamt: 2700 }] },
  doc_issue: { doc_det: [{ doc_num: 1, docs: [{ num: 1, from: "INV/101", to: "INV/102", totnum: 2, cancel: 0, net_issue: 2 }] }] },
};

test("GSTR-1: a sheet per portal section, a row per rate, the summary per section", () => {
  const sheets = gstr1Sheets([gstr1]);
  assert.deepEqual(
    sheets.map((s) => s.name),
    ["Summary", "b2b, sez, de", "b2cs", "cdnr", "exemp", "hsn(b2b)", "docs"]
  );
  const b2b = sheets.find((s) => s.name === "b2b, sez, de");
  assert.equal(b2b.rows.length, 3, "INV/101 has two rates");
  assert.deepEqual(
    b2b.rows.map((r) => [r.inum, r.rate, r.taxable, r.igst, r.pos, r.typ]),
    [
      ["INV/101", 18, 10000, 1800, "27-Maharashtra", "Regular B2B"],
      ["INV/101", 12, 10000, 1200, "27-Maharashtra", "Regular B2B"],
      ["INV/102", 18, 5000, 900, "23-Madhya Pradesh", "SEZ supplies with payment"],
    ]
  );
  assert.ok(b2b.rows[0].idt instanceof Date && b2b.rows[0].idt.toISOString().startsWith("2026-09-05"));
  assert.equal(sheets.find((s) => s.name === "cdnr").rows[0].ntty, "Credit Note");
  const summary = sheets[0].rows;
  assert.deepEqual(
    summary.find((r) => r.section === "b2b, sez, de"),
    { section: "b2b, sez, de", count: 2, taxable: 25000, igst: 3900, cgst: 0, sgst: 0, cess: 0 },
    "two invoices, three rate rows"
  );
  assert.equal(summary.find((r) => r.section === "exemp").taxable, 500);
});

test("GSTR-1 in two files, and a re-download: rows kept once", () => {
  const second = { gstin: gstr1.gstin, fp: gstr1.fp, b2b: [{ ctin: "29AAACZ1111E1Z1", inv: [{ inum: "INV/103", idt: "09-09-2026", val: 1180, pos: "29", rchrg: "N", inv_typ: "R", itms: [{ num: 1, itm_det: { rt: 18, txval: 1000, iamt: 180 } }] }] }] };
  const sheets = gstr1Sheets([second, gstr1, structuredClone(gstr1)]);
  const b2b = sheets.find((s) => s.name === "b2b, sez, de");
  assert.deepEqual(
    b2b.rows.map((r) => r.inum),
    ["INV/103", "INV/101", "INV/101", "INV/102"]
  );
  assert.equal(sheets.find((s) => s.name === "b2cs").rows.length, 1);
});

const summary2b = {
  data: {
    gstin: "23AAFFC2640H1ZX",
    rtnprd: "092026",
    gendt: "14-10-2026",
    fc: 1,
    itcsumm: {
      itcavl: { nonrevsup: { igst: 1800, cgst: 0, sgst: 0, cess: 0, b2b: { txval: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 } }, imports: { igst: 0, cgst: 0, sgst: 0, cess: 0 } },
      itcunavl: { nonrevsup: { igst: 0, cgst: 0, sgst: 0, cess: 0 } },
    },
  },
};
const part1 = {
  data: {
    gstin: "23AAFFC2640H1ZX",
    rtnprd: "092026",
    docdata: {
      b2b: [
        {
          ctin: "27AAACB1234C1Z5",
          trdnm: "BHARAT PARTS PVT LTD",
          supfildt: "11-10-2026",
          supprd: "092026",
          inv: [{ inum: "S-55", typ: "R", dt: "03-09-2026", val: 11800, pos: "23", rev: "N", itcavl: "Y", rsn: "", diffprcnt: 1, srctyp: "e-Invoice", irn: "abc", irngendate: "03-09-2026", txval: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0, items: [{ num: 1, rt: 18, txval: 10000, igst: 1800 }] }],
        },
      ],
      cdnr: [{ ctin: "27AAACB1234C1Z5", trdnm: "BHARAT PARTS PVT LTD", supfildt: "11-10-2026", supprd: "092026", nt: [{ ntnum: "CN-9", typ: "C", suptyp: "R", dt: "15-09-2026", val: 590, pos: "23", rev: "N", itcavl: "Y", txval: 500, igst: 90 }] }],
      impg: [{ refdt: "02-09-2026", portcode: "INMAA1", boenum: "1234567", boedt: "01-09-2026", isamd: "N", txval: 50000, igst: 9000, cess: 0 }],
      ecom: [{ ctin: "07AAACE1111F1Z3", trdnm: "SHOP ONLINE", inv: [{ inum: "E-1", txval: 100, igst: 18 }] }],
    },
  },
};

test("GSTR-2B in parts: the summary's figures, the parts' documents, the portal's sheet names", () => {
  const sheets = gstr2bSheets([
    { json: part1, part: "part", partNo: 1 },
    { json: summary2b, part: "summary", partNo: null },
  ]);
  assert.deepEqual(
    sheets.map((s) => s.name),
    ["Summary", "B2B", "B2B-CDNR", "IMPG", "ECOM"]
  );
  const b2b = sheets.find((s) => s.name === "B2B").rows[0];
  assert.equal(b2b.trdnm, "BHARAT PARTS PVT LTD", "the 2B names its suppliers");
  assert.equal(b2b.supprd, "Sep 2026");
  assert.equal(b2b.itcavl, "Yes");
  assert.equal(b2b.taxable, 10000);
  assert.equal(b2b.igst, 1800);
  assert.ok(sheets[0].rows.some((r) => r.section === "ITC Available › All other ITC - Supplies from registered persons › B2B - Invoices" && r.taxable === 10000));
  assert.equal(sheets.find((s) => s.name === "B2B-CDNR").rows[0].typ, "Credit Note");
});

test("GSTR-2B: an older part of the same number is not read twice; a whole file wins", () => {
  const older = structuredClone(part1);
  older.data.docdata.b2b[0].inv[0].txval = 1;
  const sheets = gstr2bSheets([
    { json: part1, part: "part", partNo: 1 },
    { json: older, part: "part", partNo: 1 },
    { json: summary2b, part: "summary" },
  ]);
  const rows = sheets.find((s) => s.name === "B2B").rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].taxable, 10000, "the newest part is used");

  const whole = { data: { ...summary2b.data, docdata: { b2b: [{ ...part1.data.docdata.b2b[0] }] } } };
  delete whole.data.fc;
  const fromWhole = gstr2bSheets([{ json: whole }]);
  assert.deepEqual(
    fromWhole.map((s) => s.name),
    ["Summary", "B2B"]
  );
});

test("a year: every month's rows one under another, the month first", () => {
  const sep = gstr1Sheets([gstr1]);
  const oct = gstr1Sheets([{ ...gstr1, fp: "102026", cdnr: [], nil: undefined, hsn: undefined, doc_issue: undefined }]);
  const year = yearSheets([
    { month: "2026-09", sheets: sep },
    { month: "2026-10", sheets: oct },
  ]);
  const b2b = year.find((s) => s.name === "b2b, sez, de");
  assert.equal(b2b.columns[0].header, "Month");
  assert.equal(b2b.rows.length, 6);
  assert.deepEqual([...new Set(b2b.rows.map((r) => r.__month))], ["Sep 2026", "Oct 2026"]);
  assert.equal(year.find((s) => s.name === "cdnr").rows.length, 1, "a section only one month has");
});

test("the workbook: sheets, headings, dates and amounts as Excel values", async () => {
  const data = await workbook(gstr1Sheets([gstr1]), ["CITY MOTORS – GSTR-1 – Sep 2026", "GSTIN 23AAFFC2640H1ZX", "Made from 1 saved JSON file"]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(data);
  assert.deepEqual(
    book.worksheets.map((w) => w.name),
    ["Summary", "b2b, sez, de", "b2cs", "cdnr", "exemp", "hsn(b2b)", "docs"]
  );
  const summary = book.getWorksheet("Summary");
  assert.equal(summary.getCell("A1").value, "CITY MOTORS – GSTR-1 – Sep 2026");
  assert.equal(summary.getCell("A4").value, null, "a blank row under the heading");
  assert.equal(summary.getCell("A5").value, "Section", "then the table");
  const b2b = book.getWorksheet("b2b, sez, de");
  assert.equal(b2b.getCell("A1").value, "GSTIN/UIN of Recipient");
  assert.equal(b2b.getCell("B2").value, "INV/101");
  const idt = b2b.getCell("C2");
  assert.ok(idt.value instanceof Date);
  assert.equal(idt.numFmt, "dd-mm-yyyy");
  const taxable = b2b.getRow(1).values.indexOf("Taxable Value");
  assert.equal(b2b.getRow(2).getCell(taxable).value, 10000);
  assert.equal(b2b.getRow(2).getCell(taxable).numFmt, "#,##0.00");
  assert.equal(b2b.views[0].ySplit, 1, "the heading row stays in view");
});
