"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlarmClock, CheckCircle2, Fingerprint, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/components/language-provider";
import type { AttendanceToday } from "@/lib/attendance";
import { lateMessage, lateShort, minutesLate, OFFICE_START_LABEL } from "@/lib/attendance-time";

// India time, the same as the admin's report
const timeFormat = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const fmtTime = (iso: string) => timeFormat.format(new Date(iso));

// "Mark attendance" on Today: one tap a day; the server keeps the time.
// Hidden for people who don't mark attendance, and on Sundays.
// Marked after 11:35 AM (11:30 + 5 minutes' grace): a message they must close
// says how late they are, and the card stays amber for the day.
export function AttendanceCard({ attendance }: { attendance: AttendanceToday | undefined }) {
  const { t, language } = useLanguage();
  const [markedAt, setMarkedAt] = useState<string | null>(attendance?.markedAt ?? null);
  const [busy, setBusy] = useState(false);
  const [lateNotice, setLateNotice] = useState<{ title: string; body: string } | null>(null);

  if (!attendance?.required || attendance.sunday) return null;

  const mark = async () => {
    setBusy(true);
    try {
      const response = await axios.post<{
        markedAt: string;
        alreadyMarked: boolean;
        lateMinutes: number;
        lateDaysThisMonth: number;
      }>("/api/attendance");
      const { markedAt: at, alreadyMarked, lateMinutes, lateDaysThisMonth } = response.data;
      setMarkedAt(at);
      if (lateMinutes > 0 && !alreadyMarked) {
        setLateNotice(lateMessage(lateMinutes, lateDaysThisMonth, language));
      } else {
        toast.success(`${t("Attendance marked")} · ${fmtTime(at)}`);
      }
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.error : null;
      toast.error(message || "Could not mark attendance. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const notice = (
    <AlertDialog open={!!lateNotice} onOpenChange={(open) => !open && setLateNotice(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlarmClock className="h-5 w-5 shrink-0" />
            {lateNotice?.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-base">{lateNotice?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>{t("OK, I'll come on time")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (markedAt) {
    const late = minutesLate(markedAt);
    return (
      <>
        {notice}
        <Card className={late ? "border-l-4 border-l-amber-500" : "border-l-4 border-l-green-500"} data-showme="mark-attendance">
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            {late ? (
              <AlarmClock className="h-5 w-5 shrink-0 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
            )}
            <span>
              {t("Attendance marked")} · <strong>{fmtTime(markedAt)}</strong>
              {late > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {" "}
                  · {lateShort(late)} {t("late")} ({t("office time")} {OFFICE_START_LABEL})
                </span>
              )}
            </span>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <Card className="border-l-4 border-l-primary" data-showme="mark-attendance">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Fingerprint className="h-6 w-6 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">{t("Mark your attendance for today")}</p>
            <p className="text-sm text-muted-foreground">
              {format(new Date(), "EEEE, d MMMM")} · {t("office time")} {OFFICE_START_LABEL}
            </p>
          </div>
        </div>
        <Button size="lg" onClick={mark} disabled={busy} className="w-full sm:w-auto">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          {t("Mark attendance")}
        </Button>
      </CardContent>
    </Card>
  );
}
