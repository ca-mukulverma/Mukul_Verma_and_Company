import { createServer } from "node:http";

// Two local servers for the extension test (e2e.test.mjs):
//   portal  a mock GST portal: login with captcha, OTP, a logged-in page,
//           the Returns Dashboard (built like the real one: drop-downs, Search,
//           a box per return whose buttons depend on whether it is filed),
//           the GSTR-1 summary, GSTR-1 JSON and GSTR-2B pages, and logout.
//           Sep 2026 is filed; Oct 2026 is not (GSTR-1 submitted, GSTR-3B
//           not filed). Every button pressed is logged in state.clicks. The test routes every https://*.gst.gov.in request here as
//           /<host><path>, and pages move on with location.replace, which
//           Playwright follows for routed responses.
//   app     a stand-in for the app's page: it talks to the extension's bridge
//           with the same messages as src/components/compliance/gst-extension.ts.

export const LOGIN = { username: "citymotors", password: "s3cret!" };
export const CAPTCHA = "AB12CD";
export const OTP = "123456";

const html = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

export async function startPortal() {
  const state = { events: [], typed: {}, clicks: [], jsonAsked: 0, reminded: false };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const host = url.pathname.split("/")[1];
    const rest = url.pathname.slice(host.length + 1);
    const path = host === "services.gst.gov.in" ? rest : `/${host}${rest}`;
    const send = (text, type = "text/html") => {
      res.writeHead(200, { "content-type": type });
      res.end(text);
    };
    if (path === "/services/login") {
      // The form appears a moment after the page loads, like the real portal
      return send(
        html(
          "Login",
          `<div id="app"></div><script>
            let inputs = 0;
            setTimeout(() => {
              document.getElementById("app").innerHTML =
                '<input id="username"><input id="user_pass" type="password"><input id="captcha"><button id="login">LOGIN</button>';
              for (const id of ["username", "user_pass"]) document.getElementById(id).addEventListener("input", () => inputs++);
              document.getElementById("login").onclick = async () => {
                const v = (id) => document.getElementById(id).value;
                await fetch("/services/submit-login", { method: "POST", body: JSON.stringify({ username: v("username"), password: v("user_pass"), captcha: v("captcha"), inputs }) });
                location.replace("/services/otp");
              };
            }, 300);
          </script>`
        )
      );
    }
    if (path === "/services/submit-login" || path === "/services/submit-otp") {
      Object.assign(state.typed, JSON.parse(await body(req)));
      state.events.push(path.endsWith("otp") ? "otp" : "login");
      return send("{}", "application/json");
    }
    if (path === "/services/otp") {
      return send(
        html(
          "OTP",
          `<input id="otp"><button id="verify">VERIFY</button><script>
            document.getElementById("verify").onclick = async () => {
              await fetch("/services/submit-otp", { method: "POST", body: JSON.stringify({ otp: document.getElementById("otp").value }) });
              location.replace("/services/auth/fowelcome");
            };
          </script>`
        )
      );
    }
    if (path === "/services/auth/fowelcome") return send(html("Welcome", "<h1>Welcome to the GST portal</h1>"));
    if (rest === "/log" && req.method === "POST") {
      state.clicks.push(await body(req));
      return send("{}", "application/json");
    }
    const returns = returnsPage(path, url, state);
    if (returns) return send(...returns);
    if (path === "/services/logout") {
      state.events.push("logout");
      return send(html("Logged out", "<p>You have logged out</p>"));
    }
    res.writeHead(404);
    res.end("not found");
  });
  const port = await listen(server);
  return { base: `http://127.0.0.1:${port}`, state, close: () => server.close() };
}

// The app page: window.ask(message) answers like ask() in gst-extension.ts;
// window.statuses collects the status changes the extension sends
export async function startApp() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      html(
        "App",
        `<script>
          window.statuses = [];
          let n = 0;
          window.ask = (message) => new Promise((resolve) => {
            const id = "t" + ++n;
            const listener = (e) => {
              if (e.source === window && e.data?.source === "mvc-gst-ext" && e.data.type === "answer" && e.data.id === id) {
                window.removeEventListener("message", listener);
                resolve(e.data.answer);
              }
            };
            window.addEventListener("message", listener);
            setTimeout(() => resolve({ ok: false, error: "no answer" }), 120000);
            window.postMessage({ source: "mvc-app-gst", id, message }, location.origin);
          });
          window.addEventListener("message", (e) => {
            if (e.source === window && e.data?.source === "mvc-gst-ext" && e.data.type === "status") window.statuses.push(e.data.run);
          });
        </script>`
      )
    );
  });
  const port = await listen(server);
  return { port, close: () => server.close() };
}

// ─── Returns pages ──────────────────────────────────────────────────────────

// Logs every button and link pressed; saveAs() is how the portal's pdfMake
// and FileSaver hand over a file: a blob link clicked in code
const COMMON = `<script>
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button, a");
    if (b) fetch("/log", { method: "POST", body: b.innerText.trim() });
  }, true);
  function saveAs(blob, name) {
    const a = document.createElementNS("http://www.w3.org/1999/xhtml", "a");
    a.download = name;
    a.href = URL.createObjectURL(blob);
    setTimeout(() => a.dispatchEvent(new MouseEvent("click")), 0);
  }
</script>`;

const page = (title, body) => [html(title, COMMON + body)];

// Return boxes as the real dashboard template draws them
const tile = (title, name, inner) => `<div class="col-sm-4"><div><a><div class="hd"><p class="inv">${title}</p><p>${name}</p></div></a><div class="ct">${inner}</div></div></div>`;
const TILES = {
  "092026": [
    tile("Details of outward supplies of goods or services", "GSTR-1", `<p class="f-wt">Status- <span>Filed</span></p><div class="row"><div><button onclick="go('/returns/auth/gstr1')">VIEW</button></div><div><button onclick="show1json()">Download</button></div></div>`),
    tile("Auto - drafted ITC Statement for the month", "GSTR-2B", `<div class="row"><div><button>View</button></div><div><button onclick="go2b()">Download</button></div></div>`),
    tile("Monthly Return", "GSTR-3B", `<p class="f-wt">Status- <span>Filed</span></p><div class="row"><div><button>VIEW GSTR3B</button></div><div><button onclick="saveAs(new Blob(['%PDF-1.4 GSTR-3B 092026'], { type: 'application/pdf' }), 'GSTR3B_23AAFFC2640H1ZX_092026.pdf')">Download</button></div></div>`),
  ],
  // Not filed: GSTR-1 submitted (FILE GSTR1 where VIEW is), GSTR-3B not filed (Prepare Online / Prepare offline where VIEW / Download are)
  "102026": [
    tile("Details of outward supplies of goods or services", "GSTR-1", `<p class="f-wt">Status- <span>Submitted</span></p><div class="row"><div><button>FILE GSTR1</button></div><div><button>Download</button></div></div>`),
    tile("Monthly Return", "GSTR-3B", `<p>Due Date - <span>20/11/2026</span></p><div class="row"><div><button>Prepare Online</button></div><div><button>Prepare offline</button></div></div>`),
  ],
};

function returnsPage(path, url, state) {
  if (path === "/return.gst.gov.in/returns/auth/dashboard") {
    // The Aadhaar pop-up comes once a session
    const remind = !state.reminded;
    state.reminded = true;
    return page(
      "Dashboard",
      `${remind ? '<div id="adhr"><a onclick="this.parentElement.remove()">REMIND ME LATER</a></div>' : ""}
      <form onsubmit="event.preventDefault(); search()">
        <div><label>Financial Year</label><select name="fin"></select></div>
        <div id="q"></div>
        <div><label>Period</label><select name="mon"></select></div>
        <div><button class="srchbtn" type="submit">Search</button></div>
      </form>
      <div id="tiles"></div><div id="offline"></div>
      <script>
        const TILES = ${JSON.stringify(TILES)};
        const go = (p) => { location.href = p; };
        const fill = (sel, list) => { sel.innerHTML = list.map((t, i) => '<option value="object:' + (200 + i) + '">' + t + '</option>').join(""); };
        const fin = document.querySelector('select[name="fin"]');
        const mon = document.querySelector('select[name="mon"]');
        // Like Angular, the lists fill a moment later, the months once the quarter is chosen
        setTimeout(() => {
          fill(fin, ["2025-26", "2026-27"]);
          document.getElementById("q").innerHTML = '<label>Quarter</label><select name="quarter"></select>';
          const q = document.querySelector('select[name="quarter"]');
          fill(q, ["Quarter 1 (Apr - Jun)", "Quarter 2 (Jul - Sep)", "Quarter 3 (Oct - Dec)"]);
          q.addEventListener("change", () => setTimeout(() => fill(mon, q.selectedIndex === 1 ? ["July", "August", "September"] : q.selectedIndex === 2 ? ["October", "November"] : ["April"]), 300));
        }, 300);
        function search() {
          const text = mon.options[mon.selectedIndex]?.text;
          const prd = { September: "092026", October: "102026" }[text];
          sessionStorage.setItem("prd", prd);
          document.getElementById("offline").innerHTML = "";
          setTimeout(() => { document.getElementById("tiles").innerHTML = (TILES[prd] ?? []).join(""); }, 400);
        }
        function go2b() {
          const f = document.createElement("form");
          f.method = "POST"; f.action = "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2bdwld";
          document.body.appendChild(f); f.submit();
        }
        // Like the portal's offline download page (main.js): the links come
        // only as the answer of a Generate click
        function show1json() {
          document.getElementById("tiles").innerHTML = "";
          document.getElementById("offline").innerHTML = '<button onclick="gen()">Generate JSON File to Download</button><div id="said"></div><div id="links"></div>';
        }
        async function gen() {
          const answer = await (await fetch("/json-generate", { method: "POST" })).json();
          document.getElementById("said").innerHTML = '<div class="alert alert-msg alert-success">' + answer.msg + "</div>";
          let links = "";
          for (let i = 1; i <= answer.rc; i++) links += '<a target="_blank" href="/returns/auth/api/offline/download/url?rtn_prd=092026&rtn_typ=GSTR1&file_num=' + i + '"><span>Click here to download - File ' + i + "</span></a><br>";
          document.getElementById("links").innerHTML = links;
        }
      </script>`
    );
  }
  if (path === "/return.gst.gov.in/json-generate") {
    // First click: the request is taken; later clicks: the file is ready, in two parts
    state.jsonAsked++;
    return state.jsonAsked === 1
      ? [JSON.stringify({ msg: "Your request for generation of JSON file has been accepted. Kindly wait for 20 minutes.", rc: 0 }), "application/json"]
      : [JSON.stringify({ msg: "Your file is generated. Click on the links below to download.", rc: 2 }), "application/json"];
  }
  if (path === "/return.gst.gov.in/returns/auth/api/offline/download/url") {
    const part = url.searchParams.get("file_num");
    // Part 2 answers with the address of the file, as some portal links do
    if (part === "2") return [JSON.stringify({ status: 1, data: { url: "https://files.gst.gov.in/dl/r1_092026_2.zip" } }), "application/json"];
    return [`PK\u0003\u0004 GSTR1 JSON ${url.searchParams.get("rtn_prd")} part ${part}`, "application/zip"];
  }
  if (path === "/files.gst.gov.in/dl/r1_092026_2.zip") return ["PK\u0003\u0004 GSTR1 JSON 092026 part 2", "application/zip"];
  if (path === "/return.gst.gov.in/returns/auth/gstr1") {
    return page(
      "GSTR-1",
      `<div id="g"></div><script>
        setTimeout(() => {
          document.getElementById("g").innerHTML = '<button onclick="sum()"><span style="display:none">GENERATE SUMMARY</span><span>VIEW SUMMARY</span></button>';
        }, 300);
        function sum() {
          document.getElementById("g").innerHTML = '<button onclick="pdf()"><span style="display:none">DOWNLOAD SUMMARY (PDF)</span><span>DOWNLOAD (PDF)</span></button><button>File Statement</button>';
        }
        function pdf() {
          const prd = sessionStorage.getItem("prd");
          setTimeout(() => saveAs(new Blob(["%PDF-1.4 GSTR-1 " + prd], { type: "application/pdf" }), "GSTR1_23AAFFC2640H1ZX_" + prd + ".pdf"), 500);
        }
      </script>`
    );
  }
  if (path === "/gstr2b.gst.gov.in/gstr2b/auth/gstr2bdwld") {
    return page(
      "GSTR2B",
      `<app-root></app-root><script>
        setTimeout(() => {
          document.querySelector("app-root").innerHTML = '<div><button id="json" disabled onclick="dl()">GENERATE JSON FILE TO DOWNLOAD</button><button>GENERATE EXCEL FILE TO DOWNLOAD</button></div>';
          setTimeout(() => document.getElementById("json").removeAttribute("disabled"), 1500);
        }, 300);
        // Like a bundle that took its own references when it loaded: the
        // file goes to Chrome as a normal download, unseen by the page hooks
        const create = URL.createObjectURL.bind(URL);
        const click = HTMLAnchorElement.prototype.click;
        function dl() {
          // Its data comes from the portal first, the button waits meanwhile
          setTimeout(() => {
            const a = document.createElement("a");
            a.download = "092026_23AAFFC2640H1ZX_GSTR2B.json";
            a.href = create(new Blob([JSON.stringify({ data: { gstin: "23AAFFC2640H1ZX", rtnprd: "092026" } })], { type: "application/json" }));
            click.call(a);
          }, 300);
        }
      </script>`
    );
  }
  return null;
}
