"use client";

import Link from "next/link";
import { BookOpen, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/components/language-provider";
import { START_TOUR_EVENT } from "@/components/onboarding/tour";

interface Section {
  id: string;
  title: string;
  steps: string[];
  link?: { href: string; label: string };
}

// The staff guide inside the app. Each page's "?" button opens its section
// here (/dashboard/help#<section>). The full manuals are in docs/ in the code.
const SECTIONS: Section[] = [
  {
    id: "my-work",
    title: "Today (My work)",
    steps: [
      "Today is the first page after you log in. It lists everything waiting for you: your tasks, the compliance work of the teams you are on that is due in the next 7 days, and billing work waiting for you.",
      "Red means overdue, amber due today, blue due in the next 3 days.",
      "Start moves a task to In progress. Mark done completes it; its bill goes to billing on its own. Both show Undo for a few seconds.",
      "Open on a compliance line opens the sheet on that period with the item's window already open.",
      "Every day around noon you also get one notification with the same summary (your daily digest). Single notifications, such as a new task or a bill sent for your amount, still arrive as they happen.",
    ],
    link: { href: "/dashboard/my-work", label: "Open Today" },
  },
  {
    id: "search",
    title: "Finding anything",
    steps: [
      "Click the search box at the top, or press Ctrl+K (⌘K on Mac) or /.",
      "Type at least 2 letters: a client's name, PAN, GSTIN, email or phone; a task title; a bill number; or a colleague's name.",
      "The same box jumps to any page (type “billing”, “compliance” …) and has quick actions such as New task.",
    ],
  },
  {
    id: "tasks",
    title: "Tasks",
    steps: [
      "Tasks are for occasional work. Recurring returns are in Compliance.",
      "Open a task to change its status, and read and add comments.",
      "When a task is marked Completed its bill is created for the billing manager automatically. If you clicked by mistake, use Undo in the message that appears.",
      "Admins and Partners create tasks. Start from a template (ITR, GST notice reply, Income tax notice, ROC, GST registration, Tax audit, Accounting) to get the title, priority, due date and checklist filled in. “Assign to me” adds yourself.",
      "Leaving a form with unsaved changes asks you first.",
    ],
    link: { href: "/dashboard/tasks", label: "Open Tasks" },
  },
  {
    id: "compliance",
    title: "Compliance sheets",
    steps: [
      "GST sheet, TDS sheet and Other work list every client's returns for a period. The red number on a tab is how many are overdue.",
      "Click any cell to open the item: tick Data received, enter the tax payable, mark it filed with the ARN, attach the PDF/JSON. Occasional steps (GSTR-1A, the fee) are under More options.",
      "Use the filter buttons above the sheet: My clients (clients you manage), Data not received, To file, Filed – files pending, Overdue, Locked, Completed. Your choice is remembered.",
      "Tick several clients to mark Data received or send reminders to all of them together. Remind all with data pending reminds everyone shown.",
      "The colour key above the sheet explains the colours. A lock means an earlier period or step must be finished first.",
      "The header row and client names stay in view while you scroll a long sheet.",
      "Setup (Admins and Partners) stays on the Compliance page: work types, teams, due dates, files needed and fees.",
    ],
    link: { href: "/dashboard/compliance", label: "Open Compliance" },
  },
  {
    id: "billing",
    title: "Billing",
    steps: [
      "Log work: enter work done that is not a task (tasks go to billing by themselves when completed). My entries shows what you logged.",
      "If a bill is sent to you for the amount (Awaiting my amount): Enter amount, Send back with a remark, or Not billable with the reason if you feel it should not be billed. Admin and the billing managers are told and can reopen it.",
      "Billing managers work in MVC bills / B Edge bills; Admin gives Final approval. Tally export, Connectors and Admin's setup (number series, company profiles, bill emails) are in the Billing settings menu.",
      "Bills are dated on the day of final approval, so approve them before the month ends.",
    ],
    link: { href: "/dashboard/billing", label: "Open Billing" },
  },
  {
    id: "clients",
    title: "Clients",
    steps: [
      "Open a client to see their details, tasks, documents, history and logins. Recent activity at the top shows the latest work done for them and by whom.",
      "Send to Client emails the client what they asked for (returns, challans, ITR, certificates) in one go.",
      "New task (Admins and Partners) creates a task already linked to the client.",
      "Client pickers show the last 5 clients you picked at the top.",
    ],
    link: { href: "/dashboard/clients", label: "Open Clients" },
  },
  {
    id: "notifications",
    title: "Notifications",
    steps: [
      "The bell at the top shows how many notifications you haven't read. Click one to open the task, bill or sheet it is about. Mark all read clears the count and keeps them in the list.",
      "Every notification also goes to your phone if notifications are on there. Notifications can't be switched off one by one: everyone gets the alerts for their own work.",
      "If you see “Notifications are off on this device”, tap Turn on.",
    ],
    link: { href: "/dashboard/settings/notifications", label: "Notification settings" },
  },
  {
    id: "phone",
    title: "Using the app on your phone",
    steps: [
      "iPhone (iOS 16.4 or later): open the site in Safari → Share → Add to Home Screen → Add. Open MV Company from the Home Screen, sign in, then Settings → Notifications → Enable notifications on this device → Allow.",
      "Android: open the site in Chrome → menu (⋮) → Install app (or Add to Home screen). Then Settings → Notifications → Enable notifications on this device.",
      "If phone alerts stop: open the app once (it re-registers the phone by itself). If they still don't come, check that notifications for MV Company are allowed in the phone's settings and that Focus / Do Not Disturb is off.",
      "On the phone, the bar at the bottom has Today, Tasks, Compliance, Clients and Menu.",
    ],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    steps: [
      "Ctrl+K or / – search.",
      "G then a letter – open a page: G M Today, G T Tasks, G P Compliance, G C Clients, G B Billing, G D Dashboard, G S Settings, G E Help (G U Users for Admins and Partners).",
      "N – new task (Admins and Partners).",
      "? – the list of shortcuts. Shortcuts don't work while you are typing in a box.",
    ],
  },
  {
    id: "language",
    title: "Hindi / English",
    steps: [
      "The language button at the top (or Menu → हिंदी on the phone) shows the menu, header, Today and Help headings in Hindi. Your choice is kept on that device. Forms and sheets stay in English.",
    ],
  },
];

export default function HelpPage() {
  const { t } = useLanguage();
  const sections = SECTIONS;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BookOpen className="h-6 w-6" />
            {t("How to use the app")}
          </h1>
          <p className="text-muted-foreground">Short steps for each part of the app. The ? next to a page title opens its part here.</p>
        </div>
        <Button variant="outline" onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}>
          <PlayCircle className="mr-2 h-4 w-4" />
          {t("Take the tour")}
        </Button>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Help sections">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border px-3 py-1 text-sm hover:bg-muted">
            {s.title}
          </a>
        ))}
      </nav>

      {sections.map((section) => (
        <Card key={section.id} id={section.id} className="scroll-mt-20 target:ring-2 target:ring-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
              {section.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {section.link && (
              <Button asChild size="sm" variant="secondary">
                <Link href={section.link.href}>{section.link.label}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
