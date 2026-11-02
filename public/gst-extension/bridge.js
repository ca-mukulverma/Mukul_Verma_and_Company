// Runs on the MV Company app only (see the manifest). Tells the app the
// extension is installed, passes the app's requests to the background worker
// and the worker's answers and status changes back to the app.
// docs/GST_PORTAL_EXTENSION_PLAN.md §5.

document.documentElement.setAttribute("data-mvc-gst", chrome.runtime.getManifest().version);

const REQUESTS = ["gst-status", "gst-login", "gst-logout", "gst-show"];
const reply = (data) => window.postMessage({ source: "mvc-gst-ext", ...data }, location.origin);

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.source !== "mvc-app-gst" || !REQUESTS.includes(data.message?.type)) return;
  chrome.runtime
    .sendMessage(data.message)
    .then((answer) => reply({ type: "answer", id: data.id, answer }))
    .catch((error) => reply({ type: "answer", id: data.id, answer: { ok: false, error: String(error?.message ?? error) } }));
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "gst-status") return;
  reply({ type: "status", run: message.run });
});
