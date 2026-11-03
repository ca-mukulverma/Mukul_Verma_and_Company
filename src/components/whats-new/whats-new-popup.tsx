"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import axios from "axios";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/components/language-provider";
import { TOUR_DONE_KEY } from "@/components/onboarding/tour";
import {
  ANNOUNCEMENTS,
  TOUR_CLOSED_EVENT,
  markSeen,
  readSeen,
  roleMayBeInAudience,
  showMe,
  type Announcement,
} from "@/lib/whats-new";

// Shows each new What's new card once per device, after the first-visit
// tour. Asks the server only when there is a card this device hasn't shown,
// so most visits cost nothing.
export function WhatsNewPopup({ role }: { role: string }) {
  const pathname = usePathname();
  const { language, t } = useLanguage();
  const [queue, setQueue] = useState<Announcement[]>([]);

  const check = useCallback(async () => {
    try {
      if (!localStorage.getItem(TOUR_DONE_KEY)) return;
    } catch {
      return;
    }
    const seen = new Set(readSeen());
    const candidates = ANNOUNCEMENTS.filter((a) => !seen.has(a.id) && roleMayBeInAudience(role, a.audience));
    if (candidates.length === 0) return;
    try {
      const { data } = await axios.get<{ ids: string[] }>("/api/whats-new");
      const mine = new Set(data.ids);
      // Cards not meant for me count as seen, so this isn't asked again
      markSeen(candidates.filter((a) => !mine.has(a.id)).map((a) => a.id));
      // Oldest first, so they read in the order they arrived
      setQueue(candidates.filter((a) => mine.has(a.id)).reverse());
    } catch {
      // Try again next visit
    }
  }, [role]);

  useEffect(() => {
    if (!role) return;
    check();
    window.addEventListener(TOUR_CLOSED_EVENT, check);
    return () => window.removeEventListener(TOUR_CLOSED_EVENT, check);
  }, [role, check]);

  const current = queue[0];
  // The What's new page shows them all already
  if (!current || pathname?.startsWith("/dashboard/whats-new")) return null;

  const next = () => {
    markSeen([current.id]);
    setQueue((q) => q.slice(1));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && next()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <DialogTitle>{current.title[language]}</DialogTitle>
          <DialogDescription asChild>
            <ol className="list-decimal space-y-1.5 pl-5 text-left text-sm leading-relaxed">
              {current.steps[language].map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </DialogDescription>
        </DialogHeader>
        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {queue.length - 1} {t("more new")}
          </p>
        )}
        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={next}>
            {t("Got it")}
          </Button>
          {current.showMe && (
            <Button
              onClick={() => {
                next();
                showMe(current);
              }}
            >
              {t("Show me")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
