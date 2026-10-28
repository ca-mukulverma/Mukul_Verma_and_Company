"use client";

import { useEffect, useRef } from "react";

// Keyboard shortcuts for the whole app:
//   Ctrl+K (⌘K) or /   search
//   g then a letter    open a page (see nav-config "shortcut")
//   n                  new task
//   ?                  list of shortcuts
// Ignored while typing in a field, so they never get in the way of input.

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function useKeyboardShortcuts(handlers: {
  onSearch: () => void;
  onHelp: () => void;
  onGo: (key: string) => void;
  onNewTask?: () => void;
}) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let waitingForGo = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const h = handlersRef.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        h.onSearch();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      // A dialog is open: leave the keys to it
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;

      if (waitingForGo && Date.now() - waitingForGo < 1500) {
        waitingForGo = 0;
        event.preventDefault();
        h.onGo(event.key.toLowerCase());
        return;
      }
      waitingForGo = 0;

      if (event.key === "/") {
        event.preventDefault();
        h.onSearch();
      } else if (event.key === "?") {
        event.preventDefault();
        h.onHelp();
      } else if (event.key === "g") {
        waitingForGo = Date.now();
      } else if (event.key === "n" && h.onNewTask) {
        event.preventDefault();
        h.onNewTask();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
