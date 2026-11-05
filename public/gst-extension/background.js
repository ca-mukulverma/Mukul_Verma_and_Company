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


// Errors worth one more try from the dashboard: the page changed or went
// away under a step, or a slow load
const RETRY = /frame|removed|didn't answer|no tab|in time|wasn't found|went away|didn't show its drop-downs|no search button|fetch/i;

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

// Escapes text for use inside a regular expression
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Opens addresses from inside the portal page, as following a link there
// would: the browser then says the request comes from the portal's own page.
// Requests made by the extension itself come "from outside", and the portal
// refuses those (access denied), so files and pages are never asked for that way.
async function openFromPage(tabId, urls, newTab) {
  const [answer] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [urls, newTab],
    func: (list, blank) => {
      for (const href of list) {
        const a = document.createElement("a");
        a.href = href;
        if (blank) {
          a.target = "_blank";
          a.rel = "noopener";
        }
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      return list.length;
    },
  });
  return answer?.result ?? 0;
}

// The bytes of an address, read inside the portal page (a blob: / data:
// address it made, or a file on the portal, asked for as the page would)
async function bytesInPage(tabId, url) {
  const [answer] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [url],
    func: async (href) => {
      try {
        const blob = await (await fetch(href)).blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let raw = "";
        for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { type: blob.type, base64: btoa(raw) };
      } catch (error) {
        return { error: String(error?.message ?? error) };
      }
    },
  });
  return answer?.result ?? { error: "the page didn't answer" };
}

const PORTAL_BLOB = /^blob:https:\/\/([a-z0-9-]+\.)*gst\.gov\.in\//i;
const baseName = (path) => (path ?? "").split(/[\\/]/).pop() ?? "";

// A file step, also catching a file the page hands to Chrome as a normal
// download (a link or address the in-page catch doesn't see, a new tab, a
// server attachment): its bytes are read and the download removed again.
// Tabs the portal opens meanwhile are closed.
async function fileStep(tabId, st, ctx) {
  let seen;
  const download = new Promise((resolve) => (seen = resolve));
  const opened = [];
  const onCreated = (item) => {
    if (PORTAL.test(item.url) || PORTAL_BLOB.test(item.url) || PORTAL.test(item.referrer ?? "") || /^data:/i.test(item.url)) seen(item);
  };
  const onTab = (tab) => {
    if (tab.openerTabId === tabId) opened.push(tab.id);
  };
  // The name the page gave the file (the saved name can differ)
  const names = new Map();
  const onName = (item, suggest) => {
    names.set(item.id, item.filename);
    suggest();
  };
  chrome.downloads.onCreated.addListener(onCreated);
  chrome.downloads.onDeterminingFilename?.addListener(onName);
  chrome.tabs.onCreated.addListener(onTab);
  try {
    const page = step(tabId, st, ctx);
    page.catch(() => undefined);
    const first = await Promise.race([page.then((answer) => ({ answer })), download.then((item) => ({ item }))]);
    if (first.answer) return first.answer;
    const item = first.item;
    // The name is known once Chrome has chosen where to save it
    await new Promise((r) => setTimeout(r, 400));
    const [now] = await chrome.downloads.search({ id: item.id }).catch(() => []);
    const named = (n) => (/\.[a-z0-9]{2,5}$/i.test(n) ? n : "");
    const name = named(baseName(names.get(item.id))) || named(baseName(now?.filename)) || named(baseName(new URL(item.finalUrl || item.url).pathname));
    const href = item.finalUrl || item.url;
    const got = /^(blob|data):/i.test(href) || PORTAL.test(href) ? await bytesInPage(tabId, href) : { error: `the file came from ${new URL(href).host}` };
    if (!got.base64) {
      return { result: "downloaded", message: `The portal saved it to this computer's Downloads folder (${got.error}): upload it with Upload documents.` };
    }
    await chrome.downloads.cancel(item.id).catch(() => undefined);
    if (now?.state === "complete") await chrome.downloads.removeFile(item.id).catch(() => undefined);
    await chrome.downloads.erase({ id: item.id }).catch(() => undefined);
    return { file: { name: got.name || name, type: got.type ?? item.mime ?? "", base64: got.base64 } };
  } finally {
    chrome.downloads.onCreated.removeListener(onCreated);
    chrome.downloads.onDeterminingFilename?.removeListener(onName);
    chrome.tabs.onCreated.removeListener(onTab);
    for (const id of opened) await closeTab(id);
  }
}


// { file: { kind, month: "2026-09", label } } → { ok, result, files, message }
// result: saved-ready ("file"), not-filed, not-available, requested, pending,
// session-expired, not-taught, error
async function fetchFile(message, run) {
  if (!run || run.runId !== message.runId || run.status !== "logged-in") return { ok: false, error: "Log in to the GST portal first." };
  if (!(await tabExists(run.portalTabId))) return { ok: false, error: "The GST portal tab is not open." };
  // A file left half-done by a worker restart doesn't block the next one
  if (run.doing && Date.now() - (run.doingAt ?? 0) < 6 * 60000) return { ok: false, error: `The extension is already fetching ${run.doing}.` };
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
  run = await setRun({ ...run, doing: String(label ?? kind), doingAt: Date.now(), at: Date.now() });
  const tabId = run.portalTabId;
  // Chrome stops an idle extension worker after about 30 seconds; a call
  // now and then keeps it alive while the portal is slow
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => undefined), 15000);
  const done = async (answer) => {
    clearInterval(keepAlive);
    const now = await getRun();
    if (now?.runId === run.runId) {
      await setRun({ ...now, doing: null, doingAt: null, at: Date.now() });
      if (now.autoLogout && now.status === "logged-in") await armIdle(s);
    }
    return { ok: true, ...answer };
  };
  let reachedGenerate = false;
  let first = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let answer;
    try {
      answer = await attemptFile(tabId, s, recipe, ctx, () => (reachedGenerate = true));
    } catch (error) {
      answer = { result: "error", message: String(error?.message ?? error) };
    }
    // Asking for GSTR-1 JSON again would make a new file: never retried
    if (answer.result !== "error" || reachedGenerate || !RETRY.test(answer.message ?? "")) {
      return done(first && answer.result === "error" ? { ...answer, message: `${answer.message} (also on a second try; first: ${first})` } : answer);
    }
    first = answer.message;
    await pause();
  }
  return done({ result: "error", message: first ?? "The portal didn't give the file" });
}

// The Returns Dashboard, reached the way a person reaches it: the welcome
// page's RETURN DASHBOARD button after login, else a link from the portal page
// the tab is on. Its address is never opened by the extension itself: the
// portal refuses that (access denied). Already there: used as it is.
async function toDashboard(tabId, s, ctx) {
  const dashboard = new RegExp(`^${literal(s.urls.dashboard)}(?:[?#]|$)`, "i");
  const landed = `^${literal(s.urls.dashboard)}(?:[?#]|$)|${s.urls.accessDenied}|^${literal(s.urls.login)}|/services/error/`;
  let tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete" && dashboard.test(tab.url ?? "")) return tab;
  if (s.dashboardEntry && /^https:\/\/services\.gst\.gov\.in\/services\/auth\//i.test(tab.url ?? "")) {
    const clicked = await step(tabId, { kind: "click", scope: "page", target: s.dashboardEntry, url: landed, waitSeconds: 10 }, ctx);
    if (!clicked.error) return settle(tabId, landed);
  }
  await openFromPage(tabId, [s.urls.dashboard], false);
  return settle(tabId, landed);
}

// One try at a file: dashboard, period, the return's box, then its steps
async function attemptFile(tabId, s, recipe, ctx, onGenerate) {
  const where = (u) => {
    if (new RegExp(s.urls.accessDenied, "i").test(u ?? "")) {
      return {
        result: "access-denied",
        message: "The GST portal refused access (its \"access denied\" page). The run stopped so as not to ask again: try later, and tell the admin if it repeats.",
      };
    }
    if ((u ?? "").startsWith(s.urls.login)) return { result: "session-expired", message: "The portal logged out" };
    if (/\/services\/error\//i.test(u ?? "")) return { result: "error", message: `The portal showed its own error page (${new URL(u).pathname}): try again in a while` };
    return null;
  };
  const tab = await toDashboard(tabId, s, ctx);
  if (where(tab.url)) return where(tab.url);
  const steps = [{ kind: "period" }, { kind: "tile", filed: recipe.filed }, ...recipe.steps];
  for (const st of steps) {
    await pause();
    if (st.kind === "generate") onGenerate();
    let answer = st.kind === "file" ? await fileStep(tabId, st, ctx) : await step(tabId, st, ctx);
    // A click step whose page shows the file's button instead (NIL GSTR-1)
    if (answer.fileInstead) answer = await fileStep(tabId, { kind: "file", scope: st.scope, target: st.orFile, waitSeconds: 10 }, ctx);
    if (answer.error) {
      // The page left for the portal's error or login page during the step:
      // let the new page arrive, then look where the tab is
      const now = await settle(tabId, null, 15000).catch(() => chrome.tabs.get(tabId).catch(() => null));
      return where(now?.url) ?? { result: "error", message: answer.error };
    }
    if (answer.result) return answer;
    if (answer.file) return { result: "file", files: [answer.file] };
    if (answer.files) {
      const files = [];
      const failed = [];
      for (const f of answer.files) {
        if (f.base64) files.push(f);
        else failed.push(f);
      }
      if (!failed.length) return { result: "file", files };
      // Parts the page couldn't read: opened from the page like a click on
      // the link, so Chrome saves them in Downloads for staff to upload
      const portalLinks = failed.filter((f) => f.href && PORTAL.test(f.href)).map((f) => f.href);
      const opened = portalLinks.length ? await openFromPage(tabId, portalLinks, true).catch(() => 0) : 0;
      const why = failed.map((f) => f.why ?? "the page couldn't read it").join(" · ");
      if (opened) {
        await new Promise((r) => setTimeout(r, 3000));
        return { result: "downloaded", files, message: `${opened} part${opened === 1 ? "" : "s"} saved to this computer's Downloads folder instead (${why}): upload ${opened === 1 ? "it" : "them"} with Upload documents.` };
      }
      return { result: "error", message: `The GSTR-1 JSON link didn't give the file: ${why}` };
    }
    // A click that opens another page
    const next = await settle(tabId, st.url ?? null);
    if (where(next.url)) return where(next.url);
  }
  return { result: "error", message: "The steps ended without a file" };
}
