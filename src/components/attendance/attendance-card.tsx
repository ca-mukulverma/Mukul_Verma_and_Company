"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { CheckCircle2, Fingerprint, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/components/language-provider";
import type { AttendanceToday } from "@/lib/attendance";

// India time, the same as the admin's report
const timeFormat = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const fmtTime = (iso: string) => timeFormat.format(new Date(iso));

// "Mark attendance" on Today: one tap a day; the server keeps the time.
// Hidden for people who don't mark attendance, and on Sundays.
export function AttendanceCard({ attendance }: { attendance: AttendanceToday | undefined }) {
  const { t } = useLanguage();
  const [markedAt, setMarkedAt] = useState<string | null>(attendance?.markedAt ?? null);
  const [busy, setBusy] = useState(false);

  if (!attendance?.required || attendance.sunday) return null;

  const mark = async () => {
    setBusy(true);
    try {
      const response = await axios.post<{ markedAt: string }>("/api/attendance");
      setMarkedAt(response.data.markedAt);
      toast.success(`${t("Attendance marked")} · ${fmtTime(response.data.markedAt)}`);
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.error : null;
      toast.error(message || "Could not mark attendance. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (markedAt) {
    return (
      <Card className="border-l-4 border-l-green-500">
        <CardContent className="flex items-center gap-3 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
          <span>
            {t("Attendance marked")} · <strong>{fmtTime(markedAt)}</strong>
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-l-4 border-l-primary">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Fingerprint className="h-6 w-6 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">{t("Mark your attendance for today")}</p>
            <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, d MMMM")}</p>
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
