"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/language-provider";
import { SHOW_ME_EVENT, type Announcement } from "@/lib/whats-new";

type ShowMe = NonNullable<Announcement["showMe"]>;

const FIND_FOR_MS = 10_000;

// "Show me": opens the page, dims the rest and rings the real button with a
// "Tap here" note. Clicks go through, so the person can tap the button
// itself; any click closes it.
export function Spotlight() {
  const router = useRouter();
  const pathname = usePathname();
  const { language } = useLanguage();
  const [request, setRequest] = useState<(ShowMe & { at: number }) | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const start = (event: Event) => {
      const detail = (event as CustomEvent<ShowMe>).detail;
      setRect(null);
      setRequest({ ...detail, at: Date.now() });
    };
    window.addEventListener(SHOW_ME_EVENT, start);
    return () => window.removeEventListener(SHOW_ME_EVENT, start);
  }, []);

  // Go to the page first
  useEffect(() => {
    if (request && pathname !== request.href) router.push(request.href);
  }, [request, pathname, router]);

  const close = useCallback(() => {
    setRequest(null);
    setRect(null);
  }, []);

  // Wait for the button to appear, then follow it on scroll and resize
  useEffect(() => {
    if (!request || pathname !== request.href) return;
    let element: Element | null = null;
    // Only when it moved, so this doesn't re-render four times a second
    const place = () => {
      if (!element) return;
      const next = element.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height
          ? prev
          : next
      );
    };
    const timer = window.setInterval(() => {
      const found = document.querySelector(`[data-showme="${request.target}"]`);
      if (found && found !== element && !element?.isConnected) {
        // First found, or re-drawn by the page
        element = found;
        found.scrollIntoView({ block: "center", behavior: "smooth" });
        window.setTimeout(place, 400);
      } else if (element) {
        place();
      } else if (Date.now() - request.at > FIND_FOR_MS) {
        toast.message(request.hint[language]);
        close();
      }
    }, 250);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [request, pathname, language, close]);

  // Any click (including on the button itself) or Escape closes it
  const showing = !!rect;
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const id = window.setTimeout(() => window.addEventListener("click", close, true), 300);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [showing, close]);

  if (!request || !rect) return null;

  const pad = 6;
  const below = rect.top < window.innerHeight / 2;
  const noteTop = below ? rect.bottom + pad + 12 : undefined;
  const noteBottom = below ? undefined : window.innerHeight - rect.top + pad + 12;
  const noteLeft = Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - 16 - 300));

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]" aria-live="polite">
      <div
        className="absolute rounded-lg ring-4 ring-primary transition-all duration-300 motion-safe:animate-pulse"
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
        }}
      />
      <div
        className="pointer-events-auto absolute w-[min(300px,calc(100vw-32px))] rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
        style={{ top: noteTop, bottom: noteBottom, left: noteLeft }}
      >
        <p className="font-semibold">{language === "hi" ? "यहाँ टैप करें" : "Tap here"} 👆</p>
        <p className="mt-1 text-muted-foreground">{request.hint[language]}</p>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="outline" onClick={close}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
