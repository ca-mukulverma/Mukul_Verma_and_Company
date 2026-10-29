"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BellRing, Share, PlusSquare, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { syncPushSubscription, urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from "@/lib/push-client";

type PushState =
  | "loading"
  | "unsupported"
  | "ios-needs-install" // iPhone/iPad in Safari: must Add to Home Screen first
  | "denied"
  | "disabled"
  | "enabled";

function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as Mac
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function PushNotificationSettings() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

    if (!supported) {
      setState(isIOS() && !isStandalone() ? "ios-needs-install" : "unsupported");
      return;
    }
    if (isIOS() && !isStandalone()) {
      setState("ios-needs-install");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    // Permission given: make sure the server has this device's current address
    if (Notification.permission === "granted" && (await syncPushSubscription().catch(() => false))) {
      setState("enabled");
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.getSubscription();
    setState(subscription ? "enabled" : "disabled");
  }, []);

  useEffect(() => {
    refresh().catch(() => setState("unsupported"));
  }, [refresh]);

  const enable = async () => {
    if (!VAPID_PUBLIC_KEY) {
      toast.error("Push notifications are not configured on the server yet");
      return;
    }
    setBusy(true);
    try {
      // Must be called directly from the button tap on iOS
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "disabled");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      await axios.post("/api/push/subscribe", subscription.toJSON());
      setState("enabled");
      toast.success("Notifications enabled on this device");
    } catch (error) {
      console.error("Failed to enable push notifications:", error);
      toast.error("Could not enable notifications on this device");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      await axios.post("/api/push/test");
      toast.success("Test notification sent");
    } catch {
      toast.error("Failed to send test notification");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" />
          Phone notifications
        </CardTitle>
        <CardDescription>
          Get task, billing, compliance and comment alerts on your iPhone or Android lock screen, even when the app
          is closed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === "loading" && (
          <p className="text-sm text-muted-foreground">Checking this device…</p>
        )}

        {state === "ios-needs-install" && (
          <div className="space-y-3 text-sm">
            <p>To get notifications on iPhone, first install the app on your Home Screen:</p>
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                Open this site in <strong>Safari</strong>.
              </li>
              <li className="flex flex-wrap items-center gap-1">
                Tap the <Share className="inline h-4 w-4" /> <strong>Share</strong> button.
              </li>
              <li className="flex flex-wrap items-center gap-1">
                Choose <PlusSquare className="inline h-4 w-4" /> <strong>Add to Home Screen</strong>,
                then tap <strong>Add</strong>.
              </li>
              <li>
                Open <strong>MV Company</strong> from your Home Screen, sign in, and come back to
                this page to turn notifications on.
              </li>
            </ol>
            <p className="text-muted-foreground">Requires iOS 16.4 or later.</p>
          </div>
        )}

        {state === "unsupported" && (
          <p className="text-sm text-muted-foreground">
            This browser does not support push notifications.
          </p>
        )}

        {state === "denied" && (
          <p className="text-sm text-muted-foreground">
            Notifications are blocked for this app. On iPhone go to Settings → Notifications → MV
            Company and allow notifications, then reload this page.
          </p>
        )}

        {state === "disabled" && (
          <Button onClick={enable} disabled={busy}>
            <BellRing className="mr-2 h-4 w-4" />
            Enable notifications on this device
          </Button>
        )}

        {/* No "turn off": every staff member gets the alerts for their work */}
        {state === "enabled" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Notifications are on for this device.</span>
            <Button variant="outline" onClick={sendTest} disabled={busy}>
              <BellRing className="mr-2 h-4 w-4" />
              Send test notification
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
