import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// Debtors from Tally (docs/TALLY_DEBTORS.md) end to end: the Tally extension
// loaded in Chromium reads a stand-in TallyPrime and sends the Sundry Debtors
// to a running app on a TEST database (never production):
//   BASE=http://localhost:3999 DATABASE_URL=<test db> NEXTAUTH_SECRET=<same as the app> \
//   node --test tests/tally-debtors/
// It creates its own users, client and connector, and removes them after.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { encode } = require("next-auth/jwt");
const ExcelJS = require("exceljs");
const Redis = require("ioredis");

// The sync status kept in Redis (lib/tally-debtors.ts), cleared before and after
async function clearRedis() {
  if (!process.env.REDIS_URL) return;
  const redis = new Redis(process.env.REDIS_URL, { tls: { rejectUnauthorized: false }, maxRetriesPerRequest: 2 });
  const keys = await redis.keys("tdebt:*");
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
}

const BASE = process.env.BASE ?? "http://localhost:3999";
const COMPANY = "Mukul Verma & Co.";
const RUN = Date.now().toString(36).toUpperCase();
const prisma = new PrismaClient();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// ─── A stand-in TallyPrime ──────────────────────────────────────────────────

const GROUPS = [
  { name: "Sundry Debtors", parent: "Current Assets", reserved: "Sundry Debtors" },
  { name: "Sundry Debtor - Mukul", parent: "Sundry Debtors" },
  { name: "Via Connectors", parent: "Sundry Debtor - Mukul" },
  { name: "Sundry Debtor - Harsh", parent: "Sundry Debtors" },
  { name: "Sundry Creditors", parent: "Current Liabilities", reserved: "Sundry Creditors" },
  { name: "Sales Accounts", parent: "", reserved: "Sales Accounts" },
];

const tallyData = {
  ledgers: [
    { name: "CITY MOTORS", parent: "Sundry Debtor - Mukul", closing: -2040 },
    { name: "Sharma Traders", parent: "Via Connectors", closing: -590 },
    { name: "Old Client & Sons", parent: "Sundry Debtor - Harsh", closing: 0 },
    { name: "Paper Supplier", parent: "Sundry Creditors", closing: 5000 },
    { name: "Gst Return Monthly", parent: "Sales Accounts", closing: 4000 },
    { name: "HDFC Bank", parent: "Bank Accounts", closing: -2000 },
  ],
  vouchers: [
    // Invoice mode: LEDGERENTRIES, with bill allocations inside (their AMOUNT must not be taken)
    {
      id: 1, date: "20250610", type: "Sales", no: "MVC/25-26/100", narration: "CITY MOTORS\tGST Return - May 25", list: "LEDGERENTRIES.LIST",
      entries: [["CITY MOTORS", -1180, "<BILLALLOCATIONS.LIST><NAME>MVC/25-26/100</NAME><AMOUNT>-99999.00</AMOUNT></BILLALLOCATIONS.LIST>"], ["Gst Return Monthly", 1000], ["CGST", 90], ["SGST", 90]],
    },
    {
      id: 2, date: "20260415", type: "Sales", no: "MVC/26-27/001", narration: "CITY MOTORS\tGST Return - Mar 26", list: "LEDGERENTRIES.LIST",
      entries: [["CITY MOTORS", -2360], ["Gst Return Monthly", 2000], ["CGST", 180], ["SGST", 180]],
    },
    // Voucher mode: ALLLEDGERENTRIES, with a bank allocation holding its own DATE and AMOUNT
    {
      id: 3, date: "20260520", type: "Receipt", no: "R-12", narration: "Cheque 004512", list: "ALLLEDGERENTRIES.LIST",
      entries: [["HDFC Bank", -2000, "<BANKALLOCATIONS.LIST><DATE>20260101</DATE><AMOUNT>-777.00</AMOUNT></BANKALLOCATIONS.LIST>"], ["CITY MOTORS", 2000]],
    },
    { id: 4, date: "20260601", type: "Sales", no: "MVC/26-27/009", cancelled: true, list: "LEDGERENTRIES.LIST", entries: [["CITY MOTORS", -500], ["Gst Return Monthly", 500]] },
    { id: 5, date: "20260701", type: "Sales", no: "MVC/26-27/020", list: "LEDGERENTRIES.LIST", entries: [["Sharma Traders", -590], ["Gst Return Monthly", 500], ["CGST", 45], ["SGST", 45]] },
    { id: 6, date: "20260705", type: "Purchase", no: "P-1", list: "ALLLEDGERENTRIES.LIST", entries: [["Paper Supplier", 5000], ["Office Expenses", -5000]] },
  ],
};

function voucherXml(v) {
  const lists = v.entries
    .map(([ledger, amount, inner = ""]) => `<${v.list}><LEDGERNAME>${esc(ledger)}</LEDGERNAME><AMOUNT>${amount.toFixed(2)}</AMOUNT>${inner}</${v.list}>`)
    .join("");
  return (
    `<VOUCHER REMOTEID="r-${v.id}" VCHTYPE="${v.type}" ACTION="Create"><DATE TYPE="Date">${v.date}</DATE><VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${v.no}</VOUCHERNUMBER><NARRATION>${esc(v.narration ?? "")}</NARRATION><ISCANCELLED>${v.cancelled ? "Yes" : "No"}</ISCANCELLED>` +
    `<ISOPTIONAL>No</ISOPTIONAL><MASTERID> ${v.id}</MASTERID>${lists}</VOUCHER>`
  );
}

function startTally() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(body);
      // Only reads: an Import here would be a bug
      assert.ok(!body.includes("Import Data") || body.includes("<REPORTNAME>Vouchers</REPORTNAME>"));
      let out = "<RESPONSE>Unknown Request</RESPONSE>";
      const type = /<COLLECTION[^>]*><TYPE>([^<]+)<\/TYPE>/.exec(body)?.[1];
      if (type === "Company") out = `<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="${esc(COMPANY)}"/></COLLECTION></DATA></BODY></ENVELOPE>`;
      else if (type === "Group")
        out = `<ENVELOPE><BODY><DATA><COLLECTION>${GROUPS.map((g) => `<GROUP NAME="${esc(g.name)}" RESERVEDNAME="${esc(g.reserved ?? "")}"><PARENT TYPE="String">${esc(g.parent)}</PARENT></GROUP>`).join("")}</COLLECTION></DATA></BODY></ENVELOPE>`;
      else if (type === "Ledger")
        out = `<ENVELOPE><BODY><DATA><COLLECTION>${tallyData.ledgers
          .map((l) => `<LEDGER NAME="${esc(l.name)}" RESERVEDNAME=""><PARENT TYPE="String">${esc(l.parent)}</PARENT><CLOSINGBALANCE TYPE="Amount">${l.closing.toFixed(2)}</CLOSINGBALANCE></LEDGER>`)
          .join("")}</COLLECTION></DATA></BODY></ENVELOPE>`;
      // Every voucher whatever the period asked (the worst case): the extension must not count one twice
      else if (type === "Voucher") out = `<ENVELOPE><BODY><DATA><COLLECTION>${tallyData.vouchers.map(voucherXml).join("")}</COLLECTION></DATA></BODY></ENVELOPE>`;
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(out);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, received, close: () => server.close() })));
}

// ─── The app ────────────────────────────────────────────────────────────────

const cookies = {};
async function sessionFor(user, extra = {}) {
  return encode({
    secret: process.env.NEXTAUTH_SECRET,
    token: { id: user.id, sub: user.id, name: user.name, email: user.email, role: user.role, roleVersion: 1, checkedAt: Date.now() + 3_600_000, ...extra },
  });
}

const api = async (p, { method = "GET", body, as = "admin", key, raw } = {}) => {
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  else if (as) headers.cookie = `next-auth.session-token=${cookies[as]}`;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  if (raw) return r;
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, json };
};

let tally, context, dir, page, admin, partner, client, connector;

before(async () => {
  await clearRedis();
  await prisma.tallyDebtorLedger.deleteMany({});
  await prisma.tallyDebtorSync.deleteMany({});
  admin = await prisma.user.create({ data: { name: `Debtors Admin ${RUN}`, email: `dadmin-${RUN.toLowerCase()}@test.invalid`, role: "ADMIN" } });
  partner = await prisma.user.create({ data: { name: `Debtors Partner ${RUN}`, email: `dpartner-${RUN.toLowerCase()}@test.invalid`, role: "PARTNER" } });
  connector = await prisma.connector.create({ data: { name: `Sharma ${RUN}`, tallyLedgerName: "Sharma Traders", phone: "9826012345" } });
  client = await prisma.client.create({
    data: {
      contactPerson: `Ravi ${RUN}`,
      companyName: `City Motors ${RUN}`,
      tallyLedgerName: "City Motors",
      phones: [{ number: "98260 55555", label: "Owner", whatsapp: true }],
      email: "ravi@test.invalid",
      gstin: "23ABCDE1234F1Z5",
      managerId: admin.id,
    },
  });
  cookies.admin = await sessionFor(admin);
  cookies.partner = await sessionFor(partner);
  cookies.partnerAllowed = await sessionFor(partner, { canViewDebtors: true });

  tally = await startTally();
  dir = await mkdtemp(path.join(tmpdir(), "tally-debtors-test-"));
  const ext = path.join(dir, "ext");
  await cp(path.join(root, "public/tally-extension"), ext, { recursive: true });
  // As the app's download builds it (tally-extension.ts)
  const base = new URL(BASE);
  const fill = async (name, from, to) => writeFile(path.join(ext, name), (await readFile(path.join(ext, name), "utf8")).replaceAll(from, to));
  await fill("manifest.json", "__APP_MATCH__", `${base.protocol}//${base.hostname}/*`);
  await fill("background.js", "__APP_ORIGIN__", base.origin);
  context = await chromium.launchPersistentContext(path.join(dir, "profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-proxy-server"],
  });
  await context.addCookies([{ name: "next-auth.session-token", value: cookies.admin, url: BASE }]);
  page = await context.newPage();
  // The Tally port used by the page (tally-extension.ts)
  await page.addInitScript((port) => localStorage.setItem("tally-port", String(port)), tally.port);
});

after(async () => {
  await context?.close();
  tally?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  await prisma.tallyLedgerEvent.deleteMany({ where: { userId: { in: [admin.id, partner.id] } } });
  await prisma.tallyDebtorLedger.deleteMany({});
  await prisma.tallyDebtorSync.deleteMany({});
  await prisma.client.delete({ where: { id: client.id } });
  await prisma.connector.delete({ where: { id: connector.id } });
  await prisma.notification.deleteMany({ where: { OR: [{ sentToId: { in: [admin.id, partner.id] } }, { sentById: { in: [admin.id, partner.id] } }] } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, partner.id] } } });
  await prisma.$disconnect();
  await clearRedis();
});

// A new user's welcome tour, then What's new cards, open over the page
async function closePopups() {
  // Each card can come a moment after the last one closed: stop after 3 quiet checks
  for (let i = 0, quiet = 0; i < 30 && quiet < 3; i++) {
    await page.waitForTimeout(700);
    const dialog = page.getByRole("dialog").first();
    if (!(await dialog.isVisible().catch(() => false))) {
      quiet++;
      continue;
    }
    quiet = 0;
    const button = dialog.getByRole("button", { name: /^(Skip|Got it)$/ }).first();
    if (await button.isVisible().catch(() => false)) await button.click();
    else await page.keyboard.press("Escape");
  }
}

const debtorsList = async () => (await api("/api/debtors")).json;
const byName = (list, name) => list.ledgers.find((l) => l.name === name);

test("only Admin and the partners allowed see Debtors", async () => {
  assert.equal((await api("/api/debtors", { as: "partner" })).status, 403);
  assert.equal((await api("/api/debtors/status", { as: "partner" })).status, 403);
  assert.equal((await api("/api/debtors", { as: "partnerAllowed" })).status, 200);
  assert.equal((await api("/api/debtors", { as: null })).status, 403);
  // Only Admin connects the Tally PC
  assert.equal((await api("/api/debtors/connect", { method: "POST", as: "partnerAllowed", body: { company: COMPANY } })).status, 403);
});

test("Admin connects the Tally PC from Debtors; the Sundry Debtors (only those) arrive", async () => {
  await page.goto(`${BASE}/dashboard/debtors`);
  await page.getByText("Tally PC (Admin)").waitFor({ timeout: 60_000 });
  await page.getByText("No data from Tally yet").waitFor();
  await closePopups();
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "debtors-before.png"), fullPage: true });
  await page.getByRole("button", { name: "Connect this PC" }).click();
  await page.getByText(/Sent 3 debtor ledgers from Tally/).waitFor({ timeout: 90_000 });
  if (process.env.SHOTS) {
    await page.getByText("Grand Total").waitFor();
    await closePopups();
    await page.getByRole("button", { name: "Expand all" }).click();
    await page.screenshot({ path: path.join(process.env.SHOTS, "debtors-list.png"), fullPage: true });
    await page.getByRole("link", { name: "CITY MOTORS", exact: true }).click();
    await page.getByText("Ledger Account").waitFor();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Choose dates/ }).click();
    await page.locator("#ledger-from").fill("2025-04-01");
    await page.getByText("Show narration").click();
    await page.screenshot({ path: path.join(process.env.SHOTS, "debtors-ledger.png"), fullPage: true });
    await page.getByRole("button", { name: "WhatsApp" }).click();
    await page.getByText("Send the ledger on WhatsApp").waitFor();
    await page.screenshot({ path: path.join(process.env.SHOTS, "debtors-whatsapp.png") });
  }

  const list = await debtorsList();
  assert.deepEqual(list.ledgers.map((l) => l.name).sort(), ["CITY MOTORS", "Old Client & Sons", "Sharma Traders"]);
  assert.equal(list.rootGroup, "Sundry Debtors");
  // Every group under Sundry Debtors (nested too); Sundry Creditors and the rest are left out
  assert.deepEqual(
    [...list.groups].sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "Sundry Debtor - Harsh", parent: "Sundry Debtors" },
      { name: "Sundry Debtor - Mukul", parent: "Sundry Debtors" },
      { name: "Via Connectors", parent: "Sundry Debtor - Mukul" },
    ]
  );
  assert.equal(byName(list, "CITY MOTORS").closing, 2040);
  assert.equal(byName(list, "CITY MOTORS").group, "Sundry Debtor - Mukul");
  assert.equal(byName(list, "Sharma Traders").group, "Via Connectors");
  // Linked to the app: the client by its Tally ledger (any case), the connector by its own
  assert.deepEqual(byName(list, "CITY MOTORS").party, { kind: "client", id: client.id, name: `City Motors ${RUN}` });
  assert.equal(byName(list, "Sharma Traders").party.kind, "connector");
  assert.equal(byName(list, "CITY MOTORS").lastReceiptDate, "2026-05-20");
  assert.equal(list.status.connected, true);
  assert.ok(list.status.readAt);
  assert.equal(list.status.trigger, "manual");
  // Nothing but reads went to Tally
  assert.ok(tally.received.every((b) => b.includes("<TALLYREQUEST>Export</TALLYREQUEST>")));
});

test("the ledger is as in Tally: entries, particulars, opening and closing", async () => {
  const list = await debtorsList();
  const { json } = await api(`/api/debtors/${byName(list, "CITY MOTORS").id}`);
  const { ledger, party } = json;
  assert.equal(ledger.company, COMPANY);
  // Kept from the start of the previous financial year: 500 Dr before the first entry
  assert.equal(ledger.opening, 500);
  assert.equal(ledger.closing, 2040);
  assert.deepEqual(
    ledger.entries.map((e) => [e.d, e.p, e.t, e.n, e.dr, e.cr]),
    [
      ["2025-06-10", "Gst Return Monthly", "Sales", "MVC/25-26/100", 1180, 0],
      ["2026-04-15", "Gst Return Monthly", "Sales", "MVC/26-27/001", 2360, 0],
      ["2026-05-20", "HDFC Bank", "Receipt", "R-12", 0, 2000],
    ]
  );
  assert.equal(ledger.entries[0].r, "CITY MOTORS GST Return - May 25");
  assert.equal(party.kind, "client");
  assert.equal(party.gstin, "23ABCDE1234F1Z5");
  assert.equal(party.phones[0].number, "98260 55555");
});

test("PDF and Excel of a period, logged; the period's opening is carried", async () => {
  const list = await debtorsList();
  const id = byName(list, "CITY MOTORS").id;
  const pdf = await api(`/api/debtors/${id}/file?format=pdf&from=2026-04-01&to=2026-11-20`, { raw: true });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition"), /Ledger - CITY MOTORS - 1-Apr-2026 to 20-Nov-2026\.pdf/);
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 4).toString(), "%PDF");
  if (process.env.SHOTS) await writeFile(path.join(process.env.SHOTS, "ledger.pdf"), pdfBytes);

  const xlsx = await api(`/api/debtors/${id}/file?format=xlsx&from=2026-04-01&to=2026-11-20&narration=1`, { raw: true });
  assert.equal(xlsx.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
  const rows = [];
  book.getWorksheet("Ledger").eachRow((r) => rows.push(r.values.slice(1)));
  const find = (label) => rows.find((r) => r.includes(label));
  assert.equal(rows[0][0], COMPANY);
  assert.equal(rows[1][0], "CITY MOTORS");
  // Opening at 1-Apr-2026: 500 + 1,180 = 1,680 Dr; this year 2,360 Dr and 2,000 Cr; closing 2,040 Dr
  assert.deepEqual(find("Opening Balance").slice(4, 6), ["Opening Balance", 1680]);
  assert.deepEqual(find("Current Total").slice(4, 7), ["Current Total", 2360, 2000]);
  assert.deepEqual(find("Closing Balance").slice(4, 6), ["Closing Balance", 2040]);
  assert.ok(rows.some((r) => r.includes("Cheque 004512")), "narration shown when asked");
  assert.ok(rows.some((r) => String(r[0]).startsWith("As per Tally data of")));

  const events = await prisma.tallyLedgerEvent.findMany({ where: { ledgerName: "CITY MOTORS" } });
  assert.deepEqual(events.map((e) => e.kind).sort(), ["excel", "pdf"]);
  assert.equal((await api(`/api/debtors/${id}/file?format=pdf&from=2020-04-01&to=2026-11-20`)).status, 400);
});

test("the client's Ledger tab finds the client's ledger; a connector's client is pointed to the connector's", async () => {
  const own = await api(`/api/clients/${client.id}/ledger`);
  assert.equal(own.json.ledger.name, "CITY MOTORS");
  const other = await prisma.client.create({ data: { contactPerson: `Via ${RUN}`, connectorId: connector.id, managerId: admin.id } });
  try {
    const via = await api(`/api/clients/${other.id}/ledger`);
    assert.equal(via.json.ledger, null);
    assert.equal(via.json.connector.ledger.name, "Sharma Traders");
  } finally {
    await prisma.client.delete({ where: { id: other.id } });
  }
});

test("Refresh now: the Tally PC picks it up, only the changed ledger is sent, the time moves on", async () => {
  const before = await debtorsList();
  const cityId = byName(before, "CITY MOTORS").id;
  const sharmaUpdated = (await prisma.tallyDebtorLedger.findUnique({ where: { id: byName(before, "Sharma Traders").id } })).updatedAt;
  // A payment received in Tally
  tallyData.vouchers.push({ id: 7, date: "20261119", type: "Receipt", no: "R-30", list: "ALLLEDGERENTRIES.LIST", entries: [["HDFC Bank", -1040], ["CITY MOTORS", 1040]] });
  tallyData.ledgers[0].closing = -1000;

  const asked = await api("/api/debtors/refresh", { method: "POST" });
  assert.equal(asked.status, 200);
  assert.ok(asked.json.refresh);
  let status;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    status = (await api("/api/debtors/status")).json;
    if (status.readAt !== before.status.readAt) break;
  }
  assert.notEqual(status.readAt, before.status.readAt, "the Tally PC did not answer the refresh");
  assert.equal(status.trigger, "refresh");
  assert.equal(status.refresh, null);
  assert.ok(status.seenAt);

  const { json } = await api(`/api/debtors/${cityId}`);
  assert.equal(json.ledger.closing, 1000);
  assert.equal(json.ledger.entries.at(-1).n, "R-30");
  // The unchanged ledger was not written again
  assert.equal((await prisma.tallyDebtorLedger.findUnique({ where: { id: byName(before, "Sharma Traders").id } })).updatedAt.getTime(), sharmaUpdated.getTime());
});

test("Tally closed during a refresh: the error is shown and the refresh stops waiting", async () => {
  tally.close();
  {
    await api("/api/debtors/refresh", { method: "POST" });
    let status;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      status = (await api("/api/debtors/status")).json;
      if (status.error) break;
    }
    assert.match(status.error?.message ?? "", /TallyPrime isn't answering/);
    assert.equal(status.refresh, null);
  }
});

test("the Tally PC's key: wrong keys and bad data are refused; a new connection stops the old key", async () => {
  assert.equal((await api("/api/tally-sync/poll", { key: "mvct_wrongwrongwrongwrongwrongwrong" })).status, 401);
  assert.equal((await api("/api/tally-sync/poll", { as: "admin" })).status, 401);
  const { json } = await api("/api/debtors/connect", { method: "POST", body: { company: COMPANY } });
  const key = json.key;
  assert.equal((await api("/api/tally-sync/poll", { key })).status, 200);
  assert.equal((await api("/api/tally-sync/commit", { method: "POST", key, body: { readAt: "x" } })).status, 400);
  const again = await api("/api/debtors/connect", { method: "POST", body: { company: COMPANY } });
  assert.equal((await api("/api/tally-sync/poll", { key })).status, 401);
  assert.equal((await api("/api/tally-sync/poll", { key: again.json.key })).status, 200);
  // The same company: the debtors stay
  assert.equal((await debtorsList()).ledgers.length, 3);
});

test("WhatsApp: no link without file storage; an unknown link says it expired", async () => {
  const list = await debtorsList();
  const share = await api(`/api/debtors/${byName(list, "CITY MOTORS").id}/share`, { method: "POST", body: { from: "2026-04-01", to: "2026-11-20", narration: false } });
  // This test app has no Cloudflare R2
  assert.equal(share.status, 503);
  const gone = await api("/api/ledger-link/abcdefghijklmnopqrstuvwxyz", { as: null, raw: true });
  assert.equal(gone.status, 410);
});
