import { readFile } from "node:fs/promises";
import { chromium, errors, type Browser, type BrowserContext, type Download, type LaunchOptions, type Locator, type Page, type Response } from "playwright";
import type { Config } from "../config";
import { sleep } from "../config";
import type { FileFormat, ReturnType } from "../api";
import { DASHBOARD, GSTR1_JSON, LOGIN, NOT_AVAILABLE, RECIPES, SESSION_EXPIRED, URLS, type Step, type Target } from "./selectors";

// Drives the real GST portal in a visible Chromium window. Staff type the
// captcha and OTP themselves; nothing here reads, solves or skips them.
// Every portal-specific detail (addresses, buttons, texts) is in
// selectors.ts.

// Used only by the end-to-end test (test/): run headless against the mock
// portal and play the staff member who types the captcha and OTP
export const testHooks: {
  headless: boolean;
  launchOptions?: LaunchOptions;
  onContext?: (context: BrowserContext) => Promise<void>;
  onPage?: (page: Page) => void;
} = { headless: false };

export class LoginTimeoutError extends Error {
  constructor(minutes: number) {
    super(`Nobody completed the login (captcha and OTP) within ${minutes} minutes`);
    this.name = "LoginTimeoutError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("The GST portal session expired or logged out");
    this.name = "SessionExpiredError";
  }
}

// Nothing to download for this period (e.g. the middle month of a quarterly
// filer, or a return not filed yet); not an error
export class NotAvailableError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NotAvailableError";
  }
}

export interface Captured {
  name: string;
  data: Uint8Array;
}

export type JsonCollect = { kind: "files"; files: Captured[] } | { kind: "pending" } | { kind: "none" };

const FILE_TYPES = /application\/(pdf|zip|x-zip-compressed|octet-stream|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)|text\/csv/i;
const EXTENSIONS: Record<string, string> = { pdf: ".pdf", zip: ".zip", "x-zip-compressed": ".zip", "vnd.ms-excel": ".xls", "vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx", csv: ".csv" };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const LABELS: Record<ReturnType, string> = { GSTR1: "GSTR-1", GSTR3B: "GSTR-3B", GSTR2B: "GSTR-2B" };

const CAPTURE_TIMEOUT_MS = 90_000;
const WAIT_MS = 30_000;

export function hasRecipe(returnType: ReturnType, format: FileFormat) {
  return !!RECIPES[returnType][format];
}

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.map((p) => (text.match(new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g")) ?? []).length);
}

// The file name from a Content-Disposition header, the address, or the type
function responseFileName(response: Response): string {
  const disposition = response.headers()["content-disposition"] ?? "";
  const quoted = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  if (quoted) return decodeURIComponent(quoted.trim());
  const last = new URL(response.url()).pathname.split("/").pop() ?? "";
  if (/\.\w{2,4}$/.test(last)) return decodeURIComponent(last);
  const type = (response.headers()["content-type"] ?? "").split(";")[0].split("/")[1] ?? "";
  return `download${EXTENSIONS[type] ?? ""}`;
}

export class GstPortal {
  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly config: Config
  ) {}

  // A visible window with a fresh context, so no cookies are shared between clients
  static async open(config: Config): Promise<GstPortal> {
    const browser = await chromium.launch({ headless: testHooks.headless, ...testHooks.launchOptions });
    try {
      const context = await browser.newContext({ acceptDownloads: true, viewport: testHooks.headless ? undefined : null });
      await testHooks.onContext?.(context);
      const page = await context.newPage();
      testHooks.onPage?.(page);
      return new GstPortal(browser, context, page, config);
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  async close() {
    await this.browser.close().catch(() => undefined);
  }

  // 2–5 s between clicks, like a person
  private async pause() {
    const [min, max] = this.config.clickPauseMs;
    await sleep(min + Math.random() * Math.max(0, max - min));
  }

  private async bodyText(): Promise<string> {
    return this.page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  }

  private async checkSession() {
    const url = this.page.url();
    if (url.startsWith(URLS.login) || SESSION_EXPIRED.some((p) => p.test(url))) throw new SessionExpiredError();
    const text = await this.bodyText();
    if (SESSION_EXPIRED.some((p) => p.test(text))) throw new SessionExpiredError();
  }

  private locate(target: Target, scope: Page | Locator = this.page): Locator {
    if ("css" in target) return scope.locator(target.css);
    if (target.role) return scope.getByRole(target.role, { name: target.text });
    return scope.getByRole("button", { name: target.text }).or(scope.getByRole("link", { name: target.text }));
  }

  private async click(target: Target, scope: Page | Locator = this.page) {
    const element = this.locate(target, scope).first();
    await element.waitFor({ state: "visible", timeout: WAIT_MS });
    await element.click();
    await this.pause();
    await this.checkSession();
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  // Fills the saved username and password, puts the cursor in the captcha and
  // brings the window to the front; staff type the captcha (and OTP). With no
  // saved login, staff type everything.
  async login(login: { username: string; password: string } | null, options: { waitMinutes: number; onTick?: () => Promise<void> }) {
    const { page } = this;
    await page.goto(URLS.login, { waitUntil: "domcontentloaded" });
    if (login) {
      await page.locator(LOGIN.username).fill(login.username, { timeout: WAIT_MS });
      await page.locator(LOGIN.password).fill(login.password, { timeout: WAIT_MS });
    }
    await page.locator(login ? LOGIN.captcha : LOGIN.username).focus({ timeout: WAIT_MS });
    await page.bringToFront();

    const deadline = Date.now() + options.waitMinutes * 60_000;
    while (!URLS.loggedIn.test(page.url())) {
      const left = deadline - Date.now();
      if (left <= 0) throw new LoginTimeoutError(options.waitMinutes);
      try {
        await page.waitForURL(URLS.loggedIn, { timeout: Math.min(left, 30_000), waitUntil: "domcontentloaded" });
      } catch (error) {
        if (!(error instanceof errors.TimeoutError)) throw error;
        await options.onTick?.();
      }
    }
    await this.pause();
  }

  // ─── Returns Dashboard ────────────────────────────────────────────────────

  private async selectByText(field: { label: RegExp; css: string }, option: RegExp, what: string) {
    const select = this.page.locator("select").and(this.page.getByLabel(field.label)).or(this.page.locator(field.css)).first();
    await select.waitFor({ state: "visible", timeout: WAIT_MS });
    // The options of a list can arrive after the previous list is chosen
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const options = await select.locator("option").evaluateAll((list) => list.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? "" })));
      const match = options.find((o) => option.test(o.text.trim()));
      if (match) {
        await select.selectOption(match.value);
        await this.pause();
        return;
      }
      await sleep(500);
    }
    throw new Error(`The Returns Dashboard has no ${what} in its list`);
  }

  // Opens the Returns Dashboard on a month ("2025-04")
  async openPeriod(month: string) {
    const [year, m] = month.split("-").map(Number);
    const fy = m >= 4 ? year : year - 1;
    const quarter = (m >= 4 ? Math.ceil((m - 3) / 3) : 4) as 1 | 2 | 3 | 4;
    await this.page.goto(URLS.returnsDashboard, { waitUntil: "domcontentloaded" });
    await this.checkSession();
    await this.pause();
    await this.selectByText(DASHBOARD.financialYear, DASHBOARD.financialYearOption(fy), `financial year ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`);
    await this.selectByText(DASHBOARD.quarter, DASHBOARD.quarterOption(quarter), `quarter ${quarter}`);
    await this.selectByText(DASHBOARD.period, DASHBOARD.periodOption(MONTH_NAMES[m - 1]), MONTH_NAMES[m - 1]);
    await this.click(DASHBOARD.search);
  }

  // The return's box on the dashboard (the innermost block with its name and a button)
  private async findTile(tile: RegExp, name: string): Promise<Locator> {
    const page = this.page;
    const anyTile = page.getByText(new RegExp(`${RECIPES.GSTR1.tile.source}|${RECIPES.GSTR3B.tile.source}|${RECIPES.GSTR2B.tile.source}`, "i")).first();
    await anyTile.waitFor({ state: "visible", timeout: WAIT_MS }).catch(() => undefined);
    // The name is matched on its own element: a block's text runs into its
    // buttons' ("GSTR1VIEW"), which would spoil a match like /GSTR-?1\b/
    const box = page.locator("div").filter({ has: page.getByText(tile) }).filter({ has: page.getByRole("button") }).last();
    if ((await box.count()) === 0) {
      const text = await this.bodyText();
      const message = NOT_AVAILABLE.map((p) => text.match(p)?.[0]).find(Boolean);
      throw new NotAvailableError(message ? message.toLowerCase() : `no ${name} for this period`);
    }
    return box;
  }

  // Clicks and waits for the file: a browser download, or a PDF / ZIP / Excel
  // opened in this tab or a new one. Extra tabs are closed afterwards. A "not
  // available" message that appears instead ends the wait.
  private async capture(click: () => Promise<void>): Promise<Captured> {
    const { context, page: main } = this;
    const before = countMatches(await this.bodyText(), NOT_AVAILABLE);
    const cleanups: (() => void)[] = [];
    let settled = false;

    const result = new Promise<Captured>((resolve, reject) => {
      const done = (value: Captured | Error) => {
        if (settled) return;
        settled = true;
        if (value instanceof Error) reject(value);
        else resolve(value);
      };
      const onDownload = (download: Download) => {
        download
          .path()
          .then((file) => readFile(file))
          .then((data) => done({ name: download.suggestedFilename(), data: new Uint8Array(data) }))
          .catch((error) => done(error instanceof Error ? error : new Error(String(error))));
      };
      const onResponse = (response: Response) => {
        const type = response.headers()["content-type"] ?? "";
        const disposition = response.headers()["content-disposition"] ?? "";
        // Attachments come as a download instead
        if (!FILE_TYPES.test(type) || /attachment/i.test(disposition) || response.status() >= 300) return;
        response
          .body()
          .then((data) => done({ name: responseFileName(response), data: new Uint8Array(data) }))
          .catch(() => undefined);
      };
      const watch = (page: Page) => {
        page.on("download", onDownload);
        page.on("response", onResponse);
        cleanups.push(() => {
          page.off("download", onDownload);
          page.off("response", onResponse);
        });
      };
      context.pages().forEach(watch);
      context.on("page", watch);
      cleanups.push(() => context.off("page", watch));

      const timer = setTimeout(() => done(new Error("No file came from the portal")), CAPTURE_TIMEOUT_MS);
      cleanups.push(() => clearTimeout(timer));
      // A message instead of a file
      const poll = setInterval(async () => {
        if (settled) return;
        const text = await this.bodyText();
        const after = countMatches(text, NOT_AVAILABLE);
        const index = after.findIndex((n, i) => n > before[i]);
        if (index >= 0) done(new NotAvailableError(text.match(NOT_AVAILABLE[index])![0].toLowerCase()));
        else if (SESSION_EXPIRED.some((p) => p.test(text))) done(new SessionExpiredError());
      }, 1_000);
      cleanups.push(() => clearInterval(poll));

      click().catch((error) => done(error instanceof Error ? error : new Error(String(error))));
    });

    try {
      return await result;
    } finally {
      cleanups.forEach((fn) => fn());
      for (const page of context.pages()) if (page !== main) await page.close().catch(() => undefined);
      await main.bringToFront().catch(() => undefined);
    }
  }

  private async runSteps(steps: Step[], scope: Locator): Promise<Captured> {
    let within: Page | Locator = scope;
    for (const step of steps) {
      if ("download" in step) {
        const target = step.download;
        const where = within;
        return this.capture(() => this.locate(target, where).first().click({ timeout: WAIT_MS }));
      }
      const before = countMatches(await this.bodyText(), NOT_AVAILABLE);
      await this.click(step.click, within);
      const text = await this.bodyText();
      const index = countMatches(text, NOT_AVAILABLE).findIndex((n, i) => n > before[i]);
      if (index >= 0) throw new NotAvailableError(text.match(NOT_AVAILABLE[index])![0].toLowerCase());
      // After the first click the next page has the buttons
      within = this.page;
    }
    throw new Error("The download recipe has no download step (selectors.ts)");
  }

  // ─── Downloads ────────────────────────────────────────────────────────────

  async downloadReturn(returnType: ReturnType, format: FileFormat, month: string): Promise<Captured> {
    const recipe = RECIPES[returnType];
    const steps = recipe[format];
    if (!steps) throw new NotAvailableError(`the portal has no ${format} download for ${LABELS[returnType]}`);
    await this.openPeriod(month);
    const tile = await this.findTile(recipe.tile, LABELS[returnType]);
    const file = await this.runSteps(steps, tile);
    await this.pause();
    return file;
  }

  private async openGstr1Download(month: string) {
    await this.openPeriod(month);
    const tile = await this.findTile(RECIPES.GSTR1.tile, "GSTR-1");
    await this.click(GSTR1_JSON.open, tile);
  }

  private async jsonPending(): Promise<boolean> {
    const text = await this.bodyText();
    return GSTR1_JSON.pending.some((p) => p.test(text));
  }

  // Clicks "Generate JSON file to download" for the month's GSTR-1, unless
  // the portal is already preparing it
  async requestJson(month: string): Promise<"requested" | "already-pending"> {
    await this.openGstr1Download(month);
    if (await this.jsonPending()) return "already-pending";
    const before = countMatches(await this.bodyText(), NOT_AVAILABLE);
    await this.click(GSTR1_JSON.generate);
    const text = await this.bodyText();
    const index = countMatches(text, NOT_AVAILABLE).findIndex((n, i) => n > before[i]);
    if (index >= 0) throw new NotAvailableError(text.match(NOT_AVAILABLE[index])![0].toLowerCase());
    return "requested";
  }

  // Downloads every part ("File 1", "File 2" …) of the month's GSTR-1 JSON.
  // pending: still being prepared; none: no request on the portal (expired)
  async collectJson(month: string): Promise<JsonCollect> {
    await this.openGstr1Download(month);
    if (await this.jsonPending()) return { kind: "pending" };
    const links = this.page.getByRole("link", { name: GSTR1_JSON.fileLink }).or(this.page.getByRole("button", { name: GSTR1_JSON.fileLink }));
    const count = await links.count();
    if (!count) return { kind: "none" };
    const files: Captured[] = [];
    for (let i = 0; i < count; i++) {
      files.push(await this.capture(() => links.nth(i).click({ timeout: WAIT_MS })));
      await this.pause();
    }
    return { kind: "files", files };
  }

  // Opens a page so the portal doesn't log out an idle session
  async keepAlive() {
    await this.page.goto(URLS.keepAlive, { waitUntil: "domcontentloaded" });
    await this.checkSession();
  }

  async logout() {
    await this.page.goto(URLS.logout, { waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch(() => undefined);
  }
}
