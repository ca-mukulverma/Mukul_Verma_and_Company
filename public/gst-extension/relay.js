// Runs on GST portal pages (see the manifest), in the extension's own world.
// Passes the download steps' requests from the page (portal.js: "click here
// for real", "ask the person to click", diagnostics notes) to the background
// worker and its answers back. The worker only acts for the portal tab of the
// current run, and only with that run's token. docs/GST_PORTAL_EXTENSION_PLAN.md §5.

window.addEventListener("message", (event) => {
  const data = event.data;
  if (event.source !== window || data?.source !== "mvc-portal-page" || typeof data.id !== "string") return;
  const reply = (answer) => window.postMessage({ source: "mvc-portal-ext", id: data.id, ...answer }, location.origin);
  chrome.runtime
    .sendMessage({ type: "gst-portal-page", request: data.type, token: data.token, x: data.x, y: data.y, label: data.label, note: data.note })
    .then((answer) => reply(answer ?? { ok: false }))
    .catch(() => reply({ ok: false }));
});

// This file's version: must equal the manifest's (see background.js)
const RELAY_CODE = "0.4.5";

// ─── Diagnostics ────────────────────────────────────────────────────────────
// What happens in the portal tab, for the app's "Save diagnostics": each page
// as it loads (the referrer Chrome gave it and how it was reached), each click
// (a person's or Chrome's real one is "trusted", a script's is not) and each
// page change the page itself starts. Only button texts and addresses (without
// their query), never what is typed. The worker keeps them only for the
// portal tab of a run in progress.

const diag = (what, data) => {
  try {
    chrome.runtime.sendMessage({ type: "gst-portal-page", request: "diag", note: JSON.stringify({ what, ...data }).slice(0, 3000) }).catch(() => undefined);
  } catch {
    // The extension was reloaded: this page's copy is cut off
  }
};
const address = (u) => {
  try {
    const x = new URL(u, location.href);
    if (!/^https?:$/.test(x.protocol)) return String(u).slice(0, 60);
    return `${x.origin}${x.pathname}${x.hash}`.slice(0, 200);
  } catch {
    return String(u ?? "").slice(0, 200);
  }
};
const label = (el) => (el?.innerText ?? el?.value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

document.addEventListener("DOMContentLoaded", () => {
  const nav = performance.getEntriesByType?.("navigation")?.[0];
  diag("page loaded", { relay: RELAY_CODE, page: address(location.href), referrer: document.referrer ? address(document.referrer) : "(none)", how: nav?.type ?? "?" });
});

document.addEventListener(
  "click",
  (e) => {
    const el = e.target?.closest?.("a, button, input, [role=button], [ng-click], [onclick]") ?? e.target;
    diag("click", {
      trusted: e.isTrusted,
      tag: el?.tagName?.toLowerCase(),
      text: label(el),
      href: el?.getAttribute?.("href") ? address(el.getAttribute("href")) : undefined,
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      page: address(location.href),
    });
  },
  true
);

// The Navigation API reports page changes the page starts (links, scripts,
// forms, Back); one the browser starts itself (an address typed, or opened by
// an extension) may not show here
window.navigation?.addEventListener("navigate", (e) => {
  diag("page asks to go", {
    to: address(e.destination?.url),
    kind: e.navigationType,
    userInitiated: e.userInitiated,
    sameDocument: e.destination?.sameDocument,
    page: address(location.href),
  });
});
