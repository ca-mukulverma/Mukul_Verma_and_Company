// Starts and stops a sending job. The job is kept in storage; the WhatsApp Web
// page (whatsapp.js) sends each message and moves on to the next one.

const sendUrl = (m) => `https://web.whatsapp.com/send?phone=${m.phone}&text=${encodeURIComponent(m.text)}`;

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    if (message.type === "start") {
      // A PDF to attach ({ name, type, data: base64 }) is kept apart from the
      // job, which the app is sent on every change
      const files = {};
      const messages = message.messages.map(({ file, ...m }) => {
        if (file) files[m.key] = file;
        return { ...m, hasFile: !!file, status: "waiting" };
      });
      if (!messages.length) return;
      await chrome.storage.local.set({ files });
      messages[0].status = "sending";
      const job = { id: Date.now(), messages, stopped: false, done: false, navigatedAt: Date.now(), note: null };
      await chrome.storage.local.set({ job });
      const [tab] = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
      if (tab) {
        await chrome.tabs.update(tab.id, { url: sendUrl(messages[0]), active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: sendUrl(messages[0]) });
      }
    } else if (message.type === "stop") {
      const { job } = await chrome.storage.local.get("job");
      if (job) await chrome.storage.local.set({ job: { ...job, stopped: true, done: true, note: "Stopped" } });
    }
  })().finally(() => reply({ ok: true }));
  return true;
});
