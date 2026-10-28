"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushSupported, syncPushSubscription } from "@/lib/push-client";

const DISMISS_KEY = "push-banner-dismissed-at";
const DISMISS_DAYS = 3;

// Runs on every app open: re-registers this device for phone notifications so
// the server always has its current address. On a device where notifications
// were never turned on, shows a small banner leading to the switch.
export function PushSync() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    if (Notification.permission === "granted") {
      syncPushSubscription().catch((error) => console.error("Push re-sync failed:", error));
      return;
    }
    if (Notification.permission !== "default") return;
    try {
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000) return;
    } catch {
      // Storage blocked: show the banner
    }
    setShowBanner(true);
  }, []);

  if (!showBanner) return null;

  const dismiss = () => {
    setShowBanner(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Ignore: the banner comes back next time
    }
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      <BellRing className="h-4 w-4 shrink-0 text-primary" />
      <p className="flex-1">Notifications are off on this device. Turn them on so you don&apos;t miss tasks and bills.</p>
      <Button asChild size="sm">
        <Link href="/dashboard/settings/notifications">Turn on</Link>
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={dismiss} aria-label="Hide">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
