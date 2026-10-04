"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, BellRing, Share, PlusSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type State =
  | "loading"
  | "android-app" // inside the MVC Tasks Android app – it has its own notifications
  | "ios-install" // iPhone in Safari: must "Add to Home Screen" first
  | "unsupported"
  | "not-configured" // server keys not set yet
  | "denied"
  | "off"
  | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

async function getRegistration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export function usePushState() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      if (typeof window === "undefined") return;
      if (/MVCTasksApp/.test(navigator.userAgent)) return setState("android-app");
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (isIOS() && !isStandalone()) return setState("ios-install");
      if (!supported) return setState("unsupported");

      const res = await fetch("/api/push", { cache: "no-store" });
      if (!res.ok) return setState("unsupported");
      const info = await res.json();
      if (!info.enabled) return setState("not-configured");
      if (Notification.permission === "denied") return setState("denied");

      const reg = await getRegistration();
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    } catch (e) {
      console.error("[push] status", e);
      setState("unsupported");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      // Must be called directly from the button tap (required on iPhone)
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        toast.error("Notifications were not allowed");
        return;
      }
      const info = await (await fetch("/api/push", { cache: "no-store" })).json();
      if (!info.publicKey) {
        setState("not-configured");
        return;
      }
      const reg = await getRegistration();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(info.publicKey),
        });
      }
      const save = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!save.ok) throw new Error("save failed");
      setState("on");
      toast.success("Notifications turned on for this device");
    } catch (e) {
      console.error("[push] enable", e);
      toast.error("Could not turn on notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await getRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
      toast.success("Notifications turned off for this device");
    } catch (e) {
      console.error("[push] disable", e);
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      if (!r.ok) throw new Error();
      toast.success("Test sent – it should arrive in a few seconds");
    } catch {
      toast.error("Could not send test notification");
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, enable, disable, test };
}

function IosInstallSteps() {
  return (
    <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
      <li>
        Open this website in <b>Safari</b>.
      </li>
      <li>
        Tap the <Share className="inline h-4 w-4 align-text-bottom" /> <b>Share</b> button.
      </li>
      <li>
        Tap <PlusSquare className="inline h-4 w-4 align-text-bottom" /> <b>Add to Home Screen</b>, then <b>Add</b>.
      </li>
      <li>
        Open <b>MVC Tasks</b> from your home screen, log in, and come back here to turn on notifications.
      </li>
    </ol>
  );
}

/** Full card – used on Settings → Notifications */
export function PushSettingsCard() {
  const { state, busy, enable, disable, test } = usePushState();
  if (state === "android-app") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-5 w-5" /> Phone notifications
        </CardTitle>
        <CardDescription>
          Get a notification on this phone or computer for new tasks, comments and updates – even when the app is
          closed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === "loading" && <p className="text-sm text-muted-foreground">Checking…</p>}
        {state === "ios-install" && (
          <>
            <p className="text-sm">On iPhone, first add MVC Tasks to your home screen:</p>
            <IosInstallSteps />
          </>
        )}
        {state === "unsupported" && (
          <p className="text-sm text-muted-foreground">
            This browser does not support notifications. On iPhone use Safari (iOS 16.4 or newer); on Android use
            Chrome or the MVC Tasks app.
          </p>
        )}
        {state === "not-configured" && (
          <p className="text-sm text-muted-foreground">Phone notifications are not set up on the server yet.</p>
        )}
        {state === "denied" && (
          <p className="text-sm text-muted-foreground">
            Notifications are blocked for this site. iPhone: Settings → Notifications → MVC Tasks → Allow. Chrome:
            tap the lock icon in the address bar → Permissions → Notifications → Allow.
          </p>
        )}
        {state === "off" && (
          <Button onClick={enable} disabled={busy}>
            <Bell className="mr-2 h-4 w-4" /> Turn on notifications for this device
          </Button>
        )}
        {state === "on" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-green-600 dark:text-green-400">
              ✓ Notifications are on for this device
            </span>
            <Button variant="outline" size="sm" onClick={test} disabled={busy}>
              Send test
            </Button>
            <Button variant="ghost" size="sm" onClick={disable} disabled={busy}>
              <BellOff className="mr-1 h-4 w-4" /> Turn off
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Small dismissible banner – shown on the dashboard until notifications are on */
export function PushBanner() {
  const { state, busy, enable } = usePushState();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      const until = Number(localStorage.getItem("mvc-push-banner-hidden-until") || 0);
      setHidden(Date.now() < until);
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden || !(state === "off" || state === "ios-install")) return null;

  const dismiss = () => {
    try {
      // hide for 7 days
      localStorage.setItem("mvc-push-banner-hidden-until", String(Date.now() + 7 * 24 * 3600 * 1000));
    } catch {}
    setHidden(true);
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
      <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="flex-1 space-y-2">
        {state === "ios-install" ? (
          <>
            <p className="font-medium">Get task notifications on your iPhone</p>
            <IosInstallSteps />
          </>
        ) : (
          <>
            <p className="font-medium">Get a notification when you are assigned a task or someone comments.</p>
            <Button size="sm" onClick={enable} disabled={busy}>
              Turn on notifications
            </Button>
          </>
        )}
      </div>
      <button onClick={dismiss} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
