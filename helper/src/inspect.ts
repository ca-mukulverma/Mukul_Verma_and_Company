import { chromium } from "playwright";
import { URLS } from "./portal/selectors";

// npm run inspect: opens the GST portal's login page with the Playwright
// Inspector. Log in by hand (captcha and OTP as usual), go to each page the
// helper uses and click "Pick locator" to check the buttons, links and
// drop-downs in src/portal/selectors.ts. Close the window to finish.

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(URLS.login);
console.log("Log in by hand, then use the Inspector's \"Pick locator\". Close the browser when done.");
await page.pause();
await browser.close();
