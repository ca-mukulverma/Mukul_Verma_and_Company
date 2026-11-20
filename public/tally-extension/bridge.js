// Runs on the MV Company app only (see the manifest). Tells the app the
// Tally extension is installed and passes the app's requests to the
// background worker, and its answers back. docs/TALLY_DIRECT_IMPORT.md.

document.documentElement.setAttribute("data-mvc-tally", chrome.runtime.getManifest().version);

const REQUESTS = ["tally-status", "tally-check", "tally-import", "tally-sync-connect", "tally-sync-disconnect", "tally-sync-info", "tally-sync-now"];
const reply = (data) => window.postMessage({ source: "mvc-tally-ext", ...data }, location.origin);

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.source !== "mvc-app-tally" || !REQUESTS.includes(data.message?.type)) return;
  const failed = (error) => {
    const why = String(error?.message ?? error);
    // This page's copy of the extension was cut off by an update or reload
    const stale = /context invalidated|receiving end does not exist|could not establish connection/i.test(why);
    reply({ type: "answer", id: data.id, answer: { ok: false, error: stale ? `The Tally extension was updated or reloaded since this page opened: reload this page (${why})` : why } });
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
