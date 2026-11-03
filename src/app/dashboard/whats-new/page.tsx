"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { BellRing, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import { ANNOUNCEMENTS, PUSH_WINDOW_DAYS, markSeen, showMe } from "@/lib/whats-new";

interface Data {
  ids: string[];
  // Admins: every card, also those for other people
  all?: string[];
  pushes?: Record<string, { sentAt: string; recipients: number }>;
}

const AUDIENCE_LABELS = { everyone: "All staff", attendance: "People who mark attendance", admin: "Admin" };

const fmtDate = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

// Every What's new card meant for me, newest first, with "Show me" to
// replay the pointer. A push notification opens this page on its card.
function WhatsNew() {
  const params = useSearchParams();
  const open = params.get("open");
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const { language, t } = useLanguage();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await axios.get<Data>("/api/whats-new");
      setData(response.data);
      // Read here, so the pop-up doesn't show them again
      markSeen(response.data.ids);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (open && data) document.getElementById(`card-${open}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [open, data]);

  const sendNow = async (id: string) => {
    setSending(id);
    try {
      const response = await axios.post<{ recipients: number }>("/api/whats-new/push", { id });
      const n = response.data.recipients;
      toast.success(`Notification sent to ${n} ${n === 1 ? "person" : "people"}`);
      await load();
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.error(message || "Could not send. Try again.");
    } finally {
      setSending(null);
    }
  };

  const cards = data ? ANNOUNCEMENTS.filter((a) => (data.all ?? data.ids).includes(a.id)) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="h-6 w-6" />
          {t("What's new")}
        </h1>
        <p className="text-muted-foreground">New in the app, and how to use it. “Show me” points at the button.</p>
      </div>

      {error && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>Could not be loaded. Check your connection.</span>
            <Button size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!data && !error && <Skeleton className="h-48" />}
      {data && cards.length === 0 && <p className="text-sm text-muted-foreground">Nothing new yet.</p>}

      {cards.map((card) => {
        const push = data?.pushes?.[card.id];
        const launch = new Date(`${card.date}T00:00:00Z`).getTime();
        const windowOver = Date.now() - launch > (PUSH_WINDOW_DAYS + 1) * 86_400_000;
        return (
          <Card key={card.id} id={`card-${card.id}`} className={cn("scroll-mt-20", open === card.id && "ring-2 ring-primary")}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
                <span>{card.title[language]}</span>
                <span className="text-xs font-normal text-muted-foreground">{fmtDate(card.date)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
                {card.steps[language].map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {card.showMe && data?.ids.includes(card.id) && <Button onClick={() => showMe(card)}>{t("Show me")}</Button>}

              {isAdmin && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <BellRing className="h-4 w-4" />
                    <Badge variant="outline">{AUDIENCE_LABELS[card.audience]}</Badge>
                    {push
                      ? `Notification sent to ${push.recipients} ${push.recipients === 1 ? "person" : "people"} on ${fmtDate(push.sentAt)}`
                      : windowOver
                        ? "No notification was sent"
                        : "Notification goes out at noon on its own"}
                  </span>
                  {!push && !windowOver && (
                    <Button size="sm" variant="outline" disabled={sending === card.id} onClick={() => sendNow(card.id)}>
                      {sending === card.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                      Send now
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function WhatsNewPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-48 max-w-3xl" />}>
      <WhatsNew />
    </Suspense>
  );
}
