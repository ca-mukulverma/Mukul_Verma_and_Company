// Runs on the MV Company app only (see the manifest). Tells the app the
// extension is installed, passes the app's requests to the background worker
// and the worker's answers and status changes back to the app.
// docs/GST_PORTAL_EXTENSION_PLAN.md §5.

document.documentElement.setAttribute("data-mvc-gst", chrome.runtime.getManifest().version);
// This file's version: must equal the manifest's (see background.js)
document.documentElement.setAttribute("data-mvc-gst-bridge", "0.4.4");

const REQUESTS = ["gst-status", "gst-login", "gst-logout", "gst-show", "gst-fetch", "gst-diag"];
const reply = (data) => window.postMessage({ source: "mvc-gst-ext", ...data }, location.origin);

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.source !== "mvc-app-gst" || !REQUESTS.includes(data.message?.type)) return;
  const failed = (error) => {
    const why = String(error?.message ?? error);
    // This page's copy of the extension was cut off by an update or reload
    const stale = /context invalidated|receiving end does not exist|could not establish connection/i.test(why);
    reply({ type: "answer", id: data.id, answer: { ok: false, error: stale ? `The GST extension was updated or reloaded since this page opened: reload this page (${why})` : why } });
  };
  try {
    chrome.runtime
      .sendMessage(data.message)
      .then((answer) => reply({ type: "answer", id: data.id, answer }))
      .catch(failed);
  } catch (error) {
    failed(error);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "gst-status") return;
  reply({ type: "status", run: message.run });
});
