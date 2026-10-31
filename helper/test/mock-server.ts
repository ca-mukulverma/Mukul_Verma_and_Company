import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import JSZip from "jszip";
import type { ClaimedJob, FileDescription } from "../src/api";

// One local HTTP server playing both sides for the end-to-end test:
//   /portal/<host>/<path>   a mock GST portal (*.gst.gov.in is routed here)
//   /api/gst-helper/...     a mock office app
//   /r2/<sha256>            a mock R2 bucket (signed upload links)
// Pages move on with script redirects (location.replace), not HTTP 302s:
// Playwright doesn't follow redirects of responses it fulfils from a route.

export const GSTIN = "23ABCDE1234F1Z5";
export const HELPER_KEY = "test-key-0123456789-0123456789-0123456789";
export const LOGIN = { username: "citymotors", password: "s3cret!" };
export const CAPTCHA = "AB12CD";
export const OTP = "123456";

export interface MockOptions {
  job: ClaimedJob;
  // Month → number of parts of its GSTR-1 JSON (default 1)
  jsonParts?: Record<string, number>;
  // GSTR-1 JSON already asked for on the portal (and ready)
  jsonAlreadyRequested?: string[];
  // Months the portal shows no GSTR-3B for (e.g. a quarterly filer)
  noGstr3b?: string[];
  // How long the portal takes to prepare GSTR-1 JSON
  jsonReadyMs?: number;
}

export interface PutRecord {
  key: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

export interface MockState {
  // What the portal saw, in order: "login", "generate:2025-05", "file:GSTR3B:PDF:2025-04" …
  events: string[];
  typed: { username?: string; password?: string; captcha?: string; otp?: string };
  loggedIn: boolean;
  claims: number;
  statuses: { status?: string; progress?: string; log?: string[] }[];
  uploadUrls: FileDescription[];
  puts: PutRecord[];
  documents: FileDescription[];
  jsonCreates: { returnType: string; month: string }[];
  jsonUpdates: { requestId: string; status: string; parts?: number | null }[];
  finish: { status: string; error?: string | null; log?: string[] } | null;
  badKeys: number;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const QUARTERS = ["Quarter 1 (Apr - Jun)", "Quarter 2 (Jul - Sep)", "Quarter 3 (Oct - Dec)", "Quarter 4 (Jan - Mar)"];
const QUARTER_MONTHS = [[4, 5, 6], [7, 8, 9], [10, 11, 12], [1, 2, 3]];

// A small valid PDF with one line of text
export function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const fp = (month: string) => `${month.slice(5, 7)}${month.slice(0, 4)}`;

function gstr1Json(month: string, part: number) {
  return {
    gstin: GSTIN,
    fp: fp(month),
    filing_typ: "M",
    b2b: [{ ctin: "27AAAAA0000A1Z5", inv: [{ inum: `INV-${part}`, inv_typ: "R", itms: [{ itm_det: { txval: 1000 * part, iamt: 180 * part } }] }] }],
  };
}

function gstr2bJson(month: string) {
  return {
    data: {
      gstin: GSTIN,
      rtnprd: fp(month),
      gendt: "14-05-2025",
      itcsumm: { itcavl: { nonrevsup: { igst: 500, cgst: 0, sgst: 0, cess: 0 } }, itcunavl: {}, itcRejected: {} },
    },
  };
}

async function zipOf(name: string, content: unknown) {
  const zip = new JSZip();
  zip.file(name, JSON.stringify(content));
  return zip.generateAsync({ type: "nodebuffer" });
}

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function startMock(options: MockOptions) {
  const jsonReadyMs = options.jsonReadyMs ?? 1500;
  const requests = new Map<string, number>(); // month → when asked
  for (const month of options.jsonAlreadyRequested ?? []) requests.set(month, Date.now() - 60 * 60_000);

  const state: MockState = {
    events: [],
    typed: {},
    loggedIn: false,
    claims: 0,
    statuses: [],
    uploadUrls: [],
    puts: [],
    documents: [],
    jsonCreates: [],
    jsonUpdates: [],
    finish: null,
    badKeys: 0,
  };
  let base = "";

  const send = (res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, data: unknown) => send(res, status, JSON.stringify(data), { "Content-Type": "application/json" });
  const file = (res: ServerResponse, data: Buffer, type: string, name: string, inline = false) =>
    send(res, 200, data, { "Content-Type": type, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"` });

  // ─── Mock GST portal ──────────────────────────────────────────────────────
  async function portal(host: string, url: URL, req: IncomingMessage, res: ServerResponse) {
    const path = url.pathname;
    const mon = url.searchParams.get("mon") ?? "";

    if (host === "services.gst.gov.in") {
      if (path === "/services/login") {
        return send(
          res,
          200,
          page(
            "Login",
            `<h1>Login</h1>
            <label for="username">Username</label><input id="username" name="username">
            <label for="user_pass">Password</label><input id="user_pass" type="password">
            <label for="captcha">Type the characters you see in the image below</label><input id="captcha">
            <button type="button" id="login">LOGIN</button><p id="msg"></p>
            <script>
              document.getElementById("login").onclick = async () => {
                const r = await fetch("/services/api/authenticate", { method: "POST", body: JSON.stringify({
                  username: username.value, password: user_pass.value, captcha: captcha.value }) });
                if (r.ok) location.replace("/services/otp"); else msg.textContent = "Invalid username or password";
              };
            </script>`
          )
        );
      }
      if (path === "/services/api/authenticate" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString());
        Object.assign(state.typed, body);
        const ok = body.username === LOGIN.username && body.password === LOGIN.password && body.captcha === CAPTCHA;
        return json(res, ok ? 200 : 401, { ok });
      }
      if (path === "/services/otp") {
        return send(
          res,
          200,
          page(
            "OTP",
            `<label for="otp">Enter the OTP sent to your mobile</label><input id="otp"><button type="button" id="verify">VERIFY</button>
            <script>
              document.getElementById("verify").onclick = async () => {
                const r = await fetch("/services/api/otp", { method: "POST", body: JSON.stringify({ otp: otp.value }) });
                if (r.ok) location.replace("/services/auth/fowelcome");
              };
            </script>`
          )
        );
      }
      if (path === "/services/api/otp" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString());
        state.typed.otp = body.otp;
        if (body.otp !== OTP) return json(res, 401, { ok: false });
        state.loggedIn = true;
        state.events.push("login");
        return json(res, 200, { ok: true });
      }
      if (path === "/services/auth/fowelcome") {
        if (!state.loggedIn) return send(res, 200, page("Expired", "<p>Your session has expired. Please login again.</p>"));
        state.events.push("keepalive");
        return send(res, 200, page("Welcome", `<h1>Welcome to the GST portal</h1><a href="https://return.gst.gov.in/returns/auth/dashboard">Returns Dashboard</a>`));
      }
      if (path === "/services/logout") {
        state.loggedIn = false;
        state.events.push("logout");
        return send(res, 200, page("Logged out", "<p>You have logged out successfully.</p>"));
      }
    }

    if (host === "return.gst.gov.in") {
      if (!state.loggedIn) return send(res, 200, page("Expired", "<p>Your session has expired. Please login again.</p>"));

      if (path === "/returns/auth/dashboard") {
        const fin = url.searchParams.get("fin") ?? "";
        const quarter = url.searchParams.get("quarter") ?? "";
        const tiles = mon
          ? `<div class="tiles">
              <div class="tile"><p>Details of outward supplies of goods or services GSTR1</p><p>Status: Filed</p>
                <button type="button" onclick="location.href='/returns/auth/gstr1?mon=${mon}'">VIEW</button>
                <button type="button" onclick="location.href='/returns/auth/gstr1/download?mon=${mon}'">DOWNLOAD</button></div>
              ${options.noGstr3b?.includes(mon) ? "" : `<div class="tile"><p>Monthly Return GSTR3B</p><p>Status: Filed</p>
                <button type="button">VIEW</button>
                <button type="button" onclick="location.href='/returns/auth/gstr3b/pdf?mon=${mon}'">DOWNLOAD</button></div>`}
              <div class="tile"><p>Auto - drafted ITC Statement GSTR2B</p>
                <button type="button" onclick="location.href='/returns/auth/gstr2b/view?mon=${mon}'">VIEW</button>
                <button type="button" onclick="location.href='/returns/auth/gstr2b/download?mon=${mon}'">DOWNLOAD</button></div>
            </div>`
          : "";
        return send(
          res,
          200,
          page(
            "Returns Dashboard",
            `<h1>File Returns</h1>
            <label for="fin">Financial Year</label>
            <select id="fin" name="fin"><option value="">Select</option><option value="2024">2024-25</option><option value="2025">2025-26</option></select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter"><option value="">Select</option>${QUARTERS.map((q, i) => `<option value="${i + 1}">${q}</option>`).join("")}</select>
            <label for="mon">Period</label>
            <select id="mon" name="mon"><option value="">Select</option></select>
            <button type="button" id="search">SEARCH</button>
            ${tiles}
            <script>
              const months = ${JSON.stringify(QUARTER_MONTHS)}, names = ${JSON.stringify(MONTH_NAMES)};
              const fill = () => {
                // Like the portal, the months appear a moment after the quarter is chosen
                setTimeout(() => {
                  const q = Number(quarter.value);
                  mon.innerHTML = '<option value="">Select</option>' + (q ? months[q - 1].map((m) => '<option value="' + m + '">' + names[m - 1] + '</option>').join("") : "");
                }, 300);
              };
              quarter.onchange = fill;
              fin.value = ${JSON.stringify(fin)}; quarter.value = ${JSON.stringify(quarter)};
              search.onclick = () => {
                const y = Number(fin.value), m = Number(mon.value);
                if (!y || !m) return;
                const key = (m >= 4 ? y : y + 1) + "-" + String(m).padStart(2, "0");
                location.replace("/returns/auth/dashboard?fin=" + y + "&quarter=" + quarter.value + "&mon=" + key);
              };
            </script>`
          )
        );
      }

      // GSTR-1: VIEW → the PDF opens in a new tab
      if (path === "/returns/auth/gstr1") {
        return send(res, 200, page("GSTR-1", `<h2>GSTR-1 summary</h2><a href="/returns/auth/gstr1/pdf?mon=${mon}" target="_blank">DOWNLOAD (PDF)</a>`));
      }
      if (path === "/returns/auth/gstr1/pdf") {
        state.events.push(`file:GSTR1:PDF:${mon}`);
        return file(res, makePdf(`GSTR-1 ${mon}`), "application/pdf", `GSTR1_${GSTIN}_${fp(mon)}.pdf`, true);
      }
      // GSTR-1: DOWNLOAD → Generate JSON, then "Click here to download - File N"
      if (path === "/returns/auth/gstr1/download") {
        const asked = requests.get(mon);
        const parts = options.jsonParts?.[mon] ?? 1;
        let status = "";
        if (asked !== undefined && Date.now() - asked < jsonReadyMs) {
          status = "<p>Your request for generation of JSON file is under process. Kindly wait.</p>";
        } else if (asked !== undefined) {
          status = Array.from({ length: parts }, (_, i) => `<p><a href="/returns/auth/gstr1/json?mon=${mon}&file=${i + 1}">Click here to download - File ${i + 1}</a></p>`).join("");
        }
        return send(
          res,
          200,
          page(
            "GSTR-1 download",
            `<h2>Offline download for GSTR-1</h2>
            <button type="button" id="gen">GENERATE JSON FILE TO DOWNLOAD</button>${status}
            <script>
              gen.onclick = async () => {
                await fetch("/returns/auth/gstr1/generate?mon=${mon}", { method: "POST" });
                location.reload();
              };
            </script>`
          )
        );
      }
      if (path === "/returns/auth/gstr1/generate" && req.method === "POST") {
        requests.set(mon, Date.now());
        state.events.push(`generate:${mon}`);
        return json(res, 200, { ok: true });
      }
      if (path === "/returns/auth/gstr1/json") {
        const part = Number(url.searchParams.get("file"));
        state.events.push(`file:GSTR1:JSON:${mon}:${part}`);
        const name = `returns_${fp(mon)}_R1_${GSTIN}_offline_others_${part - 1}`;
        return file(res, await zipOf(`${name}.json`, gstr1Json(mon, part)), "application/zip", `${name}.zip`);
      }

      if (path === "/returns/auth/gstr3b/pdf") {
        state.events.push(`file:GSTR3B:PDF:${mon}`);
        return file(res, makePdf(`GSTR-3B ${mon}`), "application/pdf", `GSTR3B_${GSTIN}_${fp(mon)}.pdf`);
      }

      // GSTR-2B: VIEW → summary PDF in the same tab; DOWNLOAD → JSON / Excel
      if (path === "/returns/auth/gstr2b/view") {
        return send(res, 200, page("GSTR-2B", `<button type="button" onclick="location.href='/returns/auth/gstr2b/pdf?mon=${mon}'">DOWNLOAD GSTR-2B SUMMARY (PDF)</button>`));
      }
      if (path === "/returns/auth/gstr2b/pdf") {
        state.events.push(`file:GSTR2B:PDF:${mon}`);
        return file(res, makePdf(`GSTR-2B ${mon}`), "application/pdf", `GSTR2B_${GSTIN}_${fp(mon)}.pdf`, true);
      }
      if (path === "/returns/auth/gstr2b/download") {
        return send(
          res,
          200,
          page(
            "GSTR-2B download",
            `<button type="button" onclick="location.href='/returns/auth/gstr2b/json?mon=${mon}'">GENERATE JSON FILE TO DOWNLOAD</button>
            <button type="button" onclick="location.href='/returns/auth/gstr2b/excel?mon=${mon}'">GENERATE EXCEL FILE TO DOWNLOAD</button>`
          )
        );
      }
      if (path === "/returns/auth/gstr2b/json") {
        state.events.push(`file:GSTR2B:JSON:${mon}`);
        const name = `returns_R2B_${GSTIN}_${fp(mon)}`;
        return file(res, await zipOf(`${name}.json`, gstr2bJson(mon)), "application/zip", `${name}.zip`);
      }
      if (path === "/returns/auth/gstr2b/excel") {
        state.events.push(`file:GSTR2B:EXCEL:${mon}`);
        const zip = new JSZip();
        zip.file("xl/workbook.xml", "<workbook/>");
        return file(res, await zip.generateAsync({ type: "nodebuffer" }), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${GSTIN}_${fp(mon)}_R2B.xlsx`);
      }
    }
    return send(res, 404, page("Not found", "<p>Page not found</p>"));
  }

  // ─── Mock office app ──────────────────────────────────────────────────────
  async function office(path: string, req: IncomingMessage, res: ServerResponse) {
    if (req.headers["x-gst-helper-key"] !== HELPER_KEY) {
      state.badKeys++;
      return json(res, 401, { error: "Wrong helper key" });
    }
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    if (path === "/api/gst-helper/claim") {
      state.claims++;
      return json(res, 200, { job: state.claims === 1 ? options.job : null });
    }
    const match = path.match(/^\/api\/gst-helper\/jobs\/([^/]+)\/([\w-]+)$/);
    if (!match || match[1] !== options.job.id) return json(res, 404, { error: "Job not found" });
    if (state.finish) return json(res, 409, { error: "The job is finished" });
    switch (match[2]) {
      case "status":
        state.statuses.push(body);
        return json(res, 200, { ok: true });
      case "upload-url":
        state.uploadUrls.push(body);
        return json(res, 200, { key: `clients/c1/${body.sha256}`, alreadyStored: false, url: `${base}/r2/${body.sha256}` });
      case "document":
        if (!state.puts.some((p) => p.key === body.sha256)) return json(res, 400, { error: "The upload did not finish. Try again" });
        state.documents.push(body);
        return json(res, 200, { created: true, filed: body.format === "PDF" && body.returnType === "GSTR3B" ? "Marked filed" : null, itemId: "item-1" });
      case "json-requests":
        if (body.action === "create") {
          state.jsonCreates.push(body);
          return json(res, 200, { request: { id: `req-${body.month}`, returnType: body.returnType, month: body.month, requestedAt: new Date().toISOString(), status: "REQUESTED" } });
        }
        state.jsonUpdates.push(body);
        return json(res, 200, { request: { id: body.requestId, status: body.status, parts: body.parts } });
      case "finish":
        state.finish = body;
        return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "Unknown route" });
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const portalMatch = url.pathname.match(/^\/portal\/([^/]+)(\/.*)$/);
      if (portalMatch) {
        const inner = new URL(portalMatch[2] + url.search, `https://${portalMatch[1]}`);
        return await portal(portalMatch[1], inner, req, res);
      }
      if (url.pathname.startsWith("/api/gst-helper/")) return await office(url.pathname, req, res);
      if (url.pathname.startsWith("/r2/") && req.method === "PUT") {
        state.puts.push({ key: url.pathname.slice(4), headers: req.headers, body: await readBody(req) });
        return send(res, 200, "");
      }
      send(res, 404, "Not found");
    } catch (error) {
      send(res, 500, String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, state, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
