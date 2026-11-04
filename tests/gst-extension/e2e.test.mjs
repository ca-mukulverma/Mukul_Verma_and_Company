import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { CAPTCHA, LOGIN, OTP, startApp, startPortal } from "./mock-servers.mjs";

// The GST extension (public/gst-extension), loaded unpacked in Chromium,
// against the mock portal and a stand-in app page. A simulated staff member
// types the captcha and OTP. Run: node --test tests/gst-extension/
// (uses the Playwright installed on the machine, or `npm i -D playwright`).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { BUILT_IN_SETTINGS: settings } = await createJiti(import.meta.url).import(path.join(root, "src/lib/gst-portal-settings.ts"));

let portal, app, other, context, dir, appPage;

before(async () => {
  portal = await startPortal();
  app = await startApp();
  other = await startApp();
  // The extension as the app's download builds it (gst-extension.ts)
  dir = await mkdtemp(path.join(tmpdir(), "gst-ext-test-"));
  const ext = path.join(dir, "ext");
  await cp(path.join(root, "public/gst-extension"), ext, { recursive: true });
  const fill = async (name, from, to) => writeFile(path.join(ext, name), (await readFile(path.join(ext, name), "utf8")).replace(from, to));
  await fill("manifest.json", "__APP_MATCH__", "http://127.0.0.1/*");
  await fill("background.js", "__APP_ORIGIN__", `http://127.0.0.1:${app.port}`);

  context = await chromium.launchPersistentContext(path.join(dir, "profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await context.route(/^https:\/\/[^/]*\.gst\.gov\.in\//, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${portal.base}/${url.host}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  appPage = await context.newPage();
  await appPage.goto(`http://127.0.0.1:${app.port}/dashboard/compliance`);
});

after(async () => {
  await context?.close();
  portal?.close();
  app?.close();
  other?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const ask = (message) => appPage.evaluate((m) => window.ask(m), message);
const statuses = () => appPage.evaluate(() => window.statuses.map((s) => s.status));
async function until(check, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // A page still navigating throws: try again
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`Timed out waiting for ${what}`);
}

test("the app page sees the extension", async () => {
  assert.equal(await appPage.evaluate(() => document.documentElement.getAttribute("data-mvc-gst")), "0.3.4");
  const answer = await ask({ type: "gst-status" });
  assert.equal(answer.ok, true);
  assert.equal(answer.run, null);
});

test("login filled, captcha and OTP typed by staff, logged in, logged out", async () => {
  const opened = context.waitForEvent("page");
  const answer = await ask({ type: "gst-login", runId: "run-1", clientId: "c1", clientName: "CITY MOTORS", settings, login: LOGIN });
  assert.equal(answer.ok, true, answer.error);
  assert.equal(answer.run.status, "waiting-login");
  assert.equal(answer.run.settings, undefined, "settings stay in the extension");

  const tab = await opened;
  await tab.waitForURL(/services\/login/);
  await until(() => tab.evaluate(() => document.activeElement?.id === "captcha"), "the cursor in the captcha");
  assert.equal(await tab.inputValue("#username"), LOGIN.username);
  assert.equal(await tab.inputValue("#user_pass"), LOGIN.password);
  assert.equal(await tab.inputValue("#captcha"), "", "the captcha is never filled");

  // Staff
  await tab.keyboard.type(CAPTCHA);
  await tab.click("#login");
  await tab.fill("#otp", OTP);
  await tab.click("#verify");

  await until(async () => (await statuses()).includes("logged-in"), "logged-in");
  assert.deepEqual(portal.state.events, ["login", "otp"]);
  assert.equal(portal.state.typed.username, LOGIN.username);
  assert.equal(portal.state.typed.password, LOGIN.password);
  assert.equal(portal.state.typed.captcha, CAPTCHA);
  assert.ok(portal.state.typed.inputs >= 2, "the page saw input events for the filled fields");

  // One client at a time in a browser
  const second = await ask({ type: "gst-login", runId: "run-2", clientId: "c2", clientName: "OTHER", settings, login: LOGIN });
  assert.equal(second.ok, false);
  assert.match(second.error, /open for CITY MOTORS/);

  const closed = tab.waitForEvent("close");
  assert.equal((await ask({ type: "gst-logout", runId: "run-1" })).ok, true);
  await closed;
  await until(async () => (await statuses()).at(-1) === "logged-out", "logged-out");
  assert.equal(portal.state.events.at(-1), "logout");
});

// Logs in as staff would and returns the portal tab
async function logIn(runId) {
  const opened = context.waitForEvent("page");
  const answer = await ask({ type: "gst-login", runId, clientId: "c1", clientName: "CITY MOTORS", settings, login: LOGIN, autoLogout: true });
  assert.equal(answer.ok, true, answer.error);
  const tab = await opened;
  await until(() => tab.evaluate(() => document.activeElement?.id === "captcha"), "the cursor in the captcha");
  await tab.keyboard.type(CAPTCHA);
  await tab.click("#login");
  await tab.fill("#otp", OTP);
  await tab.click("#verify");
  await until(async () => (await ask({ type: "gst-status" })).run?.status === "logged-in", "logged-in");
  return tab;
}

const text = (f) => Buffer.from(f.base64, "base64").toString("utf8");
const fetchFile = (runId, kind, month, extra = {}) => ask({ type: "gst-fetch", runId, file: { kind, month, label: `${kind} ${month}`, ...extra } });

test("filed returns are fetched by the taught steps; unfiled ones are reported, never filed", { timeout: 300000 }, async () => {
  const tab = await logIn("run-f");
  const runId = "run-f";

  const r3b = await fetchFile(runId, "GSTR3B_PDF", "2026-09");
  assert.equal(r3b.result, "file", r3b.message);
  assert.equal(r3b.files[0].name, "GSTR3B_23AAFFC2640H1ZX_092026.pdf");
  assert.match(text(r3b.files[0]), /^%PDF-1\.4 GSTR-3B 092026/);
  assert.ok(portal.state.clicks.includes("REMIND ME LATER"), "the Aadhaar pop-up is closed when it shows");

  // The summary page fails to load the first time: tried again from the dashboard
  portal.state.failGstr1Once = true;
  const r1 = await fetchFile(runId, "GSTR1_PDF", "2026-09");
  assert.equal(r1.result, "file", r1.message);
  assert.match(text(r1.files[0]), /GSTR-1 092026/);
  assert.equal(portal.state.failGstr1Once, false);

  // A NIL GSTR-1: the page's DOWNLOAD FILED (PDF) stands in for VIEW SUMMARY
  const nil = await fetchFile(runId, "GSTR1_PDF", "2026-07");
  assert.equal(nil.result, "file", nil.message);
  assert.match(text(nil.files[0]), /GSTR-1 NIL 072026/);

  // The portal's own error page is named, not a blind timeout
  const err = await fetchFile(runId, "GSTR3B_PDF", "2026-08");
  assert.equal(err.result, "error");
  assert.match(err.message, /own error page/);

  const r2b = await fetchFile(runId, "GSTR2B_JSON", "2026-09");
  assert.equal(r2b.result, "file", r2b.message);
  assert.equal(JSON.parse(text(r2b.files[0])).data.rtnprd, "092026", "a file handed to Chrome as a normal download is caught too");
  // The test browser renames downloads; Chrome keeps the page's name (else the app names it)
  assert.match(r2b.files[0].name, /^(092026_23AAFFC2640H1ZX_GSTR2B\.json)?$/);

  // GSTR-1 JSON: each visit clicks Generate once; the first starts it, a
  // later one gets the links, every part fetched
  const ask1 = await fetchFile(runId, "GSTR1_JSON", "2026-09");
  assert.equal(ask1.result, "requested", ask1.message);
  assert.match(ask1.message, /request for generation of JSON file has been accepted/);
  assert.equal(portal.state.jsonAsked, 1);
  const got = await fetchFile(runId, "GSTR1_JSON", "2026-09");
  assert.equal(got.result, "file", got.message);
  assert.equal(got.files.length, 2);
  assert.match(text(got.files[0]), /GSTR1 JSON 092026 part 1/);
  assert.match(text(got.files[1]), /GSTR1 JSON 092026 part 2/);
  assert.equal(portal.state.jsonAsked, 2, "Generate clicked once per visit, never twice");

  // October is not filed: the boxes offer Prepare / File instead of Download
  const n3b = await fetchFile(runId, "GSTR3B_PDF", "2026-10");
  assert.equal(n3b.result, "not-filed");
  assert.match(n3b.message, /GSTR-3B Oct 2026 is not filed on the portal yet \(status: not filed\): it offers Prepare Online \/ Prepare offline/);
  const n1 = await fetchFile(runId, "GSTR1_PDF", "2026-10");
  assert.equal(n1.result, "not-filed");
  assert.match(n1.message, /status: submitted.*FILE GSTR1/);
  const nj = await fetchFile(runId, "GSTR1_JSON", "2026-10");
  assert.equal(nj.result, "not-filed");
  const taught = await fetchFile(runId, "GSTR1A_PDF", "2026-09");
  assert.equal(taught.result, "not-taught");

  const pressed = portal.state.clicks;
  for (const never of [/prepare/i, /^file/i, /file statement/i]) assert.ok(!pressed.some((c) => never.test(c)), `never pressed ${never}: ${pressed.join(", ")}`);
  assert.ok(!pressed.includes("VIEW GSTR3B"));

  const closed = tab.waitForEvent("close");
  assert.equal((await ask({ type: "gst-logout", runId })).ok, true);
  await closed;
});

test("no saved login: the username is focused and the app is told", async () => {
  const opened = context.waitForEvent("page");
  const answer = await ask({ type: "gst-login", runId: "run-3", clientId: "c3", clientName: "NO LOGIN", settings, login: null });
  assert.equal(answer.ok, true, answer.error);
  assert.match(answer.run.note, /type the username and password/);
  const tab = await opened;
  await until(() => tab.evaluate(() => document.activeElement?.id === "username"), "the cursor in the username");
  assert.equal(await tab.inputValue("#username"), "");

  // Staff close the tab instead of logging in
  await tab.close();
  await until(async () => (await statuses()).at(-1) === "closed", "closed");
});

test("addresses off the GST portal are refused", async () => {
  const bad = { ...settings, urls: { ...settings.urls, login: "https://example.com/login" } };
  const answer = await ask({ type: "gst-login", runId: "run-4", clientId: "c4", clientName: "X", settings: bad, login: LOGIN });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /settings/);
});

test("pages of another origin can't use the extension", async () => {
  const page = await context.newPage();
  // Same host, other port: the bridge runs, the worker refuses
  await page.goto(`http://127.0.0.1:${other.port}/`);
  const pagesBefore = context.pages().length;
  const answer = await page.evaluate(() => window.ask({ type: "gst-status" }));
  assert.notEqual(answer?.ok, true);
  assert.equal(context.pages().length, pagesBefore);
  // Another host: not even the bridge
  await page.goto(`http://localhost:${app.port}/`);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-mvc-gst")), null);
  await page.close();
});
