// Runs on GST portal pages (see the manifest), in the extension's own world.
// Passes the download steps' requests from the page (portal.js: "click here
// for real", "ask the person to click") to the background worker and its
// answers back. The worker only acts for the portal tab of the current run,
// and only with that run's token. docs/GST_PORTAL_EXTENSION_PLAN.md §5.

window.addEventListener("message", (event) => {
  const data = event.data;
  if (event.source !== window || data?.source !== "mvc-portal-page" || typeof data.id !== "string") return;
  const reply = (answer) => window.postMessage({ source: "mvc-portal-ext", id: data.id, ...answer }, location.origin);
  chrome.runtime
    .sendMessage({ type: "gst-portal-page", request: data.type, token: data.token, x: data.x, y: data.y, label: data.label })
    .then((answer) => reply(answer ?? { ok: false }))
    .catch(() => reply({ ok: false }));
});
