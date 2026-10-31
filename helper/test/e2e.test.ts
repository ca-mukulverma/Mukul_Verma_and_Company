import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { OfficeApi, type ClaimedJob } from "../src/api";
import { isActiveTime, loadConfig, parseDays, parseHours } from "../src/config";
import { testHooks } from "../src/portal/gst-portal";
import { runJob } from "../src/run-job";
import { CAPTCHA, GSTIN, HELPER_KEY, LOGIN, OTP, startMock } from "./mock-server";

// A whole job, headless, against the mock GST portal and mock office app
// (test/mock-server.ts). A simulated staff member types the captcha and OTP.

const MONTHS = ["2025-04", "2025-05", "2025-06"];

const job: ClaimedJob = {
  id: "job-1",
  months: MONTHS,
  returns: ["GSTR1", "GSTR3B", "GSTR2B"],
  formats: ["PDF", "JSON", "EXCEL"],
  client: { id: "client-1", name: "CITY MOTORS", gstin: GSTIN },
  login: LOGIN,
  // April's GSTR-1 JSON was asked for by an earlier job
  pendingJson: [{ id: "req-earlier-apr", returnType: "GSTR1", month: "2025-04", requestedAt: new Date(Date.now() - 60 * 60_000).toISOString() }],
};

let mock: Awaited<ReturnType<typeof startMock>>;
let downloads: string;
let staffError: unknown = null;
let outcome: string;

before(async () => {
  mock = await startMock({
    job,
    jsonAlreadyRequested: ["2025-04"],
    jsonParts: { "2025-05": 2 },
    noGstr3b: ["2025-06"],
    jsonReadyMs: 1500,
  });
  downloads = await mkdtemp(path.join(tmpdir(), "gst-helper-test-"));

  testHooks.headless = true;
  // Every *.gst.gov.in request goes to the mock portal
  testHooks.onContext = async (context) => {
    await context.route(/^https:\/\/[^/]*\.gst\.gov\.in\//, async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${mock.base}/portal/${url.host}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
  };
  // The staff member at the helper PC: types the captcha, then the OTP
  testHooks.onPage = (page) => {
    (async () => {
      await page.waitForFunction(() => document.activeElement?.id === "captcha", undefined, { timeout: 30_000 });
      await page.keyboard.type(CAPTCHA);
      await page.getByRole("button", { name: "LOGIN" }).click();
      await page.locator("#otp").fill(OTP, { timeout: 30_000 });
      await page.getByRole("button", { name: "VERIFY" }).click();
    })().catch((error) => {
      staffError = error;
    });
  };

  const config = loadConfig({
    PORTAL_URL: mock.base,
    GST_HELPER_KEY: HELPER_KEY,
    HELPER_NAME: "TEST-PC",
    DOWNLOAD_DIR: downloads,
    KEEP_LOCAL_COPIES: "false",
    LOGIN_WAIT_MINUTES: "1",
    JSON_READY_MINUTES: "0.02",
    JSON_CHECK_EVERY_MINUTES: "0.01",
    JSON_MAX_WAIT_MINUTES: "0.5",
    CLICK_PAUSE_MS: "5-15",
  });
  const api = new OfficeApi(config.appUrl, config.helperKey);
  const claimed = await api.claim(config.helperName);
  assert.equal(claimed.job?.id, job.id);
  outcome = await runJob(claimed.job!, { api, config, beep: () => undefined });
});

after(async () => {
  await mock?.close();
  if (downloads) await rm(downloads, { recursive: true, force: true });
});

test("the staff member logs in with the captcha and OTP; the helper fills the saved login", () => {
  assert.equal(staffError, null);
  assert.equal(mock.state.typed.username, LOGIN.username);
  assert.equal(mock.state.typed.password, LOGIN.password);
  assert.equal(mock.state.typed.captcha, CAPTCHA);
  assert.equal(mock.state.typed.otp, OTP);
  const statuses = mock.state.statuses.map((s) => s.status).filter(Boolean);
  assert.deepEqual(statuses, ["WAITING_LOGIN", "RUNNING"]);
  assert.equal(mock.state.badKeys, 0);
});

test("GSTR-1 JSON is asked for before any PDF is downloaded", () => {
  const events = mock.state.events;
  const lastGenerate = Math.max(...events.map((e, i) => (e.startsWith("generate:") ? i : -1)));
  const firstPdf = events.findIndex((e) => /^file:\w+:PDF:/.test(e));
  assert.ok(lastGenerate >= 0 && firstPdf > lastGenerate, events.join("\n"));
  assert.deepEqual(mock.state.jsonCreates.map((c) => c.month), ["2025-05", "2025-06"]);
});

test("an earlier JSON request is reused without clicking Generate again", () => {
  assert.ok(!mock.state.events.includes("generate:2025-04"));
  const april = mock.state.documents.filter((d) => d.returnType === "GSTR1" && d.format === "JSON" && d.month === "2025-04");
  assert.equal(april.length, 1);
  assert.equal(april[0].gst?.form, "GSTR1");
  assert.deepEqual(mock.state.jsonUpdates.find((u) => u.requestId === "req-earlier-apr"), { action: "update", requestId: "req-earlier-apr", status: "DOWNLOADED", parts: 1 });
});

test("a GSTR-1 JSON in two parts is uploaded without figures", () => {
  const may = mock.state.documents.filter((d) => d.returnType === "GSTR1" && d.format === "JSON" && d.month === "2025-05");
  assert.equal(may.length, 2);
  for (const doc of may) assert.equal(doc.gst, null);
  assert.equal(mock.state.jsonUpdates.find((u) => u.requestId === "req-2025-05")?.parts, 2);
  const june = mock.state.documents.find((d) => d.returnType === "GSTR1" && d.format === "JSON" && d.month === "2025-06");
  assert.equal(june?.gst?.month, "2025-06");
});

test("a month without GSTR-3B is noted as not available, and the job is DONE", () => {
  assert.equal(outcome, "DONE");
  assert.equal(mock.state.finish?.status, "DONE");
  assert.equal(mock.state.finish?.error, null);
  const log = mock.state.finish?.log?.join("\n") ?? "";
  assert.match(log, /Not available: GSTR-3B Jun 2025 PDF/);
  assert.ok(mock.state.events.includes("logout"));
});

test("every file is uploaded, with its R2 upload finished first", async () => {
  const key = (d: { returnType: string; format: string; month: string }) => `${d.returnType}:${d.format}:${d.month}`;
  const expected = [
    ...MONTHS.map((m) => `GSTR1:PDF:${m}`),
    "GSTR1:JSON:2025-04",
    "GSTR1:JSON:2025-05",
    "GSTR1:JSON:2025-05",
    "GSTR1:JSON:2025-06",
    "GSTR3B:PDF:2025-04",
    "GSTR3B:PDF:2025-05",
    ...MONTHS.flatMap((m) => [`GSTR2B:PDF:${m}`, `GSTR2B:JSON:${m}`, `GSTR2B:EXCEL:${m}`]),
  ].sort();
  assert.deepEqual(mock.state.documents.map(key).sort(), expected);
  assert.equal(mock.state.uploadUrls.length, expected.length);
  for (const doc of mock.state.documents) assert.ok(mock.state.puts.some((p) => p.key === doc.sha256));
  // Local copies are deleted after upload (KEEP_LOCAL_COPIES=false)
  const left = await readdir(downloads, { recursive: true, withFileTypes: true });
  assert.deepEqual(left.filter((e) => e.isFile()).map((e) => e.name), []);
});

test("JSON is gzipped before upload; other files are not", () => {
  for (const doc of mock.state.documents) {
    const put = mock.state.puts.find((p) => p.key === doc.sha256)!;
    if (doc.format === "JSON") {
      assert.equal(doc.contentType, "application/json");
      assert.equal(doc.gzipped, true);
      assert.equal(put.headers["content-encoding"], "gzip");
      assert.doesNotThrow(() => JSON.parse(gunzipSync(put.body).toString()));
      assert.equal(doc.size, put.body.length);
    } else {
      assert.equal(doc.gzipped, false);
      assert.equal(put.headers["content-encoding"], undefined);
    }
  }
  const twoB = mock.state.documents.find((d) => d.returnType === "GSTR2B" && d.format === "JSON");
  assert.equal(twoB?.gst?.form, "GSTR2B");
});

test("active days and hours", () => {
  assert.deepEqual([...parseDays("1-6")], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseHours("10:00-20:00"), [600, 1200]);
  const config = loadConfig({ PORTAL_URL: "https://example.com", GST_HELPER_KEY: HELPER_KEY });
  assert.equal(isActiveTime(config, new Date(2026, 10, 2, 11, 0)), true); // Monday 11:00
  assert.equal(isActiveTime(config, new Date(2026, 10, 2, 21, 0)), false); // Monday 21:00
  assert.equal(isActiveTime(config, new Date(2026, 10, 1, 11, 0)), false); // Sunday
});
