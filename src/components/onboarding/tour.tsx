"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, ClipboardList, HelpCircle, ListTodo, Receipt, Search, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/components/language-provider";

export const START_TOUR_EVENT = "app:start-tour";
const DONE_KEY = "tour-done-v1";

interface Step {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
  managersOnly?: boolean;
}

const STEPS: Step[] = [
  {
    icon: ListTodo,
    title: "Start each day on Today",
    text: "My work → Today lists everything waiting for you: your tasks, the compliance work of your teams that is due, and bills waiting for you. Mark a task done or open it from there. Every day you also get one notification with the summary.",
  },
  {
    icon: Search,
    title: "Find anything with search",
    text: "Use the search box at the top (or press Ctrl+K or /) to find a client by name, PAN, GSTIN, email or phone, a task, a bill number or a colleague.",
  },
  {
    icon: ClipboardList,
    title: "Tasks",
    text: "Open a task to change its status, comment or discuss it in chat. When you mark it completed, its bill goes to billing on its own.",
  },
  {
    icon: CalendarCheck,
    title: "Compliance sheets",
    text: "GST, TDS and other recurring work are in sheets. Click any cell to update it. Use the filter buttons (My clients, Overdue, Data not received) and tick several rows to remind or mark data received together. The colour key above each sheet explains every colour.",
  },
  {
    icon: Receipt,
    title: "Billing",
    text: "Log work for billing and see your entries under Billing. If a bill is sent to you for the amount, enter it, send it back, or mark it Not billable with a reason.",
  },
  {
    icon: Smartphone,
    title: "Get alerts on your phone",
    text: "Install the app on your phone (Safari → Share → Add to Home Screen on iPhone) and turn on notifications in Settings → Notifications, so you never miss a task or a bill.",
  },
  {
    icon: HelpCircle,
    title: "Help is always there",
    text: "Help in the menu explains every section step by step. The ? button on each page opens its part of the guide. Press ? on the keyboard for shortcuts.",
  },
];

// A short walk-through on a person's first visit (on each device), and
// whenever they choose "Take the tour" from the profile menu.
export function Tour({ role }: { role: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const steps = STEPS.filter((s) => !s.managersOnly || role === "ADMIN" || role === "PARTNER");

  useEffect(() => {
    try {
      if (!localStorage.getItem(DONE_KEY)) setOpen(true);
    } catch {
      // Storage blocked: don't show it on every page
    }
    const start = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);

  const finish = () => {
    setOpen(false);
    try {
      localStorage.setItem(DONE_KEY, new Date().toISOString());
    } catch {
      // Shown again next time
    }
  };

  const step = steps[index];
  if (!step) return null;
  const last = index === steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <step.icon className="h-5 w-5" />
          </div>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">{step.text}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span key={s.title} className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-primary" : "bg-muted-foreground/30"}`} />
          ))}
        </div>
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" onClick={finish}>
            {t("Skip")}
          </Button>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="outline" onClick={() => setIndex(index - 1)}>
                {t("Back")}
              </Button>
            )}
            <Button onClick={() => (last ? finish() : setIndex(index + 1))}>{last ? t("Done") : t("Next")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
