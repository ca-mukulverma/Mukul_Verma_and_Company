import { downloadExtensionZip } from "./extension-zip";

// How reminder chats are opened. "web": WhatsApp Web in its own window beside
// the app, reused for every chat; "desktop": the WhatsApp app on the computer;
// "phone": wa.me, which opens the WhatsApp app on a phone.
export type ChatMode = "web" | "desktop" | "phone";

const MODE_KEY = "whatsapp-chat-mode";

export function savedChatMode(): ChatMode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "web" || saved === "desktop" || saved === "phone") return saved;
  } catch {
    // Storage blocked: fall back to the device's default
  }
  return /Android|iPhone|iPad/i.test(navigator.userAgent) ? "phone" : "web";
}

export function saveChatMode(mode: ChatMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Not remembered; nothing else depends on it
  }
}

export function openChat(mode: ChatMode, phone: string, text: string) {
  const query = `phone=${phone}&text=${encodeURIComponent(text)}`;
  if (mode === "desktop") {
    window.location.href = `whatsapp://send?${query}`;
  } else if (mode === "web") {
    // Half the screen on the right, so the app stays in view on the left
    const width = Math.round(window.screen.availWidth / 2);
    window.open(`https://web.whatsapp.com/send?${query}`, "whatsapp-web", `popup,width=${width},height=${window.screen.availHeight},left=${width},top=0`);
  } else {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "whatsapp");
  }
}

// The "send all" browser extension (public/whatsapp-extension)
export interface ExtensionJob {
  messages: { key: string; status: "waiting" | "sending" | "sent" | "failed"; error?: string | null }[];
  stopped: boolean;
  done: boolean;
  note: string | null;
}

export const extensionInstalled = () => document.documentElement.hasAttribute("data-mvc-whatsapp");

export function sendAllWithExtension(messages: { key: string; phone: string; text: string }[]) {
  window.postMessage({ source: "mvc-app", type: "send-all", messages }, window.location.origin);
}

export function stopExtension() {
  window.postMessage({ source: "mvc-app", type: "stop" }, window.location.origin);
}

export function onExtensionProgress(handler: (job: ExtensionJob) => void) {
  const listener = (event: MessageEvent) => {
    if (event.source === window && event.data?.source === "mvc-whatsapp-ext" && event.data.type === "progress") handler(event.data.job);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

// The extension as a ZIP, set up for this app's address
export async function downloadExtension() {
  await downloadExtensionZip("whatsapp-extension", ["manifest.json", "background.js", "bridge.js", "whatsapp.js"], { root: "mvc-whatsapp", fileName: "mvc-whatsapp-extension.zip" }, (name, text) =>
    name === "manifest.json" ? text.replace("__APP_ORIGIN__", window.location.origin) : text
  );
}
