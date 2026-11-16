import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// The Tally extension (public/tally-extension), loaded unpacked in Chromium,
// against a stand-in TallyPrime server and a stand-in app page.
// Run: node --test tests/tally-extension/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const COMPANY = "Mukul Verma & Co.";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// TallyPrime's XML server, as far as the extension uses it
function startTally({ utf16 = false } = {}) {
  const received = [];
  const objects = {
    COMPANY: [COMPANY],
    VOUCHERTYPE: ["Sales", "Sales - CA Mukul Verma", "Receipt"],
    LEDGER: ["CITY MOTORS", "Gst Return Monthly", "CGST", "SGST", "IGST", "Round Off"],
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(body);
      let out;
      if (req.method === "GET") out = "<RESPONSE>TallyPrime Server is Running</RESPONSE>";
      else if (body.includes("<TYPE>Collection</TYPE>")) {
        const type = /<COLLECTION[^>]*><TYPE>([^<]+)<\/TYPE>/.exec(body)[1].toUpperCase();
        const wantedCompany = /<SVCURRENTCOMPANY>([^<]*)</.exec(body)?.[1];
        if (wantedCompany && wantedCompany !== esc(COMPANY)) {
          out = "<ENVELOPE><BODY><DATA><LINEERROR>Could not set SVCurrentCompany</LINEERROR></DATA></BODY></ENVELOPE>";
        } else {
          // An alias, sent only as an element
          const items = objects[type].map((n) => `<${type} NAME="${esc(n)}"><NAME.LIST><NAME>${esc(n)}</NAME>${n === "CITY MOTORS" ? "<NAME>City Motors Bhopal</NAME>" : ""}</NAME.LIST></${type}>`);
          out = `<ENVELOPE><BODY><DATA><COLLECTION>${items.join("")}</COLLECTION></DATA></BODY></ENVELOPE>`;
        }
      } else if (body.includes("<TALLYREQUEST>Import Data</TALLYREQUEST>")) {
        out = body.includes("<LEDGERNAME>Nowhere</LEDGERNAME>")
          ? "<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>1</ERRORS><LINEERROR>Ledger 'Nowhere' does not exist!</LINEERROR></RESPONSE>"
          : `<RESPONSE><CREATED>${body.includes('ACTION="Create"') ? 1 : 0}</CREATED><ALTERED>${body.includes('ACTION="Alter"') ? 1 : 0}</ALTERED><DELETED>0</DELETED><IGNORED>0</IGNORED><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>`;
      } else out = "<RESPONSE>Unknown Request</RESPONSE>";
      const bytes = utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(out, "utf16le")]) : Buffer.from(out);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(bytes);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, received, close: () => server.close() })));
}

// A page of the app: asks the extension the way tally-extension.ts does
function startApp() {
  const page = `<!doctype html><html><body><script>
    let n = 0;
    window.ask = (message) => new Promise((resolve) => {
      const id = String(++n);
      const listener = (e) => {
        if (e.source === window && e.data?.source === "mvc-tally-ext" && e.data.type === "answer" && e.data.id === id) {
          window.removeEventListener("message", listener); resolve(e.data.answer);
        }
      };
      window.addEventListener("message", listener);
      window.postMessage({ source: "mvc-app-tally", id, message }, location.origin);
      setTimeout(() => resolve({ ok: false, error: "timeout" }), 20000);
    });
  </script></body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(page);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => server.close() })));
}

const voucher = (ledger, action = "Create", company = COMPANY) =>
  `<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="b1" VCHTYPE="Sales" ACTION="${action}" OBJVIEW="Invoice Voucher View"><DATE>20261117</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>26-27/0218</VOUCHERNUMBER><LEDGERENTRIES.LIST><LEDGERNAME>CITY MOTORS</LEDGERNAME><AMOUNT>-1180.00</AMOUNT></LEDGERENTRIES.LIST><LEDGERENTRIES.LIST><LEDGERNAME>${ledger}</LEDGERNAME><AMOUNT>1000.00</AMOUNT></LEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

let tally, tally16, app, other, context, dir, appPage, otherPage;

before(async () => {
  tally = await startTally();
  tally16 = await startTally({ utf16: true });
  app = await startApp();
  other = await startApp();
  // The extension as the app's download builds it (tally-extension.ts)
  dir = await mkdtemp(path.join(tmpdir(), "tally-ext-test-"));
  const ext = path.join(dir, "ext");
  await cp(path.join(root, "public/tally-extension"), ext, { recursive: true });
  const fill = async (name, from, to) => writeFile(path.join(ext, name), (await readFile(path.join(ext, name), "utf8")).replace(from, to));
  await fill("manifest.json", "__APP_MATCH__", "http://127.0.0.1/*");
  await fill("background.js", "__APP_ORIGIN__", `http://127.0.0.1:${app.port}`);
  context = await chromium.launchPersistentContext(path.join(dir, "profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-proxy-server"],
  });
  appPage = await context.newPage();
  await appPage.goto(`http://127.0.0.1:${app.port}/dashboard/billing`);
  otherPage = await context.newPage();
  await otherPage.goto(`http://127.0.0.1:${other.port}/`);
});

after(async () => {
  await context?.close();
  for (const s of [tally, tally16, app, other]) s?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const ask = (message, page = appPage) => page.evaluate((m) => window.ask(m), message);

test("the app page sees the extension", async () => {
  assert.equal(await appPage.evaluate(() => document.documentElement.getAttribute("data-mvc-tally")), "1.0.0");
});

test("status: Tally running, with its open companies", async () => {
  const answer = await ask({ type: "tally-status", port: tally.port });
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.companies, [COMPANY]);
});

test("status: Tally not running", async () => {
  const answer = await ask({ type: "tally-status", port: 1 });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /isn't answering on port 1/);
});

test("check: lists missing voucher types and ledgers; names match without case, aliases count", async () => {
  const answer = await ask({
    type: "tally-check",
    port: tally.port,
    company: COMPANY,
    voucherTypes: ["Sales", "Sales - VLA"],
    ledgers: ["city motors", "City Motors Bhopal", "Gst Return Monthly", "CGST", "ITR (A.Y.2026-27)"],
  });
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.missingVoucherTypes, ["Sales - VLA"]);
  assert.deepEqual(answer.missingLedgers, ["ITR (A.Y.2026-27)"]);
});

test("check: the company is not open", async () => {
  const answer = await ask({ type: "tally-check", port: tally.port, company: "B Edge", voucherTypes: [], ledgers: [] });
  assert.equal(answer.ok, false);
  assert.equal(answer.companyMissing, true);
  assert.match(answer.error, /not open in TallyPrime/);
});

test("import: a bill Tally takes, and one it refuses with its reason", async () => {
  const before = tally.received.length;
  const good = await ask({ type: "tally-import", port: tally.port, company: COMPANY, xml: voucher("Gst Return Monthly") });
  assert.deepEqual([good.ok, good.imported], [true, true]);
  assert.equal(tally.received.length, before + 1);
  const altered = await ask({ type: "tally-import", port: tally.port, company: COMPANY, xml: voucher("Gst Return Monthly", "Alter") });
  assert.equal(altered.imported, true);
  const bad = await ask({ type: "tally-import", port: tally.port, company: COMPANY, xml: voucher("Nowhere") });
  assert.deepEqual([bad.ok, bad.imported], [true, false]);
  assert.match(bad.error, /Ledger 'Nowhere' does not exist/);
});

test("import: anything but one voucher for the expected company is refused and never reaches Tally", async () => {
  const before = tally.received.length;
  const master = voucher("Gst Return Monthly").replace("<REQUESTDATA>", '<REQUESTDATA><TALLYMESSAGE><LEDGER NAME="New" ACTION="Create"><PARENT>Sundry Debtors</PARENT></LEDGER></TALLYMESSAGE>');
  for (const xml of [
    master,
    voucher("Gst Return Monthly").replace("<REPORTNAME>Vouchers</REPORTNAME>", "<REPORTNAME>All Masters</REPORTNAME>"),
    voucher("Gst Return Monthly").replace("</REQUESTDATA>", '<TALLYMESSAGE><VOUCHER REMOTEID="b2" ACTION="Create"></VOUCHER></TALLYMESSAGE></REQUESTDATA>'),
    voucher("Gst Return Monthly", "Create", "Other Co"),
  ]) {
    const answer = await ask({ type: "tally-import", port: tally.port, company: COMPANY, xml });
    assert.equal(answer.ok, false, xml.slice(0, 60));
  }
  assert.equal(tally.received.length, before);
});

test("a Tally answering in UTF-16 is read", async () => {
  const answer = await ask({ type: "tally-check", port: tally16.port, company: COMPANY, voucherTypes: ["Sales"], ledgers: ["CGST", "Nope"] });
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.missingLedgers, ["Nope"]);
});

test("pages of any other site get no answer, and nothing reaches Tally", async () => {
  const before = tally.received.length;
  const answer = await ask({ type: "tally-import", port: tally.port, company: COMPANY, xml: voucher("Gst Return Monthly") }, otherPage);
  // The worker doesn't answer other sites at all (the app treats that as a failure)
  assert.ok(!answer?.ok);
  assert.equal(tally.received.length, before);
});
