// Runs on the MV Company app: tells the app the extension is installed,
// passes its "send all" and "stop" requests on, and reports progress back.

document.documentElement.setAttribute("data-mvc-whatsapp", "1");

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "mvc-app") return;
  if (event.data.type === "send-all") chrome.runtime.sendMessage({ type: "start", messages: event.data.messages });
  if (event.data.type === "stop") chrome.runtime.sendMessage({ type: "stop" });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.job?.newValue) window.postMessage({ source: "mvc-whatsapp-ext", type: "progress", job: changes.job.newValue }, location.origin);
});
