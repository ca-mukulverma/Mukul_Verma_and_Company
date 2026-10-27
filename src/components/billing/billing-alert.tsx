"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { AlertOctagon, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";

// Red alert at the top of the dashboard: billing work waiting more than 3
// days, for whoever it is pending with (Admin sees everyone's). Also asks
// people with billing work to turn on phone notifications, since the daily
// 11:58 AM reminder comes as one.

interface Group {
  key: string;
  label: string;
  count: number;
  overdue: number;
  oldestDays: number;
  link: string;
}

interface Alerts {
  billingRole: boolean;
  mine: Group[];
  others: { name: string; groups: Group[] }[];
  pushEnabled: boolean;
}

export function BillingAlert() {
  const [alerts, setAlerts] = useState<Alerts | null>(null);

  useEffect(() => {
    axios
      .get<Alerts>("/api/bills/alerts")
      .then(({ data }) => setAlerts(data))
      .catch(() => setAlerts(null));
  }, []);

  if (!alerts?.billingRole) return null;
  const mine = alerts.mine.filter((g) => g.overdue > 0);

  return (
    <div className="space-y-3">
      {(mine.length > 0 || alerts.others.length > 0) && (
        <div className="rounded-md border-2 border-red-500 bg-red-50 p-4 text-red-900 dark:border-red-700 dark:bg-red-950/50 dark:text-red-100">
          <p className="flex items-center gap-2 font-semibold">
            <AlertOctagon className="h-5 w-5 shrink-0" /> Billing work waiting more than 3 days
          </p>
          {mine.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {mine.map((g) => (
                <li key={g.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {g.label}: <b>{g.overdue}</b> overdue{g.count > g.overdue ? ` of ${g.count}` : ""} · oldest {g.oldestDays} days
                  </span>
                  <Button asChild size="sm" variant="destructive">
                    <Link href={g.link}>Open</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {alerts.others.length > 0 && (
            <div className="mt-3 space-y-1 text-sm">
              <p className="font-medium">Pending with others</p>
              <ul className="space-y-1">
                {alerts.others.map((p) => (
                  <li key={p.name}>
                    <b>{p.name}</b>: {p.groups.map((g) => `${g.label.toLowerCase()} – ${g.overdue} (oldest ${g.oldestDays} days)`).join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {!alerts.pushEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="flex items-center gap-2">
            <BellRing className="h-4 w-4 shrink-0" />
            Turn on phone notifications to get the daily 11:58 AM reminder of your pending billing work.
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/settings/notifications">Turn on</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
