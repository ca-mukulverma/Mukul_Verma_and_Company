import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// Debtors from Tally (docs/TALLY_DEBTORS.md) end to end: MVC's and B Edge's
// Tally companies on two different Tally PCs (two Chromiums, each with the
// Tally extension, each beside a stand-in TallyPrime), sending to a running
// app on a TEST database (never production):
//   BASE=http://localhost:3999 DATABASE_URL=<test db> NEXTAUTH_SECRET=<same as the app> \
//   REDIS_URL=<the app's Redis> node --test tests/tally-debtors/e2e.test.mjs
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
const MVC_COMPANY = "Mukul Verma & Co.";
const BEDGE_COMPANY = "B Edge Consulting LLP";
const OTHER_COMPANY = "Client Books Pvt Ltd"; // a client's company staff keep open on the MVC PC
const RUN = Date.now().toString(36).toUpperCase();
const prisma = new PrismaClient();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Stand-in TallyPrimes ───────────────────────────────────────────────────

const mvcData = {
  groups: [
    { name: "Sundry Debtors", parent: "Current Assets", reserved: "Sundry Debtors" },
    { name: "Sundry Debtor - Mukul", parent: "Sundry Debtors" },
    { name: "Via Connectors", parent: "Sundry Debtor - Mukul" },
    { name: "Sundry Debtor - Harsh", parent: "Sundry Debtors" },
    { name: "Sundry Creditors", parent: "Current Liabilities", reserved: "Sundry Creditors" },
    { name: "Sales Accounts", parent: "", reserved: "Sales Accounts" },
    { name: "Gst", parent: "Sales Accounts" },
    { name: "Income Tax Returns", parent: "Sales Accounts" },
  ],
  ledgers: [
    { name: "CITY MOTORS", parent: "Sundry Debtor - Mukul", closing: -2040 },
    { name: "ITR Individual", parent: "Income Tax Returns", closing: 1100 },
    { name: "Cash", parent: "Cash-in-Hand", closing: -300 },
    { name: "Sharma Traders", parent: "Via Connectors", closing: -590 },
    { name: "Old Client & Sons", parent: "Sundry Debtor - Harsh", closing: 0 },
    { name: "Paper Supplier", parent: "Sundry Creditors", closing: 5000 },
    { name: "Gst Return Monthly", parent: "Gst", closing: 4000 },
    { name: "HDFC Bank", parent: "Bank Accounts", closing: -2000 },
  ],
  vouchers: [
    // Invoice mode: LEDGERENTRIES, with bill allocations inside (their AMOUNT must not be taken)
    {
      id: 1, date: "20250610", type: "Sales", no: "MVC/25-26/100", narration: "CITY MOTORS\tGST Return - May 25", list: "LEDGERENTRIES.LIST",
      entries: [["CITY MOTORS", -1180, "<BILLALLOCATIONS.LIST><NAME>MVC/25-26/100</NAME><AMOUNT>-99999.00</AMOUNT></BILLALLOCATIONS.LIST>"], ["Gst Return Monthly", 1000], ["CGST", 90], ["SGST", 90]],
    },
    { id: 2, date: "20260415", type: "Sales", no: "MVC/26-27/001", narration: "CITY MOTORS\tGST Return - Mar 26", list: "LEDGERENTRIES.LIST", entries: [["CITY MOTORS", -2360], ["Gst Return Monthly", 2000], ["CGST", 180], ["SGST", 180]] },
    // Voucher mode: ALLLEDGERENTRIES, with a bank allocation holding its own DATE and AMOUNT
    {
      id: 3, date: "20260520", type: "Receipt", no: "R-12", narration: "Cheque 004512", list: "ALLLEDGERENTRIES.LIST",
      entries: [["HDFC Bank", -2000, "<BANKALLOCATIONS.LIST><DATE>20260101</DATE><AMOUNT>-777.00</AMOUNT></BANKALLOCATIONS.LIST>"], ["CITY MOTORS", 2000]],
    },
    { id: 4, date: "20260601", type: "Sales", no: "MVC/26-27/009", cancelled: true, list: "LEDGERENTRIES.LIST", entries: [["CITY MOTORS", -500], ["Gst Return Monthly", 500]] },
    { id: 5, date: "20260701", type: "Sales", no: "MVC/26-27/020", list: "LEDGERENTRIES.LIST", entries: [["Sharma Traders", -590], ["Gst Return Monthly", 500], ["CGST", 45], ["SGST", 45]] },
    { id: 6, date: "20260705", type: "Purchase", no: "P-1", list: "ALLLEDGERENTRIES.LIST", entries: [["Paper Supplier", 5000], ["Office Expenses", -5000]] },
    // Sales (Admin's Sales page). Two years back: before the debtors' entries, kept for sales only
    { id: 21, date: "20241108", type: "Sales", no: "MVC/24-25/050", list: "LEDGERENTRIES.LIST", entries: [["Old Client & Sons", -400], ["Gst Return Monthly", 400]] },
    { id: 22, date: "20241108", type: "Receipt", no: "R-1", list: "ALLLEDGERENTRIES.LIST", entries: [["HDFC Bank", -400], ["Old Client & Sons", 400]] },
    // November 2025: Old Client & Sons billed (not billed in November 2026)
    { id: 23, date: "20251112", type: "Sales", no: "MVC/25-26/300", list: "LEDGERENTRIES.LIST", entries: [["Old Client & Sons", -700], ["ITR Individual", 700]] },
    { id: 24, date: "20251120", type: "Receipt", no: "R-5", list: "ALLLEDGERENTRIES.LIST", entries: [["HDFC Bank", -700], ["Old Client & Sons", 700]] },
    // November 2026: Sharma Traders and a cash sale; a credit note; Sharma pays the rest
    { id: 25, date: "20261110", type: "Sales", no: "MVC/26-27/400", list: "LEDGERENTRIES.LIST", entries: [["Sharma Traders", -900], ["ITR Individual", 900]] },
    { id: 26, date: "20261112", type: "Sales", no: "MVC/26-27/401", list: "LEDGERENTRIES.LIST", entries: [["Cash", -300], ["ITR Individual", 300]] },
    { id: 27, date: "20261115", type: "Credit Note", no: "CN-1", list: "ALLLEDGERENTRIES.LIST", entries: [["ITR Individual", -100], ["Sharma Traders", 100]] },
    { id: 28, date: "20261118", type: "Receipt", no: "R-40", list: "ALLLEDGERENTRIES.LIST", entries: [["HDFC Bank", -800], ["Sharma Traders", 800]] },
  ],
};

// B Edge's own company: the same party (CITY MOTORS) has its own ledger here
const bedgeData = {
  groups: [
    { name: "Sundry Debtors", parent: "Current Assets", reserved: "Sundry Debtors" },
    { name: "BE - Direct", parent: "Sundry Debtors" },
    { name: "Sales Accounts", parent: "", reserved: "Sales Accounts" },
  ],
  ledgers: [
    { name: "Consultancy", parent: "Sales Accounts", closing: 15000 },
    { name: "CITY MOTORS", parent: "BE - Direct", closing: 0 },
    { name: "Gupta & Co", parent: "BE - Direct", closing: -5000 },
  ],
  vouchers: [
    { id: 11, date: "20261005", type: "Sales", no: "BE/26-27/031", list: "LEDGERENTRIES.LIST", entries: [["CITY MOTORS", -10000], ["Consultancy", 10000]] },
    // TDS deducted by the client, booked by journal: counts as recovered
    { id: 12, date: "20261102", type: "Journal", no: "J-4", list: "ALLLEDGERENTRIES.LIST", entries: [["TDS Receivable", -1000], ["CITY MOTORS", 1000]] },
    { id: 13, date: "20261103", type: "Receipt", no: "BR-9", list: "ALLLEDGERENTRIES.LIST", entries: [["ICICI Bank", -9000], ["CITY MOTORS", 9000]] },
    { id: 14, date: "20260710", type: "Sales", no: "BE/26-27/012", list: "LEDGERENTRIES.LIST", entries: [["Gupta & Co", -5000], ["Consultancy", 5000]] },
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

// A TallyPrime with `companies` open; `data` is the firm's company's books
function startTally(companies, data) {
  const t = { received: [], companies, closed: false };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      t.received.push(body);
      let out = "<RESPONSE>Unknown Request</RESPONSE>";
      const type = /<COLLECTION[^>]*><TYPE>([^<]+)<\/TYPE>/.exec(body)?.[1];
      const asked = /<SVCURRENTCOMPANY>([^<]*)</.exec(body)?.[1];
      if (type === "Company") out = `<ENVELOPE><BODY><DATA><COLLECTION>${t.companies.map((c) => `<COMPANY NAME="${esc(c)}"/>`).join("")}</COLLECTION></DATA></BODY></ENVELOPE>`;
      else if (asked !== esc(companies[0])) out = "<ENVELOPE><BODY><DATA><LINEERROR>Could not set SVCurrentCompany</LINEERROR></DATA></BODY></ENVELOPE>";
      else if (type === "Group")
        out = `<ENVELOPE><BODY><DATA><COLLECTION>${data.groups.map((g) => `<GROUP NAME="${esc(g.name)}" RESERVEDNAME="${esc(g.reserved ?? "")}"><PARENT TYPE="String">${esc(g.parent)}</PARENT></GROUP>`).join("")}</COLLECTION></DATA></BODY></ENVELOPE>`;
      else if (type === "Ledger")
        out = `<ENVELOPE><BODY><DATA><COLLECTION>${data.ledgers
          .map((l) => `<LEDGER NAME="${esc(l.name)}" RESERVEDNAME=""><PARENT TYPE="String">${esc(l.parent)}</PARENT><CLOSINGBALANCE TYPE="Amount">${l.closing.toFixed(2)}</CLOSINGBALANCE></LEDGER>`)
          .join("")}</COLLECTION></DATA></BODY></ENVELOPE>`;
      // Every voucher whatever the period asked (the worst case): the extension must not count one twice
      else if (type === "Voucher") out = `<ENVELOPE><BODY><DATA><COLLECTION>${data.vouchers.map(voucherXml).join("")}</COLLECTION></DATA></BODY></ENVELOPE>`;
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(out);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(Object.assign(t, { port: server.address().port, close: () => server.close() })))
  );
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

// A Tally PC: Chrome with the Tally extension, as the app's download builds it
async function startPc(name, tallyPort) {
  const ext = path.join(dir, `${name}-ext`);
  await cp(path.join(root, "public/tally-extension"), ext, { recursive: true });
  const base = new URL(BASE);
  const fill = async (file, from, to) => writeFile(path.join(ext, file), (await readFile(path.join(ext, file), "utf8")).replaceAll(from, to));
  await fill("manifest.json", "__APP_MATCH__", `${base.protocol}//${base.hostname}/*`);
  await fill("background.js", "__APP_ORIGIN__", base.origin);
  const context = await chromium.launchPersistentContext(path.join(dir, `${name}-profile`), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-proxy-server"],
  });
  await context.addCookies([{ name: "next-auth.session-token", value: cookies.admin, url: BASE }]);
  const page = await context.newPage();
  // Tally's port on that PC (tally-extension.ts)
  await page.addInitScript((port) => localStorage.setItem("tally-port", String(port)), tallyPort);
  return { context, page };
}

// A new user's welcome tour, then What's new cards, open over the page
async function closePopups(page) {
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

let mvcTally, bedgeTally, dir, mvcPc, bedgePc, admin, partner, mvcManager, client, connector;

before(async () => {
  await clearRedis();
  await prisma.tallyLedgerEvent.deleteMany({});
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
  // MVC's billing manager (sees MVC's income ledgers only)
  mvcManager = await prisma.user.create({
    data: { name: `MVC Billing ${RUN}`, email: `dmvcbill-${RUN.toLowerCase()}@test.invalid`, role: "PARTNER", canApproveBilling: true },
  });
  cookies.mvcManager = await sessionFor(mvcManager);
  // Income ledgers already in the app: one spelled differently from Tally, one no longer in Tally
  await prisma.tallyIncomeLedger.deleteMany({ where: { name: { in: ["gst return monthly", "Gst Return Monthly", "Old Service", "ITR Individual", "Consultancy", "Payroll Services"] } } });
  await prisma.tallyIncomeLedger.create({ data: { entity: "MVC", name: "gst return monthly" } });
  await prisma.tallyIncomeLedger.create({ data: { entity: "MVC", name: "Old Service" } });

  // Two Tally PCs: MVC's (with a client's company open too) and B Edge's
  mvcTally = await startTally([MVC_COMPANY, OTHER_COMPANY], mvcData);
  bedgeTally = await startTally([BEDGE_COMPANY], bedgeData);
  dir = await mkdtemp(path.join(tmpdir(), "tally-debtors-test-"));
  mvcPc = await startPc("mvc", mvcTally.port);
  bedgePc = await startPc("bedge", bedgeTally.port);
});

after(async () => {
  await mvcPc?.context.close();
  await bedgePc?.context.close();
  mvcTally?.close();
  bedgeTally?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  await prisma.tallyLedgerEvent.deleteMany({});
  await prisma.tallyDebtorLedger.deleteMany({});
  await prisma.tallyDebtorSync.deleteMany({});
  await prisma.bill.deleteMany({ where: { createdById: admin.id } });
  await prisma.tallyIncomeLedger.deleteMany({ where: { name: { in: ["Gst Return Monthly", "Old Service", "ITR Individual", "Consultancy", "Payroll Services"] } } });
  await prisma.client.deleteMany({ where: { companyName: { contains: RUN }, id: { not: client.id } } });
  await prisma.activity.deleteMany({ where: { userId: { in: [admin.id, partner.id, mvcManager.id] } } });
  await prisma.client.delete({ where: { id: client.id } });
  await prisma.connector.delete({ where: { id: connector.id } });
  await prisma.notification.deleteMany({ where: { OR: [{ sentToId: { in: [admin.id, partner.id, mvcManager.id] } }, { sentById: { in: [admin.id, partner.id, mvcManager.id] } }] } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, partner.id, mvcManager.id] } } });
  await prisma.$disconnect();
  await clearRedis();
});

const debtorsList = async () => (await api("/api/debtors")).json;
const find = (list, entity, name) => list.ledgers.find((l) => l.entity === entity && l.name === name);
const exportsTo = (t) => t.received.filter((b) => b.includes("<SVCURRENTCOMPANY>")).map((b) => /<SVCURRENTCOMPANY>([^<]*)</.exec(b)[1]);

// Admin connects one firm on the Tally PC whose page this is
async function connectFirm(page, label, company) {
  const card = page.locator("div.rounded-lg.border", { has: page.getByText(label, { exact: true }) }).filter({ has: page.getByRole("button", { name: `Connect this PC for ${label}` }) });
  await card.getByLabel("Company in Tally").fill(company);
  await card.getByRole("button", { name: `Connect this PC for ${label}` }).click();
  await page.getByText(new RegExp(`${label}: sent \\d+ debtor ledgers from Tally`)).waitFor({ timeout: 90_000 });
}

test("only Admin and the partners allowed see Debtors", async () => {
  assert.equal((await api("/api/debtors", { as: "partner" })).status, 403);
  assert.equal((await api("/api/debtors/status?entity=MVC", { as: "partner" })).status, 403);
  assert.equal((await api("/api/debtors/recovery?entity=MVC", { as: "partner" })).status, 403);
  assert.equal((await api("/api/debtors", { as: "partnerAllowed" })).status, 200);
  assert.equal((await api("/api/debtors", { as: null })).status, 403);
  // Only Admin connects a Tally PC
  assert.equal((await api("/api/debtors/connect", { method: "POST", as: "partnerAllowed", body: { entity: "MVC", company: MVC_COMPANY } })).status, 403);
});

test("MVC's Tally PC is connected for MVC; only MVC's company is read, never the other company open there", async () => {
  const { page } = mvcPc;
  await page.goto(`${BASE}/dashboard/debtors?view=ledgers`);
  await page.getByText("Tally PCs (Admin)").waitFor({ timeout: 60_000 });
  await closePopups(page);
  await connectFirm(page, "MVC", MVC_COMPANY);

  const list = await debtorsList();
  const mvc = list.ledgers.filter((l) => l.entity === "MVC");
  assert.deepEqual(mvc.map((l) => l.name).sort(), ["CITY MOTORS", "Old Client & Sons", "Sharma Traders"]);
  assert.equal(list.firms.MVC.rootGroup, "Sundry Debtors");
  assert.deepEqual(
    [...list.firms.MVC.groups].sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "Sundry Debtor - Harsh", parent: "Sundry Debtors" },
      { name: "Sundry Debtor - Mukul", parent: "Sundry Debtors" },
      { name: "Via Connectors", parent: "Sundry Debtor - Mukul" },
    ]
  );
  assert.equal(find(list, "MVC", "CITY MOTORS").closing, 2040);
  assert.deepEqual(find(list, "MVC", "CITY MOTORS").party, { kind: "client", id: client.id, name: `City Motors ${RUN}` });
  assert.equal(find(list, "MVC", "Sharma Traders").party.kind, "connector");
  assert.equal(list.firms.MVC.status.connected, true);
  assert.equal(list.firms.BEDGE.status.connected, false);
  // Every read named MVC's company, and nothing but reads went to Tally
  assert.ok(exportsTo(mvcTally).length > 0);
  assert.ok(exportsTo(mvcTally).every((c) => c === esc(MVC_COMPANY)));
  assert.ok(mvcTally.received.every((b) => b.includes("<TALLYREQUEST>Export</TALLYREQUEST>")));
});

test("B Edge's company on another Tally PC: its debtors arrive separately, the same party keeps two ledgers", async () => {
  const { page } = bedgePc;
  await page.goto(`${BASE}/dashboard/debtors?view=ledgers&firm=BOTH`);
  await page.getByText("Tally PCs (Admin)").waitFor({ timeout: 60_000 });
  await closePopups(page);
  await connectFirm(page, "B Edge", BEDGE_COMPANY);

  const list = await debtorsList();
  assert.deepEqual(list.ledgers.filter((l) => l.entity === "BEDGE").map((l) => l.name).sort(), ["CITY MOTORS", "Gupta & Co"]);
  assert.deepEqual(list.firms.BEDGE.groups, [{ name: "BE - Direct", parent: "Sundry Debtors" }]);
  // CITY MOTORS: 2,040 Dr in MVC's books, nil in B Edge's
  assert.equal(find(list, "MVC", "CITY MOTORS").closing, 2040);
  assert.equal(find(list, "BEDGE", "CITY MOTORS").closing, 0);
  assert.equal(find(list, "BEDGE", "Gupta & Co").closing, 5000);
  assert.equal(list.firms.BEDGE.status.company, BEDGE_COMPANY);
  assert.ok(exportsTo(bedgeTally).every((c) => c === esc(BEDGE_COMPANY)));
  // MVC's PC never read B Edge's books, and the other way round
  assert.ok(!exportsTo(mvcTally).includes(esc(BEDGE_COMPANY)));

  if (process.env.SHOTS) {
    await page.getByText("B Edge total").waitFor();
    await closePopups(page);
    await page.getByRole("button", { name: "Expand all" }).click();
    await page.screenshot({ path: path.join(process.env.SHOTS, "debtors-both.png"), fullPage: true });
  }
});

test("income ledgers come from each firm's Tally and are kept apart; bills take only their firm's", async () => {
  const mvc = await prisma.tallyIncomeLedger.findMany({ where: { entity: "MVC", name: { in: ["Gst Return Monthly", "ITR Individual", "Old Service"] } }, orderBy: { name: "asc" } });
  // The spelling and group follow Tally; a ledger no longer there can't be picked
  assert.deepEqual(mvc.map((l) => [l.name, l.groupName, l.inTally]), [["Gst Return Monthly", "Gst", true], ["ITR Individual", "Income Tax Returns", true], ["Old Service", null, false]]);
  const bedge = await prisma.tallyIncomeLedger.findMany({ where: { entity: "BEDGE" } });
  assert.deepEqual(bedge.map((l) => [l.name, l.groupName, l.inTally]), [["Consultancy", "Sales Accounts", true]]);
  // Ledgers of other kinds (debtors, banks, taxes) never come in
  assert.equal(await prisma.tallyIncomeLedger.count({ where: { name: { in: ["CITY MOTORS", "HDFC Bank", "CGST"] } } }), 0);

  // Admin sees both firms' lists; MVC's billing manager only MVC's
  const asAdmin = (await api("/api/billing/tally/income-ledgers")).json;
  assert.deepEqual(asAdmin.firms, ["MVC", "BEDGE"]);
  const asMvc = (await api("/api/billing/tally/income-ledgers", { as: "mvcManager" })).json;
  assert.deepEqual(asMvc.firms, ["MVC"]);
  assert.ok(asMvc.ledgers.every((l) => l.entity === "MVC"));
  assert.ok(!asMvc.ledgers.some((l) => l.name === "Consultancy"));

  // Excel into B Edge's list (Admin); MVC's billing manager can't
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet("Ledgers");
  ws.addRow(["Tally income ledger", "Tally group"]);
  ws.addRow(["Payroll Services", "Services"]);
  const upload = async (as, entity) => {
    const form = new FormData();
    form.append("entity", entity);
    form.append("file", new Blob([await book.xlsx.writeBuffer()]), "ledgers.xlsx");
    const r = await fetch(`${BASE}/api/billing/tally/income-ledgers/file`, { method: "POST", headers: { cookie: `next-auth.session-token=${cookies[as]}` }, body: form });
    return { status: r.status, json: await r.json() };
  };
  assert.equal((await upload("mvcManager", "BEDGE")).status, 403);
  const added = await upload("admin", "BEDGE");
  assert.equal(added.status, 200);
  assert.equal(added.json.added, 1);
  assert.equal((await prisma.tallyIncomeLedger.findFirst({ where: { name: "Payroll Services" } })).entity, "BEDGE");

  // A B Edge bill takes only B Edge's ledgers; an MVC bill not one missing from Tally
  const byName = async (entity, name) => (await prisma.tallyIncomeLedger.findFirst({ where: { entity, name } })).id;
  const bill = (company) =>
    prisma.bill.create({ data: { company, type: company === "BEDGE" ? "BEDGE" : "GST", description: `Test ${RUN}`, workDate: new Date(), createdById: admin.id, clientId: client.id } });
  const bedgeBill = await bill("BEDGE");
  const setLedger = (b, id) => api(`/api/bills/${b.id}`, { method: "POST", body: { action: "set_income_ledger", incomeLedgerId: id } });
  assert.equal((await setLedger(bedgeBill, await byName("MVC", "Gst Return Monthly"))).status, 400);
  assert.equal((await setLedger(bedgeBill, await byName("BEDGE", "Consultancy"))).status, 200);
  const mvcBill = await bill("MVC");
  assert.equal((await setLedger(mvcBill, await byName("MVC", "Old Service"))).status, 400);
  assert.equal((await setLedger(mvcBill, await byName("MVC", "ITR Individual"))).status, 200);

  if (process.env.SHOTS) {
    const { page } = mvcPc;
    await page.goto(`${BASE}/dashboard/billing?tab=tally`);
    await page.getByText("Services (Tally income ledgers)").waitFor({ timeout: 60_000 });
    await closePopups(page);
    await page.getByText("Services (Tally income ledgers)").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(process.env.SHOTS, "services.png"), fullPage: true });
  }
});

test("Create Task: a new client is added from the client box, checked against existing clients, and chosen", async () => {
  const { page } = mvcPc;
  await page.goto(`${BASE}/dashboard/tasks/create`);
  await page.getByRole("button", { name: "Add a new client" }).waitFor({ timeout: 60_000 });
  await closePopups(page);
  // Typed in the client search: "Add … as a new client"
  await page.getByRole("combobox").filter({ hasText: "Select client" }).click();
  await page.getByPlaceholder("Search...").fill(`Gupta Steel ${RUN}`);
  await page.getByText(`Add “Gupta Steel ${RUN}” as a new client`).click();
  await page.getByLabel("Owner's name *").fill(`Asha Gupta ${RUN}`);
  assert.equal(await page.getByLabel("Company / firm name").inputValue(), `Gupta Steel ${RUN}`);
  await page.getByLabel("Mobile").fill("98765 43210");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "quick-client.png") });
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByText(`Gupta Steel ${RUN} added as a client`).waitFor({ timeout: 30_000 });
  // Chosen for the task
  await page.getByRole("combobox").filter({ hasText: `Gupta Steel ${RUN}` }).waitFor();
  const created = await prisma.client.findFirst({ where: { companyName: `Gupta Steel ${RUN}` } });
  assert.equal(created.managerId, admin.id);
  assert.deepEqual(created.phones, [{ number: "98765 43210", label: "Owner", whatsapp: true }]);

  // The same mobile again: offered the existing client instead
  await page.getByRole("button", { name: "Add a new client" }).click();
  await page.getByLabel("Owner's name *").fill("Someone Else");
  await page.getByLabel("Mobile").fill("9876543210");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByText("This may already be a client").waitFor();
  await page.getByText("same mobile").waitFor();
  await page.getByRole("button", { name: "Use this one" }).click();
  assert.equal(await prisma.client.count({ where: { phone: { contains: "43210" }, companyName: { contains: RUN } } }), 1);
  await page.getByRole("combobox").filter({ hasText: `Gupta Steel ${RUN}` }).waitFor();
  // Only Admin and partners may ask
  assert.equal((await api("/api/clients/similar?name=x", { as: null })).status, 403);
});

test("the ledger is as in Tally: entries, particulars, opening and closing; the firm is shown", async () => {
  const list = await debtorsList();
  const { json } = await api(`/api/debtors/${find(list, "MVC", "CITY MOTORS").id}`);
  const { ledger, party } = json;
  assert.equal(ledger.entity, "MVC");
  assert.equal(ledger.company, MVC_COMPANY);
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
  assert.equal(party.gstin, "23ABCDE1234F1Z5");

  const bedge = (await api(`/api/debtors/${find(list, "BEDGE", "CITY MOTORS").id}`)).json.ledger;
  assert.equal(bedge.company, BEDGE_COMPANY);
  assert.deepEqual(bedge.entries.map((e) => [e.p, e.t, e.dr, e.cr]), [["Consultancy", "Sales", 10000, 0], ["TDS Receivable", "Journal", 0, 1000], ["ICICI Bank", "Receipt", 0, 9000]]);
});

test("PDF and Excel carry the firm's company; downloads are logged under the firm", async () => {
  const list = await debtorsList();
  const id = find(list, "MVC", "CITY MOTORS").id;
  const pdf = await api(`/api/debtors/${id}/file?format=pdf&from=2026-04-01&to=2026-11-20`, { raw: true });
  assert.equal(pdf.status, 200);
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 4).toString(), "%PDF");
  if (process.env.SHOTS) await writeFile(path.join(process.env.SHOTS, "ledger.pdf"), pdfBytes);

  const xlsx = await api(`/api/debtors/${find(list, "BEDGE", "CITY MOTORS").id}/file?format=xlsx&from=2026-04-01&to=2026-11-20`, { raw: true });
  assert.equal(xlsx.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
  const rows = [];
  book.getWorksheet("Ledger").eachRow((r) => rows.push(r.values.slice(1)));
  assert.equal(rows[0][0], BEDGE_COMPANY);
  assert.equal(rows[1][0], "CITY MOTORS");

  const events = await prisma.tallyLedgerEvent.findMany({ where: { ledgerName: "CITY MOTORS" }, orderBy: { id: "asc" } });
  assert.deepEqual(events.map((e) => [e.entity, e.kind]), [["MVC", "pdf"], ["BEDGE", "excel"]]);
});

test("the client's Ledger tab finds the client's ledger in both firms; a connector's client is pointed to the connector's", async () => {
  const own = await api(`/api/clients/${client.id}/ledger`);
  assert.deepEqual(own.json.ledgers.map((l) => [l.entity, l.name]), [["MVC", "CITY MOTORS"], ["BEDGE", "CITY MOTORS"]]);
  const other = await prisma.client.create({ data: { contactPerson: `Via ${RUN}`, connectorId: connector.id, managerId: admin.id } });
  try {
    const via = await api(`/api/clients/${other.id}/ledger`);
    assert.deepEqual(via.json.ledgers, []);
    assert.deepEqual(via.json.connector.ledgers.map((l) => l.name), ["Sharma Traders"]);
  } finally {
    await prisma.client.delete({ where: { id: other.id } });
  }
});

test("Recovery: each firm's month worked out from its own ledgers (TDS counts as recovered)", async () => {
  // MVC, May 2026: dues 4,040 at the start (500 + 1,180 + 2,360), 2,000 received → 49.5%
  const may = (await api("/api/debtors/recovery?entity=MVC&month=2026-05")).json.recovery;
  assert.deepEqual(
    [may.month.openingDue, may.month.billed, may.month.received, may.month.tds, may.month.recovered, may.month.closingDue, may.month.recoveryPct, may.month.oldDuesRecovered],
    [4040, 0, 2000, 0, 2000, 2040, 49.5, 2000]
  );
  // The 2,040 left is from the bill of 15-Apr-26: 46 days old on 31-May
  assert.equal(may.month.ageing.d31_90, 2040);
  assert.equal(may.month.over90, 0);

  // B Edge: a WhatsApp send on 1-Nov, paid (TDS on 2-Nov, receipt on 3-Nov) within 15 days
  await prisma.tallyLedgerEvent.create({
    data: { entity: "BEDGE", ledgerName: "CITY MOTORS", kind: "whatsapp", periodFrom: new Date("2026-04-01"), periodTo: new Date("2026-10-31"), userId: admin.id, at: new Date("2026-11-01T06:00:00Z") },
  });
  const nov = (await api("/api/debtors/recovery?entity=BEDGE&month=2026-11")).json;
  const m = nov.recovery.month;
  // Dues 15,000 at the start (10,000 + 5,000); 9,000 received + 1,000 TDS → 66.7%
  assert.deepEqual([m.openingDue, m.billed, m.received, m.tds, m.recovered, m.recoveryPct, m.closingDue], [15000, 0, 9000, 1000, 10000, 66.7, 5000]);
  // Gupta's 5,000 is from July: over 90 days, nothing received
  assert.equal(m.over90, 5000);
  assert.equal(nov.recovery.actions[0].name, "Gupta & Co");
  assert.equal(nov.recovery.actions[0].lastRecoveredDate, null);
  assert.equal(nov.recovery.actions.length, 1);
  assert.deepEqual(nov.recovery.followUp, { sent: 1, paid: 1, paidAmount: 10000 });
  assert.deepEqual(nov.recovery.groups.map((g) => [g.group, g.recovered]), [["BE - Direct", 10000]]);
  // October: 10,000 billed; trend reaches back
  const oct = nov.recovery.trend.find((t) => t.month === "2026-10");
  assert.equal(oct.billed, 10000);
  assert.equal(nov.recovery.trend.at(-1).month, "2026-11");
  // MVC by Tally group: Sundry Debtor - Mukul (holding Via Connectors) and Sundry Debtor - Harsh
  const mvcNov = (await api("/api/debtors/recovery?entity=MVC&month=2026-11")).json.recovery;
  assert.deepEqual(mvcNov.groups.map((g) => [g.group, g.closingDue]).sort(), [["Sundry Debtor - Harsh", 0], ["Sundry Debtor - Mukul", 2630]]);

  assert.equal((await api("/api/debtors/recovery?entity=XYZ&month=2026-11")).status, 400);
  assert.equal((await api("/api/debtors/recovery?entity=MVC&month=2031-01")).status, 400);

  if (process.env.SHOTS) {
    const { page } = bedgePc;
    await page.goto(`${BASE}/dashboard/debtors?firm=BEDGE&view=recovery`);
    await page.getByText("Whom to chase: B Edge").waitFor({ timeout: 60_000 });
    await closePopups(page);
    await page.screenshot({ path: path.join(process.env.SHOTS, "debtors-recovery.png"), fullPage: true });
    await page.goto(`${BASE}/dashboard/debtors?firm=BOTH&view=recovery`);
    await page.getByText("Recovery: MVC and B Edge").waitFor({ timeout: 60_000 });
    await page.getByText("Recovery %").nth(1).waitFor();
    await page.screenshot({ path: path.join(process.env.SHOTS, "debtors-recovery-both.png"), fullPage: true });
  }
});

test("Sales (Admin): each firm and the total against the same period a year before, and why it moved", async () => {
  assert.equal((await api("/api/sales?firm=ALL&period=month&date=2026-11-21", { as: "partnerAllowed" })).status, 403);
  const status = (e) => api(`/api/debtors/status?entity=${e}`);
  assert.ok((await status("MVC")).json.readAt);

  // MVC, November 2026 to the 21st: 900 + 300 − 100 (credit note) = 1,100, against 700 (1–21 Nov 2025)
  const nov = (await api("/api/sales?firm=MVC&period=month&date=2026-11-21")).json.report;
  assert.equal(nov.period.from, "2026-11-01");
  assert.equal(nov.period.lyFrom, "2025-11-01");
  assert.equal(nov.period.lyTo, nov.period.to.replace("2026", "2025"));
  assert.deepEqual([nov.total.now.sales, nov.total.before.sales, nov.total.change, nov.total.growthPct], [1100, 700, 400, 57.1]);
  assert.deepEqual([nov.total.now.bills, nov.total.now.parties, nov.total.before.bills, nov.total.before.parties], [2, 2, 1, 1]);
  assert.deepEqual(nov.byService.map((r) => [r.name, r.now, r.before]), [["ITR Individual", 1100, 700]]);
  assert.deepEqual(nov.byIncomeGroup.map((r) => r.name), ["Income Tax Returns"]);
  assert.deepEqual(nov.byVoucherType.map((r) => [r.name, r.now, r.before]).sort(), [["Credit Note", -100, 0], ["Sales", 1200, 700]]);
  assert.deepEqual(
    nov.byDebtorGroup.map((r) => [r.name, r.now, r.before]).sort(),
    [["Not a Sundry Debtor now", 300, 0], ["Sundry Debtor - Harsh", 0, 700], ["Via Connectors", 800, 0]]
  );
  // 700 a year before + 1,100 new clients − 700 not billed this time ± 0 = 1,100
  assert.deepEqual(nov.clients.bridge, { before: 700, fromNew: 1100, fromLost: -700, fromContinuing: 0, now: 1100 });
  assert.deepEqual(nov.clients.topNew.map((c) => [c.party, c.now]), [["Sharma Traders", 800], ["Cash", 300]]);
  assert.deepEqual(nov.clients.topLost.map((c) => [c.party, c.before]), [["Old Client & Sons", 700]]);

  // The financial year to date: MVC 2,000 + 500 + 1,100 = 3,600 against 1,000 + 700 = 1,700; B Edge 15,000 against nothing
  const fy = (await api("/api/sales?firm=ALL&period=fy&date=2026-11-21")).json;
  assert.deepEqual([fy.report.firms.MVC.now.sales, fy.report.firms.MVC.before.sales], [3600, 1700]);
  assert.deepEqual([fy.report.firms.BEDGE.now.sales, fy.report.firms.BEDGE.before.sales, fy.report.firms.BEDGE.growthPct], [15000, 0, null]);
  assert.deepEqual([fy.report.total.now.sales, fy.report.total.before.sales, fy.report.total.growthPct], [18600, 1700, 994.1]);
  assert.ok(fy.report.byService.some((r) => r.name === "Consultancy (B Edge)"));
  assert.deepEqual(fy.firms.map((f) => [f.entity, f.hasSales]), [["MVC", true], ["BEDGE", true]]);
  const apr = fy.report.trend.find((t) => t.month === "2026-04");
  assert.deepEqual([apr.now, apr.before], [2000, 0]);
  assert.equal(fy.report.trend.find((t) => t.month === "2027-01").now, null);

  // Two years back is kept: November 2025 against November 2024 (400)
  const nov25 = (await api("/api/sales?firm=MVC&period=month&date=2025-11-30")).json.report;
  assert.deepEqual([nov25.total.now.sales, nov25.total.before.sales, nov25.total.growthPct], [700, 400, 75]);
  // A day, and a week against the same weekdays 52 weeks before
  const day = (await api("/api/sales?firm=MVC&period=day&date=2026-11-10")).json.report;
  assert.deepEqual([day.total.now.sales, day.period.lyFrom], [900, "2025-11-10"]);
  const week = (await api("/api/sales?firm=MVC&period=week&date=2026-11-12")).json.report;
  assert.deepEqual([week.period.from, week.period.to, week.period.lyFrom], ["2026-11-09", "2026-11-15", "2025-11-10"]);
  assert.equal(week.total.now.sales, 1100);
  const quarter = (await api("/api/sales?firm=MVC&period=quarter&date=2026-11-21")).json.report;
  assert.equal(quarter.period.from, "2026-10-01");
  assert.equal((await api("/api/sales?firm=MVC&period=month&date=2031-01-01")).status, 400);

  const xlsx = await api("/api/sales/export?firm=ALL&period=month&date=2026-11-21", { raw: true });
  assert.equal(xlsx.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
  assert.equal(book.worksheets.length, 2);
  const totalOf = (ws) => ws.getRow(ws.rowCount).getCell(9).value;
  assert.deepEqual(book.worksheets.map(totalOf), [1100, 700]);

  if (process.env.SHOTS) {
    const { page } = mvcPc;
    await page.goto(`${BASE}/dashboard/sales?firm=ALL&period=fy&date=2026-11-21`);
    await page.getByText("Where the change came from").waitFor({ timeout: 60_000 });
    await closePopups(page);
    await page.screenshot({ path: path.join(process.env.SHOTS, "sales.png"), fullPage: true });
  }
});

test("Refresh now for MVC: MVC's PC sends, only the changed ledger, and B Edge's time stays", async () => {
  const before = await debtorsList();
  const bedgeReadAt = before.firms.BEDGE.status.readAt;
  const sharmaUpdated = (await prisma.tallyDebtorLedger.findUnique({ where: { id: find(before, "MVC", "Sharma Traders").id } })).updatedAt;
  // A payment received in MVC's Tally
  mvcData.vouchers.push({ id: 7, date: "20261119", type: "Receipt", no: "R-30", list: "ALLLEDGERENTRIES.LIST", entries: [["HDFC Bank", -1040], ["CITY MOTORS", 1040]] });
  mvcData.ledgers[0].closing = -1000;

  const asked = await api("/api/debtors/refresh", { method: "POST", body: { entity: "MVC" } });
  assert.equal(asked.status, 200);
  assert.ok(asked.json.refresh);
  let status;
  for (let i = 0; i < 40; i++) {
    await wait(3000);
    status = (await api("/api/debtors/status?entity=MVC")).json;
    if (status.readAt !== before.firms.MVC.status.readAt) break;
  }
  assert.notEqual(status.readAt, before.firms.MVC.status.readAt, "MVC's Tally PC did not answer the refresh");
  assert.equal(status.trigger, "refresh");
  assert.equal(status.refresh, null);

  const { json } = await api(`/api/debtors/${find(before, "MVC", "CITY MOTORS").id}`);
  assert.equal(json.ledger.closing, 1000);
  assert.equal((await prisma.tallyDebtorLedger.findUnique({ where: { id: find(before, "MVC", "Sharma Traders").id } })).updatedAt.getTime(), sharmaUpdated.getTime());
  assert.equal((await api("/api/debtors/status?entity=BEDGE")).json.readAt, bedgeReadAt);
});

test("a failed update shows why and is not tried again on its own; Refresh now works once Tally is ready", async () => {
  // B Edge's company is shut on its Tally PC
  bedgeTally.companies = ["Some Other Co"];
  const sent = bedgeTally.received.length;
  await api("/api/debtors/refresh", { method: "POST", body: { entity: "BEDGE" } });
  let status;
  for (let i = 0; i < 40; i++) {
    await wait(3000);
    status = (await api("/api/debtors/status?entity=BEDGE")).json;
    if (status.error) break;
  }
  assert.match(status.error?.message ?? "", /"B Edge Consulting LLP" is not open in TallyPrime/);
  assert.equal(status.refresh, null);
  // For over two of the PC's 30-second checks nothing more is asked of Tally
  const afterError = bedgeTally.received.length;
  assert.ok(afterError > sent);
  await wait(70_000);
  assert.equal(bedgeTally.received.length, afterError, "the failed update was tried again on its own");

  // The company is opened again; someone presses Refresh now
  bedgeTally.companies = [BEDGE_COMPANY];
  const readAt = status.readAt;
  await api("/api/debtors/refresh", { method: "POST", body: { entity: "BEDGE" } });
  for (let i = 0; i < 40; i++) {
    await wait(3000);
    status = (await api("/api/debtors/status?entity=BEDGE")).json;
    if (status.readAt !== readAt) break;
  }
  assert.notEqual(status.readAt, readAt);
  assert.equal(status.error, null);
});

test("each firm's PC key: wrong keys refused; a new key for one firm stops only that firm's old key", async () => {
  assert.equal((await api("/api/tally-sync/poll", { key: "mvct_wrongwrongwrongwrongwrongwrong" })).status, 401);
  const mvc1 = (await api("/api/debtors/connect", { method: "POST", body: { entity: "MVC", company: MVC_COMPANY } })).json.key;
  const bedge1 = (await api("/api/debtors/connect", { method: "POST", body: { entity: "BEDGE", company: BEDGE_COMPANY } })).json.key;
  const poll = await api("/api/tally-sync/poll", { key: bedge1 });
  assert.equal(poll.json.entity, "BEDGE");
  assert.equal(poll.json.company, BEDGE_COMPANY);
  const mvc2 = (await api("/api/debtors/connect", { method: "POST", body: { entity: "MVC", company: MVC_COMPANY } })).json.key;
  assert.equal((await api("/api/tally-sync/poll", { key: mvc1 })).status, 401);
  assert.equal((await api("/api/tally-sync/poll", { key: mvc2 })).json.entity, "MVC");
  assert.equal((await api("/api/tally-sync/poll", { key: bedge1 })).status, 200);
  assert.equal((await api("/api/tally-sync/commit", { method: "POST", key: mvc2, body: { readAt: "x" } })).status, 400);
  assert.equal((await api("/api/debtors/connect", { method: "POST", body: { entity: "XYZ", company: "A" } })).status, 400);
  // The same companies: the debtors stay
  assert.equal((await debtorsList()).ledgers.length, 5);
});

test("WhatsApp: no link without file storage; an unknown link says it expired", async () => {
  const list = await debtorsList();
  const share = await api(`/api/debtors/${find(list, "MVC", "CITY MOTORS").id}/share`, { method: "POST", body: { from: "2026-04-01", to: "2026-11-20", narration: false } });
  // This test app has no Cloudflare R2
  assert.equal(share.status, 503);
  const gone = await api("/api/ledger-link/abcdefghijklmnopqrstuvwxyz", { as: null, raw: true });
  assert.equal(gone.status, 410);
});
