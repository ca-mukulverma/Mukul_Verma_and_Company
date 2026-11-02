import { createServer } from "node:http";

// Two local servers for the extension test (e2e.test.mjs):
//   portal  a mock GST portal: login with captcha, OTP, a logged-in page and
//           logout. The test routes every https://*.gst.gov.in request here as
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
  const state = { events: [], typed: {} };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/^\/services\.gst\.gov\.in/, "");
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
            setTimeout(() => resolve({ ok: false, error: "no answer" }), 10000);
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
