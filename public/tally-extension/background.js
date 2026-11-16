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
