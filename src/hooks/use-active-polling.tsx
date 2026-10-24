"use client";

import { useEffect, useRef } from "react";

/**
 * Polling that pauses when nobody is using the app.
 *
 * Why: the Neon database suspends (and stops billing compute) only after
 * 5 minutes without a query. Timers that keep firing from a tab left open
 * overnight, or in the background, kept the database awake 24x7.
 *
 * A poll runs only while the tab is visible AND the user has interacted
 * (mouse, keyboard, touch, scroll) within the last IDLE_AFTER_MS. When the
 * user comes back after being idle or the tab becomes visible again, every
 * paused poll runs once immediately so data is fresh.
 */

export const IDLE_AFTER_MS = 10 * 60 * 1000; // 10 minutes

let lastActivityAt = Date.now();
let listenersAttached = false;
const resumeSubscribers = new Set<() => void>();

function notifyResume() {
  resumeSubscribers.forEach((fn) => {
    try {
      fn();
    } catch (error) {
      console.error("Error resuming poll:", error);
    }
  });
}

function attachActivityListeners() {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;

  const onActivity = () => {
    const now = Date.now();
    const wasIdle = now - lastActivityAt >= IDLE_AFTER_MS;
    lastActivityAt = now;
    if (wasIdle) notifyResume();
  };

  const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];
  events.forEach((evt) =>
    window.addEventListener(evt, onActivity, { passive: true, capture: true })
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      lastActivityAt = Date.now();
      notifyResume();
    }
  });
}

/** True when the tab is visible and the user was active recently. */
export function isUserActive(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.visibilityState === "visible" &&
    Date.now() - lastActivityAt < IDLE_AFTER_MS
  );
}

/**
 * Run `callback` every `intervalMs` while the user is active.
 * Pass `enabled = false` to switch polling off entirely.
 */
export function useActivePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean = true
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    attachActivityListeners();

    // Whether a tick was skipped while the user was away
    let missedTick = false;

    const interval = setInterval(() => {
      if (isUserActive()) {
        missedTick = false;
        void callbackRef.current();
      } else {
        missedTick = true;
      }
    }, intervalMs);

    const onResume = () => {
      if (missedTick) {
        missedTick = false;
        void callbackRef.current();
      }
    };
    resumeSubscribers.add(onResume);

    return () => {
      clearInterval(interval);
      resumeSubscribers.delete(onResume);
    };
  }, [intervalMs, enabled]);
}
