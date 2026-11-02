import type { PortalSettings } from "@/lib/gst-portal-settings";
import { downloadExtensionZip } from "./extension-zip";

// The app's side of the GST portal extension (public/gst-extension,
// docs/GST_PORTAL_EXTENSION_PLAN.md §5): the app page decides, the extension
// does. Messages go through the extension's bridge on this page with
// window.postMessage, tagged "mvc-app-gst" one way and "mvc-gst-ext" back.

export type PortalRunStatus = "waiting-login" | "logged-in" | "logging-out" | "logged-out" | "closed" | "timed-out" | "failed";

export interface PortalRun {
  runId: string;
  clientId: string;
  clientName: string;
  status: PortalRunStatus;
  note: string | null;
  at: number;
}

export const ENDED: PortalRunStatus[] = ["logged-out", "closed", "timed-out", "failed"];
export const isOpen = (run: PortalRun | null): run is PortalRun => !!run && !ENDED.includes(run.status);

interface Answer {
  ok: boolean;
  error?: string;
  run?: PortalRun | null;
  version?: string;
}

// The installed version, or null
export const gstExtensionVersion = () => document.documentElement.getAttribute("data-mvc-gst");

let counter = 0;

function ask(message: Record<string, unknown>, timeoutMs = 15_000): Promise<Answer> {
  const id = `${Date.now()}-${++counter}`;
  return new Promise((resolve) => {
    const done = (answer: Answer) => {
      window.removeEventListener("message", listener);
      clearTimeout(timer);
      resolve(answer);
    };
    const listener = (event: MessageEvent) => {
      if (event.source === window && event.origin === window.location.origin && event.data?.source === "mvc-gst-ext" && event.data.type === "answer" && event.data.id === id) {
        done(event.data.answer ?? { ok: false, error: "No answer from the extension" });
      }
    };
    const timer = setTimeout(() => done({ ok: false, error: "The GST extension didn't answer. Reload the page; if it still fails, reinstall the extension." }), timeoutMs);
    window.addEventListener("message", listener);
    window.postMessage({ source: "mvc-app-gst", id, message }, window.location.origin);
  });
}

export const portalStatus = () => ask({ type: "gst-status" });

export const portalLogin = (args: {
  runId: string;
  clientId: string;
  clientName: string;
  settings: PortalSettings;
  login: { username: string; password: string } | null;
}) => ask({ type: "gst-login", ...args });

export const portalLogout = (runId: string) => ask({ type: "gst-logout", runId });
export const showPortal = (runId: string) => ask({ type: "gst-show", runId });

export function onPortalStatus(handler: (run: PortalRun) => void) {
  const listener = (event: MessageEvent) => {
    if (event.source === window && event.origin === window.location.origin && event.data?.source === "mvc-gst-ext" && event.data.type === "status" && event.data.run) {
      handler(event.data.run);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

// The extension as a ZIP to load unpacked, set up for this app's address
export async function downloadGstExtension() {
  const { origin, protocol, hostname } = window.location;
  await downloadExtensionZip("gst-extension", ["manifest.json", "background.js", "bridge.js"], { root: "mvc-gst", fileName: "mvc-gst-extension.zip" }, (name, text) => {
    // Match patterns can't hold a port; the worker checks the full origin
    if (name === "manifest.json") return text.replace("__APP_MATCH__", `${protocol}//${hostname}/*`);
    if (name === "background.js") return text.replace("__APP_ORIGIN__", origin);
    return text;
  });
}
