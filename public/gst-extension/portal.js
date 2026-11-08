// Runs one step of a download in the GST portal tab (injected by the
// background worker with chrome.scripting into the page's own world, so it
// can catch the files the page builds in the browser). Each call is one
// step: pages change between steps, and the worker waits for them. Nothing
// here reads or types a captcha or OTP, and buttons that file, submit,
// prepare, reset or pay are never clicked. docs/GST_PORTAL_EXTENSION_PLAN.md §5.

// Answers: { next: true } · { file: {...} } · { files: [...] } · { links: [] }
// · { result: "not-filed" | "not-available" | "requested" | "pending" |
// "session-expired", message } · { error }
// This file's version: must equal the manifest's (see background.js)
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- read by background.js
const MVC_PORTAL_CODE = "0.4.5";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- called by background.js
async function mvcPortalStep(step, ctx) {
  // The extension's own list, on top of the one in the portal settings
  const NEVER = [/^\s*file\b/i, /\bfile\s*(return|statement|gstr|with|iff)/i, /\bsubmit\b/i, /prepare\s*(online|offline)/i, /\breset\b/i, /proceed/i, /\bsign\b/i, /\bevc\b/i, /\bdsc\b/i, /delete/i, /payment/i, /offset/i];
  const re = (s) => new RegExp(s, "i");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el?.innerText ?? el?.textContent ?? el?.value ?? "").replace(/\s+/g, " ").trim();
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const never = [...NEVER, ...(ctx.neverClick ?? []).map(re)];
  const blocked = (el) => never.some((r) => r.test(text(el)));
  const CLICKABLE = "button, a, input[type=button], input[type=submit], [role=button]";
  const clickables = (root) => [...root.querySelectorAll(CLICKABLE)].filter(visible);
  const find = (root, target) => {
    if (target.text) return clickables(root).find((el) => re(target.text).test(text(el))) ?? null;
    const el = target.css ? root.querySelector(target.css) : null;
    return visible(el) ? el : null;
  };
  const findAll = (root, target) => clickables(root).filter((el) => target.text && re(target.text).test(text(el)));
  const pageText = () => text(document.body);
  const first = (list) => {
    const t = pageText();
    for (const s of list ?? []) {
      const m = t.match(re(s));
      if (m) return m[0];
    }
    return null;
  };
  const counts = (list) => (list ?? []).map((s) => (pageText().match(new RegExp(s, "gi")) ?? []).length);
  // A message that appeared after a click (one already on the page doesn't count)
  const newMessage = (list, before) => {
    const after = counts(list);
    const i = after.findIndex((n, k) => n > before[k]);
    return i < 0 ? null : pageText().match(re(list[i]))?.[0] ?? null;
  };
  const dismiss = () => {
    for (const d of ctx.dismiss ?? []) {
      const el = find(document, { text: d });
      if (el && !blocked(el)) {
        note("pop-up closed by script click", { el: describe(el) });
        el.click();
      }
    }
  };
  const expired = () => first(ctx.sessionExpired);
  // The portal's message boxes (success / danger), as shown now
  const alerts = () =>
    [...document.querySelectorAll(".alert, alert-message, [role=alert], .msg")]
      .filter(visible)
      .map((a) => ({ text: text(a).replace(/^×\s*/, ""), danger: /danger|error/i.test(`${a.className} ${a.getAttribute("type") ?? ""}`) }))
      .filter((a) => a.text);
  async function waitFor(get, ms) {
    const end = Date.now() + ms;
    for (;;) {
      dismiss();
      const value = get();
      if (value) return value;
      if (Date.now() > end) return null;
      await sleep(300);
    }
  }
  // A click, made the way a person's is: Chrome itself clicks the spot (real
  // mouse events through the extension, via relay.js and the worker), so the
  // portal sees an ordinary click from its own page. A click made by script
  // instead is treated by Chrome as coming from the extension, and the portal
  // refuses the pages it opens (access denied). If real clicks aren't
  // available (Chrome's debugging bar was cancelled), a click that opens
  // another page is left to the person: the button is highlighted and the
  // step waits for their click; other clicks are made by script.
  async function press(el, opensPage) {
    if (blocked(el)) throw new Error(`Refused to click "${text(el)}": it may file or change the return`);
    note("press", { el: describe(el), opensPage, clicks: ctx.clicks ?? "real", page: location.href });
    el.scrollIntoView({ block: "center" });
    await sleep(200);
    if (ctx.clicks !== "assisted") {
      const at = await clearSpot(el);
      note(at ? "real click asked for" : "button stayed covered: no real click", { at, covering: at ? null : describe(coverOf(el)) });
      if (at) {
        const answer = await toWorker({ type: "real-click", x: at.x, y: at.y });
        note("real click answer", { answer, page: location.href });
        if (answer?.ok) return;
        if (answer?.assisted) ctx.clicks = "assisted";
      }
    }
    if (!opensPage) {
      note("script click", { el: describe(el) });
      el.click();
      return;
    }
    note("waiting for the person's click", { el: describe(el) });
    await personClicks(el);
  }

  // Diagnostics (the app's "Save diagnostics"): what this step saw and did,
  // sent to the worker without waiting for an answer
  function note(what, data) {
    try {
      window.postMessage({ source: "mvc-portal-page", id: `note-${Date.now()}-${Math.random()}`, token: ctx.token, type: "diag", note: JSON.stringify({ what, ...data }).slice(0, 3000) }, location.origin);
    } catch {
      // Never stops a step
    }
  }
  // An element as the log shows it: tag, text, and what a click on it does
  function describe(el) {
    if (!el) return null;
    const attrs = {};
    for (const a of ["id", "class", "href", "target", "type", "onclick", "ng-click", "data-ng-click", "ui-sref", "role"]) {
      const v = el.getAttribute?.(a);
      if (v) attrs[a] = v.slice(0, 200);
    }
    return { tag: el.tagName?.toLowerCase(), text: text(el).slice(0, 80), ...attrs, html: (el.outerHTML ?? "").slice(0, 400) };
  }
  // What sits on top of the element's middle
  function coverOf(el) {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  }

  // The middle of the element, once nothing covers it (the portal's "please
  // wait" layer, a pop-up); null if it stays covered
  async function clearSpot(el) {
    return waitFor(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(x, y);
      return top && (top === el || el.contains(top)) ? { x, y } : null;
    }, 10000);
  }

  // Asks the extension (through relay.js) and waits for its answer
  function toWorker(message, ms = 20000) {
    const id = `${Date.now()}-${Math.random()}`;
    return new Promise((resolve) => {
      const done = (answer) => {
        window.removeEventListener("message", listener);
        clearTimeout(timer);
        resolve(answer);
      };
      const listener = (e) => {
        if (e.source === window && e.data?.source === "mvc-portal-ext" && e.data.id === id) done(e.data);
      };
      const timer = setTimeout(() => done(null), ms);
      window.addEventListener("message", listener);
      window.postMessage({ source: "mvc-portal-page", id, token: ctx.token, ...message }, location.origin);
    });
  }

  // The person clicks: the button is outlined, a banner says what to click,
  // and the step waits for a real click on it
  async function personClicks(el) {
    const label = text(el) || "the highlighted button";
    toWorker({ type: "ask-person", label }, 3000);
    const banner = document.createElement("div");
    banner.textContent = `MV Company app: please click "${label}" (highlighted in orange) to continue.`;
    banner.setAttribute("style", "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#f59e0b;color:#111;font:600 16px/1.4 sans-serif;padding:10px 14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none");
    document.documentElement.appendChild(banner);
    const outline = el.style.outline;
    el.style.outline = "4px solid #f59e0b";
    el.style.outlineOffset = "3px";
    try {
      const clicked = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 170000);
        el.addEventListener("click", (e) => e.isTrusted && (clearTimeout(timer), resolve(true)), { capture: true, once: false });
      });
      if (!clicked) throw new Error(`Nobody clicked "${label}" in the GST portal tab within 3 minutes`);
    } finally {
      banner.remove();
      el.style.outline = outline;
    }
  }

  // The return's box: the element holding just its name ("GSTR-3B"), and
  // up from there to the first block that also holds a button
  const findTile = () => {
    const name = re(ctx.tileName);
    const labels = [...document.querySelectorAll("p, span, div, h1, h2, h3, h4, h5, label")].filter((el) => visible(el) && name.test(text(el)) && text(el).length < 60);
    for (const label of labels) {
      for (let el = label.parentElement; el && el !== document.body; el = el.parentElement) {
        if (!el.querySelector("button")) continue;
        // One return's box, not a block holding several
        if (text(el).length < 800) return el;
        break;
      }
    }
    return null;
  };

  // ── Capturing files the page makes (pdfMake / FileSaver: a blob link
  // clicked in code), installed once per page
  function arm() {
    if (!window.__mvcCapture) {
      const blobs = new Map();
      const got = [];
      // The page's own requests while armed (address, answer; no contents)
      const net = [];
      const state = { armed: false, got, net };
      const note = (method, url, status, type) => {
        if (!state.armed) return;
        try {
          const u = new URL(url, location.href);
          net.push({ method, path: `${u.host === location.host ? "" : u.host}${u.pathname}`, status, type: (type ?? "").split(";")[0] });
        } catch {
          // Not an address
        }
      };
      const pageFetch = window.fetch;
      window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : input?.url;
        const method = (init?.method ?? input?.method ?? "GET").toUpperCase();
        return pageFetch.apply(this, arguments).then((r) => {
          note(method, url, r.status, r.headers.get("content-type"));
          return r;
        });
      };
      const xhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.addEventListener("loadend", () => note(String(method).toUpperCase(), String(url), this.status, this.getResponseHeader("content-type")));
        return xhrOpen.apply(this, arguments);
      };
      const create = URL.createObjectURL;
      URL.createObjectURL = function (obj) {
        const url = create.apply(this, arguments);
        if (obj instanceof Blob) blobs.set(url, obj);
        return url;
      };
      const take = (href, name) => {
        if (!state.armed || typeof href !== "string" || !/^(blob:|data:)/.test(href)) return false;
        got.push({ href, name: name || "", blob: blobs.get(href) ?? null });
        return true;
      };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (take(this.href, this.download)) return;
        return click.apply(this, arguments);
      };
      const dispatch = EventTarget.prototype.dispatchEvent;
      EventTarget.prototype.dispatchEvent = function (event) {
        if (this instanceof HTMLAnchorElement && event?.type === "click" && take(this.href, this.download)) return false;
        return dispatch.apply(this, arguments);
      };
      document.addEventListener(
        "click",
        (e) => {
          const a = e.target?.closest?.("a[href]");
          if (a && take(a.href, a.download)) e.preventDefault();
        },
        true
      );
      const open = window.open;
      window.open = function (url) {
        if (take(String(url ?? ""), "")) return null;
        return open.apply(this, arguments);
      };
      window.__mvcCapture = state;
    }
    window.__mvcCapture.got.length = 0;
    window.__mvcCapture.net.length = 0;
    window.__mvcCapture.armed = true;
    return window.__mvcCapture;
  }

  async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }
  const nameFrom = (response, fallback) => {
    const cd = response.headers.get("content-disposition") ?? "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (m) return decodeURIComponent(m[1].trim());
    const last = new URL(response.url).pathname.split("/").pop() ?? "";
    return /\.\w{2,4}$/.test(last) ? decodeURIComponent(last) : fallback;
  };

  try {
    if (expired()) return { result: "session-expired", message: expired() };
    switch (step.kind) {
      case "period": {
        // Financial year, quarter (where shown), month; then Search
        for (const s of ctx.selects) {
          const option = re(s.option.replace("{fy}", ctx.fy).replace("{quarter}", ctx.quarter).replace("{month}", ctx.monthName));
          const select = await waitFor(() => {
            const el = document.querySelector(s.css) ?? [...document.querySelectorAll("select")].find((x) => re(s.label).test(text(x.closest("div")?.querySelector("label"))));
            return visible(el) ? el : null;
          }, s.optional ? 1500 : 20000);
          if (!select) {
            if (s.optional) continue;
            return { error: "The Returns Dashboard didn't show its drop-downs" };
          }
          // A list's options can arrive a moment after the one before it is chosen
          const opt = await waitFor(() => [...select.options].find((o) => option.test(text(o))), 10000);
          if (!opt) return { result: "not-available", message: `the portal has no ${s.option.includes("{fy}") ? `financial year ${ctx.fy}` : s.option.includes("{month}") ? ctx.monthName : `quarter ${ctx.quarter}`} in its list` };
          if (select.value !== opt.value) {
            select.value = opt.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await sleep(400);
          }
        }
        const search = await waitFor(() => find(document, ctx.search), 10000);
        if (!search) return { error: "The Returns Dashboard has no Search button" };
        await press(search, false);
        return { next: true };
      }

      case "tile": {
        // The returns' boxes appear after Search
        const tile = await waitFor(findTile, 20000);
        if (!tile) {
          const why = first(ctx.notAvailable);
          return { result: "not-available", message: why ? why.toLowerCase() : `the portal shows no ${ctx.returnLabel} for this period` };
        }
        if (step.filed && !re(ctx.filedStatus).test(text(tile))) {
          // What the box offers instead of View / Download
          const status = text(tile).match(/status\s*-?\s*(not filed|filed - invalid|submission in progress|submitted|generated|filed)/i)?.[1] ?? "not filed";
          const offers = clickables(tile).filter((el) => el.tagName !== "A").map(text).filter((t) => t && t.length < 40);
          return {
            result: "not-filed",
            message: `${ctx.returnLabel} ${ctx.periodLabel} is not filed on the portal yet (status: ${status.toLowerCase()})${offers.length ? `: it offers ${offers.join(" / ")} instead of the download` : ""}`,
          };
        }
        return { next: true };
      }

      case "click": {
        const root = step.scope === "tile" ? await waitFor(findTile, 15000) : document;
        if (!root) return { error: `The ${ctx.returnLabel} box went away` };
        const el = await waitFor(() => find(root, step.target) ?? (step.orFile ? find(root, step.orFile) : null), (step.waitSeconds ?? 20) * 1000);
        // The page shows the file's own button instead: the worker catches it
        if (el && step.orFile && !re(step.target.text ?? "^$").test(text(el))) return { fileInstead: true };
        if (!el) {
          const why = first(ctx.notAvailable);
          if (why) return { result: "not-available", message: why.toLowerCase() };
          return { error: `"${step.target.text ?? step.target.css}" wasn't found on the portal page (${location.pathname})` };
        }
        const before = counts(ctx.notAvailable);
        await press(el, !!step.url);
        // Another page opens: the worker waits for it
        if (step.url) return { next: true };
        await sleep(800);
        const why = newMessage(ctx.notAvailable, before);
        if (why) return { result: "not-available", message: why.toLowerCase() };
        return { next: true };
      }

      case "file": {
        const root = step.scope === "tile" ? await waitFor(findTile, 15000) : document;
        if (!root) return { error: `The ${ctx.returnLabel} box went away` };
        // Links the page may list instead of sending the file (GSTR-2B in
        // parts: "Download here" for the summary and each part of the details)
        const listed = () => (step.orLinks ? findAll(document, step.orLinks) : []);
        if (listed().length) return { links: listed().length };
        // step.index: the nth of those links (the worker asks for each in turn)
        const el = await waitFor(() => (step.index != null ? findAll(root, step.target)[step.index] : find(root, step.target)), (step.waitSeconds ?? 20) * 1000);
        if (!el) {
          const why = first(ctx.notAvailable);
          if (why) return { result: "not-available", message: why.toLowerCase() };
          return { error: `"${step.target.text ?? step.target.css}" wasn't found on the portal page (${location.pathname})` };
        }
        // Pages that load their data first keep the button disabled meanwhile
        await waitFor(() => !el.disabled && !el.closest("[disabled], .disabled") && el.getAttribute("aria-disabled") !== "true", 30000);
        const capture = arm();
        const shown = new Set(alerts().map((a) => a.text));
        const before = counts(ctx.notAvailable);
        await press(el, false);
        let why = null;
        let seen = 0;
        let seenAt = 0;
        const got = await waitFor(() => {
          why = newMessage(ctx.notAvailable, before) ?? (expired() ? "session" : null);
          if (capture.got[0] || why) return capture.got[0] ?? why;
          // The page listed links instead: once their number holds for a moment
          const n = listed().length;
          if (n !== seen) {
            seen = n;
            seenAt = Date.now();
          } else if (n && Date.now() - seenAt > 1500) {
            return { links: n };
          }
          return null;
        }, 120000);
        capture.armed = false;
        if (got?.links) {
          note("the page listed links instead of a file", { links: got.links, texts: listed().map((a) => text(a.closest("tr") ?? a).slice(0, 80)) });
          return { links: got.links };
        }
        if (!got) {
          // What the page did instead, so the next fix is exact
          const said = alerts()
            .map((a) => a.text)
            .filter((t) => !shown.has(t));
          const asked = capture.net.slice(-4).map((n) => `${n.method} ${n.path} → ${n.status} ${n.type}`);
          return {
            error: `No file came from the portal within 2 minutes after "${text(el)}" (${location.host}${location.pathname})${said.length ? `. The page says: ${said.join(" | ")}` : ""}${asked.length ? `. It asked: ${asked.join("; ")}` : ". It asked the portal nothing"}`,
          };
        }
        if (typeof got === "string") return got === "session" ? { result: "session-expired", message: expired() } : { result: "not-available", message: got.toLowerCase() };
        const blob = got.blob ?? (await (await fetch(got.href)).blob());
        return { file: { name: got.name, type: blob.type, base64: await toBase64(blob) } };
      }

      case "generate": {
        // One click per visit: the portal answers with the links of a file it
        // has ready, or starts making one; a second click would make a new one
        const el = await waitFor(() => find(document, step.target), 15000);
        if (!el) return { error: `"${step.target.text}" wasn't found on the portal page` };
        const before = new Set(alerts().map((a) => a.text));
        const linksBefore = step.links ? findAll(document, step.links).length : 0;
        const patterns = [...(ctx.jsonPending ?? []), ...(ctx.notAvailable ?? [])];
        const counted = counts(patterns);
        await press(el, false);
        let said = null;
        let saidAt = 0;
        const links = await waitFor(() => {
          const found = step.links ? findAll(document, step.links) : [];
          if (found.length > linksBefore || (found.length && said)) return found;
          if (!said) {
            const fresh = alerts().find((a) => !before.has(a.text));
            const matched = newMessage(patterns, counted);
            if (fresh || matched) {
              said = fresh ?? { text: matched, danger: false };
              saidAt = Date.now();
            }
          }
          // The links come with the message: give them a moment
          return said && Date.now() - saidAt > 3000 ? "message" : null;
        }, 30000);
        if (Array.isArray(links)) {
          const files = [];
          for (const [i, a] of links.entries()) {
            const href = a.href || a.closest("a")?.href;
            if (!href) continue;
            files.push(await fetchFile(href, `GSTR1_${ctx.period}_file${i + 1}.zip`));
          }
          if (files.length) return { files };
        }
        const message = said?.text ?? null;
        if (message && (ctx.notAvailable ?? []).some((s) => re(s).test(message))) return { result: "not-available", message };
        if (said?.danger) return { error: `The portal said: ${message}` };
        return { result: "requested", message };
      }
    }
    return { error: `Unknown step ${step.kind}` };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }

  // A link to the file (or to a JSON that names the file's address), fetched
  // in the page with its login. When the page may not read the answer (the
  // portal sends the file from another address), the worker tries.
  async function fetchFile(href, fallback) {
    let response;
    try {
      response = await fetch(href, { credentials: "include" });
    } catch {
      return { href, name: fallback, why: "the page could not read the file's answer" };
    }
    const type = response.headers.get("content-type") ?? "";
    const where = `${new URL(response.url).host}${response.redirected ? " after a redirect" : ""}`;
    if (!response.ok) return { href, name: fallback, why: `the portal answered ${response.status} (${where})` };
    if (/json/i.test(type)) {
      const body = await response.clone().json().catch(() => null);
      const pick = (v) => (Array.isArray(v) ? v[0] : v);
      const url = [body?.data?.url, body?.url, body?.data?.ul, body?.data].map(pick).find((v) => typeof v === "string" && /^https?:/.test(v));
      if (url) {
        try {
          const inner = await fetch(url, { credentials: "include" });
          if (inner.ok && !/text\/html/i.test(inner.headers.get("content-type") ?? "")) return { name: nameFrom(inner, fallback), type: inner.headers.get("content-type") ?? "", base64: await toBase64(await inner.blob()) };
        } catch {
          // Another site: the worker fetches it
        }
        return { href: url, name: fallback, why: "the file's address could not be read from the page" };
      }
      // A message instead of the file ({"status":0,"error":{"message":…}})
      const said = body?.error?.message ?? body?.message ?? body?.data?.msg;
      if (said) return { href, name: fallback, why: `the portal said: ${said}` };
    }
    if (/text\/html/i.test(type)) return { href, name: fallback, why: `the portal answered with a page instead of the file (${where})` };
    return { name: nameFrom(response, fallback), type, base64: await toBase64(await response.blob()) };
  }
}
