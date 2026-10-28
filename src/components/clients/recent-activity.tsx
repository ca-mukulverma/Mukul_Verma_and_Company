"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActivityEntry } from "@/app/api/clients/[id]/activity/route";

// "Who did what lately" for a client: tasks, compliance steps, notes and
// files sent, newest first
export function RecentActivity({ clientId }: { clientId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<{ entries: ActivityEntry[] }>(`/api/clients/${clientId}/activity`)
      .then(({ data }) => !cancelled && setEntries(data.entries))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="h-5 w-5" />
          Recent activity
        </CardTitle>
        <CardDescription>The latest work done for this client, by whom</CardDescription>
      </CardHeader>
      <CardContent>
        {entries === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. Tasks, compliance work and files sent to this client will show here.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {entries.map((entry) => {
              const text = entry.href ? (
                <Link href={entry.href} className="hover:underline">
                  {entry.text}
                </Link>
              ) : (
                entry.text
              );
              return (
                <li key={entry.id} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="flex-1">{text}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {entry.who ? `${entry.who} · ` : ""}
                    {formatDistanceToNow(new Date(entry.at), { addSuffix: true })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
