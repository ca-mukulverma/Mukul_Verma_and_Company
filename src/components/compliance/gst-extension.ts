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
  // The file being fetched now ("GSTR-3B PDF Sep 2026")
  doing?: string | null;
  autoLogout?: boolean;
  at: number;
}

// What the portal gave for one file
export type FetchResult = "file" | "downloaded" | "not-filed" | "not-available" | "requested" | "pending" | "session-expired" | "access-denied" | "not-taught" | "error";

export interface FetchedFile {
  name: string;
  type: string;
  base64: string;
}

// The extension that can fetch files (older ones only log in; 0.3.0 could
// not collect GSTR-1 JSON, 0.3.1 missed GSTR-2B JSON handed to Chrome as a
// normal download, 0.3.2 could act on the page before it reloaded and had
// no retry, 0.3.3 failed on a NIL GSTR-1's PDF, 0.3.4 opened the Returns
// Dashboard from outside the portal, which the portal refuses: access denied;
// 0.3.5 could start before the welcome page had loaded)
export const FETCH_VERSION = "0.3.6";
// "0.3.10" > "0.3.9": every part compared as a number
export function compareVersions(a: string, b: string) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function canFetch(version: string | null | undefined) {
  return !!version && compareVersions(version, FETCH_VERSION) >= 0;
}

// The version this app ships (public/gst-extension/manifest.json), to offer
// an update when the installed one is older; null if it can't be read
export async function latestGstExtension(): Promise<string | null> {
  try {
    const response = await fetch("/gst-extension/manifest.json", { cache: "no-store" });
    const manifest = (await response.json()) as { version?: string };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

export const ENDED: PortalRunStatus[] = ["logged-out", "closed", "timed-out", "failed"];
export const isOpen = (run: PortalRun | null): run is PortalRun => !!run && !ENDED.includes(run.status);

interface Answer {
  ok: boolean;
  error?: string;
  run?: PortalRun | null;
  version?: string;
  result?: FetchResult;
  files?: FetchedFile[];
  message?: string | null;
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
  // Files will be fetched: the extension logs out by itself if the run goes quiet
  autoLogout: boolean;
}) => ask({ type: "gst-login", ...args });

// One file from the portal (a few seconds to two minutes)
export const portalFetch = (runId: string, file: { kind: string; month: string; label: string }) => ask({ type: "gst-fetch", runId, file }, 4 * 60_000);

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
  await downloadExtensionZip("gst-extension", ["manifest.json", "background.js", "bridge.js", "portal.js"], { root: "mvc-gst", fileName: "mvc-gst-extension.zip" }, (name, text) => {
    // Match patterns can't hold a port; the worker checks the full origin
    if (name === "manifest.json") return text.replace("__APP_MATCH__", `${protocol}//${hostname}/*`);
    if (name === "background.js") return text.replace("__APP_ORIGIN__", origin);
    return text;
  });
}
