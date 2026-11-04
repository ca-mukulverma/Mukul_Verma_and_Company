// The extension's hands (docs/GST_PORTAL_EXTENSION_PLAN.md §5): opens the GST
// portal tab, fills the username and password, tells the app when staff
// have typed the captcha and OTP, fetches the files the app asks for (one at
// a time, by the steps in the portal settings; portal.js runs each step in
// the page) and logs out. All portal details (addresses,
// fields) come from the app's portal settings with each request. Only the
// app's own pages may ask; the password is used once to fill the field and
// never stored.

const APP_ORIGIN = "__APP_ORIGIN__";
// Every portal address must be on the GST portal
const PORTAL = /^https:\/\/([a-z0-9-]+\.)*gst\.gov\.in\//i;
const ENDED = ["logged-out", "closed", "timed-out", "failed"];
const LOGIN_TIMEOUT = "gst-login-timeout";
const LOGOUT_CLOSE = "gst-logout-close";
// A download run with nothing more to do logs out on its own
const IDLE_LOGOUT = "gst-idle-logout";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

importScripts("portal.js");

// The login waiting to be filled, in memory only, dropped once used. If the
// worker is restarted before the page loads, staff type it themselves.
let pending = null;

// The current run (no secrets) lives in session storage: memory only, and
// out of reach of content scripts
const getRun = async () => (await chrome.storage.session.get("run")).run ?? null;

function publicRun(run) {
  if (!run) return null;
  const rest = { ...run };
  delete rest.settings;
  return rest;
}

async function setRun(run) {
  await chrome.storage.session.set({ run });
  if (run.appTabId != null) chrome.tabs.sendMessage(run.appTabId, { type: "gst-status", run: publicRun(run) }).catch(() => undefined);
  return run;
}

const tabExists = (tabId) => (tabId == null ? Promise.resolve(false) : chrome.tabs.get(tabId).then(() => true, () => false));
const closeTab = (tabId) => chrome.tabs.remove(tabId).catch(() => undefined);

function fromApp(sender) {
  return sender.id === chrome.runtime.id && !!sender.tab && sender.frameId === 0 && typeof sender.url === "string" && sender.url.startsWith(`${APP_ORIGIN}/`);
}

function validSettings(s) {
  if (!s || typeof s !== "object" || !s.urls || !s.login) return false;
  if (![s.urls.login, s.urls.logout].every((u) => typeof u === "string" && PORTAL.test(u))) return false;
  try {
    new RegExp(s.urls.loggedIn);
  } catch {
    return false;
  }
  if (s.urls.dashboard !== undefined && !(typeof s.urls.dashboard === "string" && PORTAL.test(s.urls.dashboard))) return false;
  return ["username", "password", "captcha"].every((k) => typeof s.login[k]?.css === "string");
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!fromApp(sender)) return false;
  handle(message, sender).then(reply, (error) => reply({ ok: false, error: String(error?.message ?? error) }));
  return true;
});

async function handle(message, sender) {
  const run = await getRun();
  switch (message?.type) {
    case "gst-status":
      return { ok: true, run: publicRun(run), version: chrome.runtime.getManifest().version };
    case "gst-login":
      return startLogin(message, sender, run);
    case "gst-logout":
      return logout(message.runId, run);
    case "gst-show":
      return show(message.runId, run);
    case "gst-fetch":
      return fetchFile(message, run);
  }
  return { ok: false, error: "Unknown request" };
}

async function startLogin(message, sender, run) {
  const { runId, clientId, clientName, settings, login, autoLogout } = message;
  if (typeof runId !== "string" || !validSettings(settings)) return { ok: false, error: "The app sent portal settings this extension can't use. Update the extension." };
  // The portal allows one login per browser
  if (run && !ENDED.includes(run.status) && (await tabExists(run.portalTabId))) {
    return { ok: false, error: `The GST portal is open for ${run.clientName}: log out there first.`, run: publicRun(run) };
  }
  // The run is saved before the portal loads, so its page events find it
  const tab = await chrome.tabs.create({ url: "about:blank", active: true, index: sender.tab.index + 1, windowId: sender.tab.windowId });
  pending = login?.username ? { tabId: tab.id, username: String(login.username), password: String(login.password ?? "") } : null;
  const next = await setRun({
    runId,
    clientId,
    clientName: String(clientName ?? ""),
    appTabId: sender.tab.id,
    portalTabId: tab.id,
    status: "waiting-login",
    note: login?.username ? null : "No GST login is saved for this client: type the username and password too.",
    filled: false,
    // Files to fetch: log out by itself when the run goes quiet
    autoLogout: !!autoLogout,
    doing: null,
    settings,
    at: Date.now(),
  });
  await chrome.alarms.create(LOGIN_TIMEOUT, { delayInMinutes: Math.max(1, Number(settings.loginWaitMinutes) || 10) });
  await chrome.tabs.update(tab.id, { url: settings.urls.login });
  return { ok: true, run: publicRun(next) };
}

async function logout(runId, run) {
  if (!run || run.runId !== runId) return { ok: false, error: "This GST portal login is no longer open." };
  if (ENDED.includes(run.status)) return { ok: true, run: publicRun(run) };
  pending = null;
  await chrome.alarms.clear(LOGIN_TIMEOUT);
  await chrome.alarms.clear(IDLE_LOGOUT);
  // Not logged in yet, or the tab is gone: just close it
  if (run.status !== "logged-in" || !(await tabExists(run.portalTabId))) {
    const next = await setRun({ ...run, status: "logged-out", at: Date.now() });
    await closeTab(run.portalTabId);
    return { ok: true, run: publicRun(next) };
  }
  const next = await setRun({ ...run, status: "logging-out", at: Date.now() });
  await chrome.alarms.create(LOGOUT_CLOSE, { delayInMinutes: 0.5 });
  await chrome.tabs.update(run.portalTabId, { url: run.settings.urls.logout });
  return { ok: true, run: publicRun(next) };
}

async function finishLogout(run) {
  await chrome.alarms.clear(LOGOUT_CLOSE);
  await setRun({ ...run, status: "logged-out", at: Date.now() });
  await closeTab(run.portalTabId);
}

async function show(runId, run) {
  if (!run || run.runId !== runId || !(await tabExists(run.portalTabId))) return { ok: false, error: "The GST portal tab is not open." };
  const tab = await chrome.tabs.update(run.portalTabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { ok: true };
}

// Runs in the portal's login page: waits for the form, fills the username
// and password like typing (so the page's own checks see them) and puts the
// cursor in the captcha. Nothing here reads or types the captcha.
async function fillLogin(targets, username, password) {
  const find = (t) => (t?.css ? document.querySelector(t.css) : null);
  const until = Date.now() + 20000;
  while (!find(targets.username) && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
  const user = find(targets.username);
  if (!user) return "no-form";
  if (!username) {
    user.focus();
    return "focused";
  }
  const setValue = (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  setValue(user, username);
  const pass = find(targets.password);
  if (pass) setValue(pass, password);
  (find(targets.captcha) ?? pass ?? user).focus();
  return "filled";
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  onPortalTab(tabId, info, tab).catch(() => undefined);
});

async function onPortalTab(tabId, info, tab) {
  const run = await getRun();
  if (!run || run.portalTabId !== tabId || ENDED.includes(run.status)) return;
  const url = info.url ?? tab.url ?? "";
  if (run.status === "waiting-login") {
    if (new RegExp(run.settings.urls.loggedIn, "i").test(url)) {
      pending = null;
      await chrome.alarms.clear(LOGIN_TIMEOUT);
      await setRun({ ...run, status: "logged-in", note: null, at: Date.now() });
      if (run.autoLogout) await armIdle(run.settings);
      return;
    }
    if (info.status !== "complete" || !url.startsWith(run.settings.urls.login)) return;
    const login = pending?.tabId === tabId ? pending : null;
    // Filled once; a reload after a wrong captcha keeps what the portal shows
    if (!login && run.filled) return;
    pending = null;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: fillLogin,
      args: [run.settings.login, login?.username ?? "", login?.password ?? ""],
    });
    const notes = {
      filled: null,
      focused: run.note ?? "Type the username and password too.",
      "no-form": "The login form wasn't found on the portal: log in by hand.",
    };
    await setRun({ ...run, filled: true, note: notes[result?.result] ?? null });
  } else if (run.status === "logging-out" && info.status === "complete") {
    await finishLogout(run);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    const run = await getRun();
    if (!run || run.portalTabId !== tabId || ENDED.includes(run.status)) return;
    pending = null;
    await chrome.alarms.clear(LOGIN_TIMEOUT);
    await setRun({ ...run, status: run.status === "logging-out" ? "logged-out" : "closed", at: Date.now() });
  })().catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  (async () => {
    const run = await getRun();
    if (!run) return;
    if (alarm.name === LOGIN_TIMEOUT && run.status === "waiting-login") {
      pending = null;
      await setRun({ ...run, status: "timed-out", at: Date.now() });
      await closeTab(run.portalTabId);
    } else if (alarm.name === LOGOUT_CLOSE && run.status === "logging-out") {
      await finishLogout(run);
    } else if (alarm.name === IDLE_LOGOUT && run.status === "logged-in" && !run.doing) {
      await logout(run.runId, run);
    }
  })().catch(() => undefined);
});

// ─── Fetching one file ──────────────────────────────────────────────────────

const armIdle = (settings) => chrome.alarms.create(IDLE_LOGOUT, { delayInMinutes: Math.max(1, Number(settings.idleLogoutMinutes) || 5) });
const pause = () => new Promise((r) => setTimeout(r, 500 + Math.random() * 700));

// Waits for the tab to finish loading (and to reach an address, if given)
async function settle(tabId, urlPattern, ms = 45000) {
  const end = Date.now() + ms;
  const wanted = urlPattern ? new RegExp(urlPattern, "i") : null;
  // A click's page change starts a moment later
  await new Promise((r) => setTimeout(r, wanted ? 300 : 600));
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("The GST portal tab was closed");
    if (tab.status === "complete" && (!wanted || wanted.test(tab.url ?? ""))) return tab;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(wanted ? "The portal page didn't open in time" : "The portal page didn't finish loading");
}

async function step(tabId, step, ctx) {
  try {
    const [answer] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: mvcPortalStep, args: [step, ctx] });
    if (answer?.result) return answer.result;
  } catch (error) {
    // The click opened another page before the answer came back
    if (!step.url) return { error: String(error?.message ?? error) };
  }
  return step.url ? { next: true } : { error: "The portal page didn't answer" };
}

// A link the page couldn't read (another site): fetched here, where the
// host permission for *.gst.gov.in applies
async function fetchHere(link) {
  if (!PORTAL.test(link.href)) return { error: "The file's address is not on the GST portal" };
  const response = await fetch(link.href, { credentials: "include" });
  if (!response.ok) return { error: `The portal answered ${response.status} for the file` };
  const bytes = new Uint8Array(await response.arrayBuffer());
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { name: link.name, type: response.headers.get("content-type") ?? "", base64: btoa(raw) };
}

// { file: { kind, month: "2026-09", label } } → { ok, result, files, message }
// result: saved-ready ("file"), not-filed, not-available, requested, pending,
// session-expired, not-taught, error
async function fetchFile(message, run) {
  if (!run || run.runId !== message.runId || run.status !== "logged-in") return { ok: false, error: "Log in to the GST portal first." };
  if (!(await tabExists(run.portalTabId))) return { ok: false, error: "The GST portal tab is not open." };
  if (run.doing) return { ok: false, error: `The extension is already fetching ${run.doing}.` };
  const { kind, month, label } = message.file ?? {};
  const s = run.settings;
  const recipe = s.files?.[kind];
  if (!recipe) return { ok: true, result: "not-taught", message: "Not taught to the extension yet: download it on the portal by hand." };
  if (!/^\d{4}-\d{2}$/.test(month ?? "")) return { ok: false, error: "Bad month" };
  const [y, m] = month.split("-").map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  const ctx = {
    ...s.texts,
    selects: s.dashboard.selects,
    search: s.dashboard.search,
    tileName: s.tiles[recipe.tile],
    filedStatus: s.filedStatus,
    returnLabel: { GSTR1: "GSTR-1", GSTR3B: "GSTR-3B", GSTR2B: "GSTR-2B" }[recipe.tile],
    periodLabel: `${SHORT[m - 1]} ${y}`,
    period: `${String(m).padStart(2, "0")}${y}`,
    fy: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`,
    quarter: m >= 4 ? Math.ceil((m - 3) / 3) : 4,
    monthName: MONTHS[m - 1],
  };
  await chrome.alarms.clear(IDLE_LOGOUT);
  run = await setRun({ ...run, doing: String(label ?? kind), at: Date.now() });
  const tabId = run.portalTabId;
  const done = async (answer) => {
    const now = await getRun();
    if (now?.runId === run.runId) {
      await setRun({ ...now, doing: null, at: Date.now() });
      if (now.autoLogout && now.status === "logged-in") await armIdle(s);
    }
    return { ok: true, ...answer };
  };
  try {
    await chrome.tabs.update(tabId, { url: s.urls.dashboard });
    const tab = await settle(tabId, null);
    if ((tab.url ?? "").startsWith(s.urls.login)) return done({ result: "session-expired", message: "The portal logged out" });
    const steps = [{ kind: "period" }, { kind: "tile", filed: recipe.filed }, ...recipe.steps];
    for (const st of steps) {
      // Asked for on an earlier visit: collect only, never ask twice
      if (st.kind === "generate" && message.file.noGenerate) return done({ result: "pending", message: null });
      await pause();
      const answer = await step(tabId, st, ctx);
      if (answer.error) return done({ result: "error", message: answer.error });
      if (answer.result) return done(answer);
      if (answer.file) return done({ result: "file", files: [answer.file] });
      if (answer.files) {
        const files = [];
        for (const f of answer.files) {
          const got = f.base64 ? f : f.href && !f.error ? await fetchHere(f) : f;
          if (got.error || !got.base64) return done({ result: "error", message: got.error ?? "A part of the JSON couldn't be fetched" });
          files.push(got);
        }
        return done({ result: "file", files });
      }
      // A click that opens another page
      await settle(tabId, st.url ?? null);
    }
    return done({ result: "error", message: "The steps ended without a file" });
  } catch (error) {
    return done({ result: "error", message: String(error?.message ?? error) });
  }
}
