// Runs on WhatsApp Web. When the app's job opened this chat, waits for the
// message to appear, presses Send, records the result, pauses 8–15 seconds
// and opens the next chat. At most 150 messages a day are sent this way.

const DAILY_LIMIT = 150;
const startUrl = location.href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sendUrl = (m) => `https://web.whatsapp.com/send?phone=${m.phone}&text=${encodeURIComponent(m.text)}`;
const today = () => new Date().toISOString().slice(0, 10);

async function save(job) {
  await chrome.storage.local.set({ job });
}

function sendButton() {
  const icon = document.querySelector('footer [data-icon="send"], footer [data-icon="wds-ic-send-filled"], [data-icon="send"], [data-icon="wds-ic-send-filled"]');
  return icon?.closest("button") ?? icon?.closest('[role="button"]') ?? document.querySelector('footer button[aria-label="Send"]');
}
const composeText = () => document.querySelector('footer [contenteditable="true"]')?.textContent?.trim() ?? "";
const invalidNumber = () => /phone number shared via url is invalid|isn.t on whatsapp|not on whatsapp/i.test(document.body?.innerText ?? "");

// "sent" or an error message
async function sendCurrent() {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    await sleep(1000);
    if (invalidNumber()) return "This number is not on WhatsApp";
    const button = sendButton();
    if (button && composeText()) {
      button.click();
      for (let i = 0; i < 10; i++) {
        await sleep(1000);
        if (!composeText()) return "sent";
      }
      return "Send was pressed but the message stayed in the box";
    }
  }
  return "The chat didn't open (is WhatsApp Web logged in?)";
}

(async () => {
  const { job } = await chrome.storage.local.get("job");
  if (!job || job.done || job.stopped) return;
  const index = job.messages.findIndex((m) => m.status === "sending");
  if (index < 0) return;
  const current = job.messages[index];
  // Only the chat this job opened (WhatsApp changes the address soon after loading)
  if (!startUrl.includes(`phone=${current.phone}`) && Date.now() - job.navigatedAt > 30000) return;

  if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  const result = await sendCurrent();

  const { job: latest } = await chrome.storage.local.get("job");
  if (!latest || latest.id !== job.id) return;
  const { sentToday = { date: today(), count: 0 } } = await chrome.storage.local.get("sentToday");
  const count = (sentToday.date === today() ? sentToday.count : 0) + (result === "sent" ? 1 : 0);
  await chrome.storage.local.set({ sentToday: { date: today(), count } });
  latest.messages[index] = { ...current, status: result === "sent" ? "sent" : "failed", error: result === "sent" ? null : result };

  const next = latest.messages.findIndex((m) => m.status === "waiting");
  if (latest.stopped || next < 0) {
    await save({ ...latest, done: true });
    return;
  }
  if (count >= DAILY_LIMIT) {
    await save({ ...latest, done: true, note: `Stopped at ${DAILY_LIMIT} messages today, to keep the number safe. Send the rest tomorrow.` });
    return;
  }
  latest.messages[next].status = "sending";
  await save(latest);
  await sleep(8000 + Math.random() * 7000);
  const { job: again } = await chrome.storage.local.get("job");
  if (!again || again.id !== job.id || again.stopped) return;
  await save({ ...again, navigatedAt: Date.now() });
  location.href = sendUrl(latest.messages[next]);
})();
