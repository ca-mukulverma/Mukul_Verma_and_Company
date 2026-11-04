// Runs one step of a download in the GST portal tab (injected by the
// background worker with chrome.scripting into the page's own world, so it
// can catch the files the page builds in the browser). Each call is one
// step: pages change between steps, and the worker waits for them. Nothing
// here reads or types a captcha or OTP, and buttons that file, submit,
// prepare, reset or pay are never clicked. docs/GST_PORTAL_EXTENSION_PLAN.md §5.

// Answers: { next: true } · { file: {...} } · { files: [...] } · { links: [] }
// · { result: "not-filed" | "not-available" | "requested" | "pending" |
// "session-expired", message } · { error }
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
      if (el && !blocked(el)) el.click();
    }
  };
  const expired = () => first(ctx.sessionExpired);
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
  const press = (el) => {
    if (blocked(el)) throw new Error(`Refused to click "${text(el)}": it may file or change the return`);
    el.scrollIntoView({ block: "center" });
    el.click();
  };

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
      const state = { armed: false, got };
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
        press(search);
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
        const el = await waitFor(() => find(root, step.target), 20000);
        if (!el) {
          const why = first(ctx.notAvailable);
          if (why) return { result: "not-available", message: why.toLowerCase() };
          return { error: `"${step.target.text ?? step.target.css}" wasn't found on the portal page (${location.pathname})` };
        }
        const before = counts(ctx.notAvailable);
        press(el);
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
        const el = await waitFor(() => find(root, step.target), 20000);
        if (!el) {
          const why = first(ctx.notAvailable);
          if (why) return { result: "not-available", message: why.toLowerCase() };
          return { error: `"${step.target.text ?? step.target.css}" wasn't found on the portal page (${location.pathname})` };
        }
        const capture = arm();
        const before = counts(ctx.notAvailable);
        press(el);
        let why = null;
        const got = await waitFor(() => {
          why = newMessage(ctx.notAvailable, before) ?? (expired() ? "session" : null);
          return capture.got[0] ?? why;
        }, 120000);
        capture.armed = false;
        if (!got) return { error: "No file came from the portal within 2 minutes" };
        if (typeof got === "string") return got === "session" ? { result: "session-expired", message: expired() } : { result: "not-available", message: got.toLowerCase() };
        const blob = got.blob ?? (await (await fetch(got.href)).blob());
        return { file: { name: got.name, type: blob.type, base64: await toBase64(blob) } };
      }

      case "links": {
        // Wait a moment for the page; no links is a normal answer
        const links = (await waitFor(() => {
          const found = findAll(document, step.target);
          return found.length ? found : first(ctx.jsonPending) ? [] : null;
        }, 8000)) ?? [];
        const files = [];
        for (const [i, a] of links.entries()) {
          const href = a.href || a.closest("a")?.href;
          if (!href) continue;
          files.push(await fetchFile(href, `${ctx.returnLabel}_${ctx.period}_file${i + 1}.zip`));
        }
        return files.length ? { files } : { links: [] };
      }

      case "generate": {
        const pending = first(ctx.jsonPending);
        if (pending) return { result: "pending", message: pending };
        const el = await waitFor(() => find(document, step.target), 15000);
        if (!el) return { error: `"${step.target.text}" wasn't found on the portal page` };
        const before = counts([...(ctx.jsonPending ?? []), ...(ctx.notAvailable ?? [])]);
        press(el);
        let said = null;
        await waitFor(() => (said = newMessage([...(ctx.jsonPending ?? []), ...(ctx.notAvailable ?? [])], before)), 6000);
        if (said && (ctx.notAvailable ?? []).some((s) => re(s).test(said))) return { result: "not-available", message: said.toLowerCase() };
        return { result: "requested", message: said };
      }
    }
    return { error: `Unknown step ${step.kind}` };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }

  // A link to the file (or to a JSON that names the file's address), fetched
  // in the page with its login; addresses the page may not read (another
  // site) are handed back for the worker to fetch
  async function fetchFile(href, fallback) {
    try {
      const response = await fetch(href, { credentials: "include" });
      if (!response.ok) return { href, error: `HTTP ${response.status}` };
      const type = response.headers.get("content-type") ?? "";
      if (/json/i.test(type)) {
        const body = await response.clone().json().catch(() => null);
        const url = body?.data?.url ?? body?.url ?? (typeof body?.data === "string" && /^https?:/.test(body.data) ? body.data : null);
        if (url) {
          try {
            const inner = await fetch(url, { credentials: "include" });
            if (inner.ok) return { name: nameFrom(inner, fallback), type: inner.headers.get("content-type") ?? "", base64: await toBase64(await inner.blob()) };
          } catch {
            // Another site: the worker fetches it
          }
          return { href: url, name: fallback };
        }
      }
      if (/text\/html/i.test(type)) return { href, error: "The portal answered with a page instead of the file" };
      return { name: nameFrom(response, fallback), type, base64: await toBase64(await response.blob()) };
    } catch {
      return { href, name: fallback };
    }
  }
}
