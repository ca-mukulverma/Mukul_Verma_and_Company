// The Tally extension's worker (docs/TALLY_DIRECT_IMPORT.md). Talks to
// TallyPrime's built-in server on this computer (F1 → Settings →
// Connectivity: "TallyPrime acts as Server", port 9000) for the app's pages
// only:
//   tally-status  is Tally running, and which companies are open
//   tally-check   which of the voucher types and ledgers the bills need are
//                 missing in the company
//   tally-import  send one bill (one sales voucher) and read Tally's answer
// It only ever sends vouchers: a request holding anything else (a ledger, a
// voucher type, any master) is refused, so nothing else is created in Tally.
//
// Debtors (docs/TALLY_DEBTORS.md, the end of this file): once Admin connects
// this PC for a firm (MVC or B Edge) from the app's Debtors page, it reads
// that firm's company's Sundry Debtors ledgers (only those, with their
// entries) from Tally and sends them to the app at 11:30, 13:00, 16:00 and
// 19:00 IST, and when someone presses Refresh now.
// It only reads from Tally (Export requests); it never changes anything there.

const APP_ORIGIN = "__APP_ORIGIN__";
const HOSTS = ["127.0.0.1", "localhost"];

function fromApp(sender) {
  return sender.id === chrome.runtime.id && !!sender.tab && sender.frameId === 0 && typeof sender.url === "string" && sender.url.startsWith(`${APP_ORIGIN}/`);
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!fromApp(sender)) return false;
  handle(message).then(reply, (error) => reply({ ok: false, error: String(error?.message ?? error) }));
  return true;
});

async function handle(message) {
  if (typeof message?.type === "string" && message.type.startsWith("tally-sync-")) return handleSync(message);
  const port = validPort(message?.port);
  switch (message?.type) {
    case "tally-status":
      return status(port);
    case "tally-check":
      return check(port, message);
    case "tally-import":
      return importVoucher(port, message);
    default:
      return { ok: false, error: "Unknown request" };
  }
}

function validPort(value) {
  const port = Number(value ?? 9000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("The Tally port must be a number such as 9000");
  return port;
}

// ─── Talking to Tally ───────────────────────────────────────────────────────

class TallyDown extends Error {}

// Tally answers in UTF-8 or UTF-16
function decode(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  // UTF-16 without a mark: every other byte is zero
  if (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

let workingHost = null;

async function post(port, xml, timeoutMs) {
  const hosts = workingHost ? [workingHost, ...HOSTS.filter((h) => h !== workingHost)] : HOSTS;
  let lastError = null;
  for (const host of hosts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`http://${host}:${port}`, {
        method: "POST",
        headers: { "Content-Type": "text/xml;charset=utf-8" },
        body: xml,
        signal: controller.signal,
      });
      const text = decode(await response.arrayBuffer());
      workingHost = host;
      return text;
    } catch (error) {
      lastError = error;
      // Tally is there but slow: don't try the other address (it would send twice)
      if (error?.name === "AbortError") throw new Error(`Tally didn't answer within ${Math.round(timeoutMs / 1000)} seconds`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new TallyDown(
    `TallyPrime isn't answering on port ${port}. Open TallyPrime on this computer; if it is open, check F1 → Settings → Connectivity → Client/Server configuration: "TallyPrime acts as" Server (or Both), port ${port}, then restart TallyPrime. (${lastError?.message ?? lastError})`
  );
}

function unescape(value) {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// The names of every object of a type (Company, Ledger, VoucherType), with
// their aliases, in a company (or of the open companies)
async function names(port, type, company) {
  const xml =
    "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>MVCNames</ID></HEADER>" +
    "<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
    (company ? `<SVCURRENTCOMPANY>${escape(company)}</SVCURRENTCOMPANY>` : "") +
    "</STATICVARIABLES><TDL><TDLMESSAGE>" +
    `<COLLECTION NAME="MVCNames" ISMODIFY="No"><TYPE>${type}</TYPE><FETCH>Name</FETCH></COLLECTION>` +
    "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>";
  const text = await post(port, xml, 60_000);
  const lineError = /<LINEERROR>([\s\S]*?)<\/LINEERROR>/.exec(text);
  if (lineError) throw new Error(`Tally: ${unescape(lineError[1]).trim()}`);
  const tag = type.toUpperCase();
  const found = new Set();
  for (const m of text.matchAll(new RegExp(`<${tag}\\s+NAME="([^"]*)"`, "g"))) found.add(unescape(m[1]).trim());
  // Aliases (and names Tally sends only as elements)
  for (const block of text.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "g"))) {
    for (const m of block[0].matchAll(/<NAME>([^<]*)<\/NAME>/g)) found.add(unescape(m[1]).trim());
  }
  found.delete("");
  return found;
}

const key = (name) => name.trim().toLowerCase();

async function status(port) {
  const companies = [...(await names(port, "Company", null))];
  return { ok: true, version: chrome.runtime.getManifest().version, companies };
}

async function check(port, message) {
  const company = String(message.company ?? "");
  const wanted = (list) => (Array.isArray(list) ? list.filter((n) => typeof n === "string" && n.trim()) : []);
  const companies = await names(port, "Company", null);
  if (![...companies].some((c) => key(c) === key(company))) {
    return {
      ok: false,
      error: `The company "${company}" is not open in TallyPrime. Open it (Alt+F3, or F3: Select company) and try again.` + (companies.size ? ` Open now: ${[...companies].join(", ")}.` : ""),
      companyMissing: true,
    };
  }
  const [voucherTypes, ledgers] = await Promise.all([names(port, "VoucherType", company), names(port, "Ledger", company)]);
  const has = (set) => {
    const keys = new Set([...set].map(key));
    return (name) => keys.has(key(name));
  };
  const hasVoucherType = has(voucherTypes);
  const hasLedger = has(ledgers);
  return {
    ok: true,
    missingVoucherTypes: wanted(message.voucherTypes).filter((n) => !hasVoucherType(n)),
    missingLedgers: wanted(message.ledgers).filter((n) => !hasLedger(n)),
  };
}

// Only a request to import one voucher into the expected company passes
const MASTERS = /<(LEDGER|GROUP|VOUCHERTYPE|STOCKITEM|STOCKGROUP|COSTCENTRE|COSTCATEGORY|COMPANY|UNIT|GODOWN|CURRENCY|BUDGET|EMPLOYEE|TDL|TDLMESSAGE)[\s>/]/;

function voucherOnly(xml, company) {
  if (typeof xml !== "string" || xml.length > 200_000) return "The request is too large";
  if (!xml.includes("<TALLYREQUEST>Import Data</TALLYREQUEST>") || !xml.includes("<REPORTNAME>Vouchers</REPORTNAME>")) return "Only bills (vouchers) can be sent";
  if ((xml.match(/<VOUCHER\s/g) ?? []).length !== 1) return "Send one bill at a time";
  if (MASTERS.test(xml)) return "The request holds more than a bill; it was not sent";
  const target = /<SVCURRENTCOMPANY>([^<]*)<\/SVCURRENTCOMPANY>/.exec(xml);
  if (!target || key(unescape(target[1])) !== key(company)) return "The bill is for another company";
  return null;
}

const count = (text, tag) => Number((new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`).exec(text) ?? [])[1] ?? 0);

async function importVoucher(port, message) {
  const company = String(message.company ?? "");
  const refused = voucherOnly(message.xml, company);
  if (refused) return { ok: false, error: refused };
  const text = await post(port, message.xml, 120_000);

  const errors = [...text.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/g)].map((m) => unescape(m[1]).trim()).filter(Boolean);
  const counts = {
    created: count(text, "CREATED"),
    altered: count(text, "ALTERED"),
    cancelled: count(text, "CANCELLED"),
    combined: count(text, "COMBINED"),
    ignored: count(text, "IGNORED"),
    errors: count(text, "ERRORS"),
    exceptions: count(text, "EXCEPTIONS"),
  };
  const done = counts.created + counts.altered + counts.cancelled + counts.combined;
  if (errors.length || counts.errors || counts.exceptions || done === 0) {
    const why =
      errors.join("; ") ||
      (counts.ignored ? "Tally ignored the bill (it may already be there unchanged)" : counts.exceptions ? "Tally reported an exception for this bill" : "Tally did not take the bill");
    return { ok: true, imported: false, error: why, counts };
  }
  return { ok: true, imported: true, counts };
}

// ─── Debtors: sending the Sundry Debtors ledgers to the app ─────────────────
//
// This PC can send for MVC, for B Edge, or for both: one connection per firm
// (its key, its company in Tally, Tally's port), each made by Admin from the
// app's Debtors page on this PC. The key tells the app which firm it is.
// A failed update is not tried again on its own (someone presses Refresh
// now); an update time missed while the PC was off is sent once when it is on.

const SLOTS = ["11:30", "13:00", "16:00", "19:00"]; // IST
const ALARM = "mvc-debtors";
const ENTITIES = ["MVC", "BEDGE"];

function handleSync(message) {
  switch (message.type) {
    case "tally-sync-connect":
      return syncConnect(message);
    case "tally-sync-disconnect":
      return syncDisconnect(message);
    case "tally-sync-info":
      return syncInfo();
    case "tally-sync-now":
      return syncNow(message);
    default:
      return { ok: false, error: "Unknown request" };
  }
}

// Every 30 seconds while Chrome runs on this PC
function ensureAlarm() {
  chrome.alarms.get(ALARM, (alarm) => {
    if (!alarm) chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) tick().catch(() => undefined);
});

const getLocal = async (k) => (await chrome.storage.local.get(k))[k];
const setLocal = (k, v) => chrome.storage.local.set({ [k]: v });

// { MVC: { key, company, port }, BEDGE: {…} }. Version 1.1.0 kept one
// connection (MVC's) under "sync": it is moved here.
async function connections() {
  let list = (await getLocal("syncs")) ?? null;
  if (!list) {
    list = {};
    const old = await getLocal("sync");
    const oldState = await getLocal("syncState");
    if (old?.key) {
      list.MVC = old;
      await setLocal("syncStates", { MVC: oldState ?? {} });
    }
    await setLocal("syncs", list);
    await chrome.storage.local.remove(["sync", "syncState"]);
  }
  return list;
}

async function stateOf(entity) {
  return ((await getLocal("syncStates")) ?? {})[entity] ?? {};
}
async function saveState(entity, state) {
  const all = (await getLocal("syncStates")) ?? {};
  all[entity] = state;
  await setLocal("syncStates", all);
}

const validEntity = (e) => (ENTITIES.includes(e) ? e : null);

async function syncConnect(message) {
  const entity = validEntity(message.entity);
  const key = String(message.key ?? "");
  const company = String(message.company ?? "").trim();
  if (!entity || !/^mvct_[A-Za-z0-9_-]{20,64}$/.test(key) || !company) return { ok: false, error: "The firm, key or company is missing" };
  const list = await connections();
  list[entity] = { key, company, port: validPort(message.port) };
  await setLocal("syncs", list);
  await saveState(entity, {});
  ensureAlarm();
  return { ok: true };
}

async function syncDisconnect(message) {
  const entity = validEntity(message.entity);
  if (!entity) return { ok: false, error: "Choose MVC or B Edge" };
  const list = await connections();
  delete list[entity];
  await setLocal("syncs", list);
  await saveState(entity, {});
  return { ok: true };
}

async function syncInfo() {
  const list = await connections();
  const firms = {};
  for (const entity of ENTITIES) {
    if (!list[entity]) continue;
    firms[entity] = { company: list[entity].company, port: list[entity].port, last: (await stateOf(entity)).lastResult ?? null, running: running.has(entity) };
  }
  return { ok: true, version: chrome.runtime.getManifest().version, firms };
}

// The time in India
function ist(date = new Date()) {
  const t = new Date(date.getTime() + 330 * 60_000);
  const pad = (n) => String(n).padStart(2, "0");
  return { day: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`, hhmm: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` };
}

// The latest update time already passed ("2026-11-20 13:00"); before 11:30 it
// is the day before's 7 pm, so a PC switched on in the morning sends once
function latestSlot(now = new Date()) {
  const { day, hhmm } = ist(now);
  const passed = SLOTS.filter((s) => s <= hhmm);
  if (passed.length) return `${day} ${passed[passed.length - 1]}`;
  return `${ist(new Date(now.getTime() - 86_400_000)).day} ${SLOTS[SLOTS.length - 1]}`;
}

async function api(sync, method, action, body) {
  const headers = { Authorization: `Bearer ${sync.key}` };
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["X-MVC-Gzip"] = "1";
    const stream = new Blob([JSON.stringify(body)]).stream().pipeThrough(new CompressionStream("gzip"));
    payload = await new Response(stream).arrayBuffer();
  }
  const response = await fetch(`${APP_ORIGIN}/api/tally-sync/${action}`, { method, headers, body: payload, credentials: "omit", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `The app answered ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// The firms being read now (one at a time per firm)
const running = new Set();
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const list = await connections();
    for (const entity of ENTITIES) {
      if (list[entity]?.key) await tickFirm(entity, list[entity]);
    }
  } finally {
    ticking = false;
  }
}

async function tickFirm(entity, sync) {
  if (running.has(entity)) return;
  const state = await stateOf(entity);
  let poll;
  try {
    poll = await api(sync, "GET", "poll");
  } catch (error) {
    if (error.status === 401) {
      state.lastResult = { ok: false, at: new Date().toISOString(), message: "The app no longer accepts this PC's key for this firm: connect it again from Debtors" };
      await saveState(entity, state);
    }
    return; // offline: look again at the next tick
  }
  const slot = latestSlot();
  const refreshAt = poll.refresh?.at ?? null;
  let trigger = null;
  if (refreshAt && refreshAt !== state.handledRefresh) trigger = "refresh";
  else if (slot !== state.lastSlot) trigger = "scheduled";
  if (trigger) await runSync(entity, sync, poll, trigger, { slot, refreshAt });
}

async function syncNow(message) {
  const entity = validEntity(message.entity);
  const sync = entity && (await connections())[entity];
  if (!sync?.key) return { ok: false, error: "This PC is not connected for that firm yet" };
  if (running.has(entity)) return { ok: false, error: "An update is already running; wait a minute" };
  const poll = await api(sync, "GET", "poll");
  return runSync(entity, sync, poll, "manual", { slot: latestSlot(), refreshAt: poll.refresh?.at ?? null });
}

async function runSync(entity, sync, poll, trigger, marks) {
  running.add(entity);
  // Keeps the worker awake while Tally is read (it may take a minute)
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => undefined), 20_000);
  const state = await stateOf(entity);
  // Whatever happens, this update time and this refresh request are done: a
  // failure waits for someone to press Refresh now
  state.lastSlot = marks.slot ?? state.lastSlot;
  if (marks.refreshAt) state.handledRefresh = marks.refreshAt;
  try {
    const data = await readDebtors(sync.port ?? 9000, sync.company, poll.period, poll.salesFrom ?? poll.period.from);
    const hashes = {};
    for (const l of data.ledgers) hashes[l.name] = l.hash;
    const salesHashes = {};
    for (const m of data.sales?.months ?? []) salesHashes[m.month] = m.hash;
    const { need, needMonths = [] } = await api(sync, "POST", "plan", { hashes, ...(data.sales && { salesHashes }) });
    const wanted = new Set(need);
    const changed = data.ledgers.filter((l) => wanted.has(l.name));
    // Sales months that changed, in parts of about 6 MB of JSON
    const monthsWanted = new Set(needMonths);
    let monthPart = [];
    let monthSize = 0;
    for (const m of (data.sales?.months ?? []).filter((x) => monthsWanted.has(x.month))) {
      const s = JSON.stringify(m.lines).length + 100;
      if (monthPart.length && monthSize + s > 6_000_000) {
        await api(sync, "POST", "upload", { salesMonths: monthPart });
        monthPart = [];
        monthSize = 0;
      }
      monthPart.push(m);
      monthSize += s;
    }
    if (monthPart.length) await api(sync, "POST", "upload", { salesMonths: monthPart });
    // In parts of about 6 MB of JSON (well under 1 MB gzipped)
    let part = [];
    let size = 0;
    for (const l of changed) {
      const s = JSON.stringify(l.entries).length + 300;
      if (part.length && size + s > 6_000_000) {
        await api(sync, "POST", "upload", { ledgers: part });
        part = [];
        size = 0;
      }
      part.push(l);
      size += s;
    }
    if (part.length) await api(sync, "POST", "upload", { ledgers: part });
    await api(sync, "POST", "commit", {
      readAt: data.readAt,
      periodFrom: poll.period.from,
      periodTo: poll.period.to,
      rootGroup: data.rootGroup,
      groups: data.groups,
      names: data.ledgers.map((l) => l.name),
      trigger,
      ...(data.sales && {
        sales: {
          from: poll.salesFrom ?? poll.period.from,
          root: data.sales.root,
          groups: data.sales.groups,
          ledgers: data.sales.ledgers,
          months: data.sales.months.map((m) => m.month),
        },
      }),
    });
    state.lastResult = { ok: true, at: data.readAt, ledgers: data.ledgers.length, changed: changed.length, trigger };
    return { ok: true, ledgers: data.ledgers.length, changed: changed.length, readAt: data.readAt };
  } catch (error) {
    const message = String(error?.message ?? error);
    state.lastResult = { ok: false, at: new Date().toISOString(), message, trigger };
    try {
      await api(sync, "POST", "error", { message });
    } catch {
      /* the app is out of reach too */
    }
    return { ok: false, error: message };
  } finally {
    clearInterval(keepAlive);
    running.delete(entity);
    await saveState(entity, state);
  }
}

// ─── Reading the Sundry Debtors from Tally ──────────────────────────────────

const tallyDay = (day) => day.replace(/-/g, ""); // 2026-04-01 → 20260401
const isoDay = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const round2 = (n) => Math.round(n * 100) / 100;

// A collection of Group, Ledger or Voucher with only the fields asked for.
// Export only: nothing is changed in Tally.
async function exportCollection(port, company, type, fetchList, from, to) {
  const xml =
    "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>MVCDebtors</ID></HEADER>" +
    "<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
    `<SVCURRENTCOMPANY>${escape(company)}</SVCURRENTCOMPANY>` +
    `<SVFROMDATE TYPE="Date">${tallyDay(from)}</SVFROMDATE><SVTODATE TYPE="Date">${tallyDay(to)}</SVTODATE>` +
    "</STATICVARIABLES><TDL><TDLMESSAGE>" +
    `<COLLECTION NAME="MVCDebtors" ISMODIFY="No"><TYPE>${type}</TYPE><FETCH>${fetchList}</FETCH></COLLECTION>` +
    "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>";
  const text = await post(port, xml, 180_000);
  const lineError = /<LINEERROR>([\s\S]*?)<\/LINEERROR>/.exec(text);
  if (lineError) throw new Error(`Tally: ${unescape(lineError[1]).trim()}`);
  return text;
}

// Removes nested lists (bill allocations, bank details…) so only the object's own fields remain
function withoutLists(body) {
  let out = body;
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/<([A-Z0-9_.]+\.LIST)\b[^>]*>[\s\S]*?<\/\1>/g, "").replace(/<[A-Z0-9_.]+\.LIST\b[^>]*\/>/g, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

function field(body, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(body);
  return m ? unescape(m[1]).trim() : "";
}

const attr = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? unescape(m[1]).trim() : "";
};

// Tally amounts: negative is debit
function money(text) {
  const n = parseFloat(String(text).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function objects(text, tag) {
  const out = [];
  for (const m of text.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g"))) {
    const own = withoutLists(m[2]);
    out.push({ attrs: m[1], body: m[2], own, name: attr(m[1], "NAME") || field(own, "NAME") });
  }
  return out;
}

function quarters(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  while (true) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    if (start > to) break;
    let ey = y;
    let em = m + 3;
    if (em > 12) {
      em -= 12;
      ey += 1;
    }
    const endDate = new Date(Date.UTC(ey, em - 1, 1) - 86_400_000).toISOString().slice(0, 10);
    out.push({ from: start, to: endDate < to ? endDate : to });
    y = ey;
    m = em;
  }
  return out;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The groups under `root` (any depth), in Tally's order
function groupsUnder(allGroups, root) {
  const inside = new Set([key(root.name)]);
  const out = [];
  for (let added = true; added; ) {
    added = false;
    for (const g of allGroups) {
      if (!inside.has(key(g.name)) && inside.has(key(g.parent))) {
        inside.add(key(g.name));
        out.push({ name: g.name, parent: g.parent });
        added = true;
      }
    }
  }
  return { inside, groups: out };
}

// The Sundry Debtors ledgers with their lines (period.from to period.to), and
// the sales: every line to an income ledger under Sales Accounts from
// `salesFrom`, by month (for Admin's Sales page)
async function readDebtors(port, company, period, salesFrom) {
  const readAt = new Date().toISOString();
  const companies = await names(port, "Company", null);
  if (![...companies].some((c) => key(c) === key(company))) {
    throw new Error(`The company "${company}" is not open in TallyPrime on the Tally PC.` + (companies.size ? ` Open now: ${[...companies].join(", ")}.` : ""));
  }

  // Groups: the Sundry Debtors group and every group under it
  const groupText = await exportCollection(port, company, "Group", "Name, Parent, ReservedName", period.from, period.to);
  const allGroups = objects(groupText, "GROUP").map((g) => ({ name: g.name, parent: field(g.own, "PARENT"), reserved: attr(g.attrs, "RESERVEDNAME") || field(g.own, "RESERVEDNAME") }));
  const root =
    allGroups.find((g) => key(g.reserved) === "sundry debtors") ?? allGroups.find((g) => key(g.name) === "sundry debtors" || key(g.name) === "sundry debtor");
  if (!root) throw new Error("The Sundry Debtors group was not found in Tally");
  const { inside: debtorGroups, groups } = groupsUnder(allGroups, root);
  // Sales Accounts and the groups under it (the income ledgers)
  const salesRoot = allGroups.find((g) => key(g.reserved) === "sales accounts") ?? allGroups.find((g) => key(g.name) === "sales accounts");
  const sales = salesRoot ? groupsUnder(allGroups, salesRoot) : null;

  // Ledgers under those groups, with the balance at the end of the period
  const ledgerText = await exportCollection(port, company, "Ledger", "Name, Parent, ClosingBalance", period.from, period.to);
  const ledgers = new Map();
  const incomeLedgers = new Map(); // key -> { name, group }
  for (const l of objects(ledgerText, "LEDGER")) {
    const parent = field(l.own, "PARENT");
    if (l.name && sales?.inside.has(key(parent))) incomeLedgers.set(key(l.name), { name: l.name.slice(0, 150), group: parent.slice(0, 150) });
    if (!l.name || !debtorGroups.has(key(parent))) continue;
    ledgers.set(key(l.name), { name: l.name, group: parent, closing: round2(-money(field(l.own, "CLOSINGBALANCE"))), entries: [] });
  }

  // Vouchers of the period (and the sales period before it), a quarter at a
  // time; only the debtors' lines and the income ledgers' lines are kept
  const seen = new Set();
  const salesByMonth = new Map(); // "2026-04" -> lines
  const readFrom = sales && salesFrom < period.from ? salesFrom : period.from;
  for (const q of quarters(readFrom, period.to)) {
    const text = await exportCollection(
      port,
      company,
      "Voucher",
      "Date, VoucherTypeName, VoucherNumber, Narration, IsCancelled, IsOptional, IsDeleted, MasterId, AllLedgerEntries.LedgerName, AllLedgerEntries.Amount, LedgerEntries.LedgerName, LedgerEntries.Amount",
      q.from,
      q.to
    );
    for (const v of objects(text, "VOUCHER")) {
      const own = v.own;
      const rawDate = field(own, "DATE");
      if (!/^\d{8}$/.test(rawDate)) continue;
      const date = isoDay(rawDate);
      if (date < q.from || date > q.to) continue;
      if (/^yes$/i.test(field(own, "ISCANCELLED")) || /^yes$/i.test(field(own, "ISOPTIONAL")) || /^yes$/i.test(field(own, "ISDELETED"))) continue;
      const lines = (tag) =>
        [...v.body.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))]
          .map((m) => withoutLists(m[1]))
          .map((b) => ({ ledger: field(b, "LEDGERNAME"), amount: money(field(b, "AMOUNT")) }))
          .filter((e) => e.ledger);
      let entries = lines("ALLLEDGERENTRIES\\.LIST");
      if (!entries.length) entries = lines("LEDGERENTRIES\\.LIST");
      if (!entries.length) continue;
      const type = field(own, "VOUCHERTYPENAME") || attr(v.attrs, "VCHTYPE");
      const number = field(own, "VOUCHERNUMBER");
      const id = field(own, "MASTERID") || attr(v.attrs, "REMOTEID") || attr(v.attrs, "VCHKEY") || `${date}|${type}|${number}|${entries.map((e) => `${e.ledger}:${e.amount}`).join(",")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const narration = field(own, "NARRATION").replace(/\s+/g, " ").slice(0, 300);

      // Sales: each line to an income ledger, with the party (the debtor in the voucher)
      if (sales && date >= salesFrom) {
        const party = entries.find((e) => ledgers.has(key(e.ledger))) ?? entries.find((e) => e.amount < 0 && !incomeLedgers.has(key(e.ledger)));
        for (const e of entries) {
          const income = incomeLedgers.get(key(e.ledger));
          if (!income || !e.amount) continue;
          const month = date.slice(0, 7);
          if (!salesByMonth.has(month)) salesByMonth.set(month, []);
          salesByMonth.get(month).push({
            d: date,
            l: income.name,
            p: (party ? ledgers.get(key(party.ledger))?.name ?? party.ledger : "").slice(0, 150),
            t: type.slice(0, 60),
            n: number.slice(0, 60),
            a: round2(e.amount),
          });
        }
      }
      // The debtors' lines are kept from the start of the debtors' period
      if (date < period.from) continue;

      // One line per debtor ledger in the voucher, as Tally's Ledger Vouchers shows it
      const nets = new Map();
      for (const e of entries) if (ledgers.has(key(e.ledger))) nets.set(key(e.ledger), round2((nets.get(key(e.ledger)) ?? 0) - e.amount));
      for (const [k, net] of nets) {
        if (!net) continue;
        const ledger = ledgers.get(k);
        // Particulars: the first ledger on the other side
        const other = entries.find((e) => key(e.ledger) !== k && (net > 0 ? e.amount > 0 : e.amount < 0)) ?? entries.find((e) => key(e.ledger) !== k);
        ledger.entries.push({
          d: date,
          p: (other?.ledger ?? ledger.name).slice(0, 150),
          t: type.slice(0, 60),
          n: number.slice(0, 60),
          dr: net > 0 ? net : 0,
          cr: net < 0 ? -net : 0,
          ...(narration && { r: narration }),
        });
      }
    }
  }

  const out = [];
  for (const l of ledgers.values()) {
    l.entries.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const moved = l.entries.reduce((sum, e) => sum + e.dr - e.cr, 0);
    const opening = round2(l.closing - moved);
    out.push({ name: l.name.slice(0, 150), group: l.group.slice(0, 150), opening, closing: l.closing, entries: l.entries, hash: await sha256Hex(JSON.stringify([l.group, opening, l.closing, l.entries])) });
  }
  let salesOut = null;
  if (sales) {
    const months = [];
    for (const [month, lines] of [...salesByMonth.entries()].sort()) {
      lines.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
      months.push({ month, lines, hash: await sha256Hex(JSON.stringify(lines)) });
    }
    const ledgerGroups = {};
    for (const l of incomeLedgers.values()) ledgerGroups[l.name] = l.group;
    salesOut = { root: salesRoot.name, groups: sales.groups, ledgers: ledgerGroups, months };
  }
  return { readAt, rootGroup: root.name, groups, ledgers: out, sales: salesOut };
}
