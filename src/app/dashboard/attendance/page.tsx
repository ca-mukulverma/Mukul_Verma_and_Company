"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { ChevronLeft, ChevronRight, Download, Fingerprint, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { HelpLink } from "@/components/help/help-link";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import type { AttendanceReport } from "@/lib/attendance";

// Attendance report, admin only: who marked attendance on Today and when.
// Sundays are left out. Built only when this page is opened.

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const fmtTime = (iso: string) => timeFormat.format(new Date(iso));

const dayHeader = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return {
    date: d.getUTCDate(),
    weekday: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
  };
};

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function downloadCsv(report: AttendanceReport, people: AttendanceReport["people"]) {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ["Name", ...report.days, "Days present"].map(cell).join(","),
    ...people.map((p) => {
      const marks = report.marks[p.id] ?? {};
      const times = report.days.map((day) => (marks[day] ? fmtTime(marks[day]) : day <= report.today ? "Absent" : ""));
      return [p.name, ...times, Object.keys(marks).length].map(cell).join(",");
    }),
  ];
  // BOM so Excel reads it as UTF-8
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${report.month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AttendancePage() {
  const { data: session } = useSession();
  const { t } = useLanguage();
  const [month, setMonth] = useState<string | null>(null);
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async (m: string | null) => {
    setLoading(true);
    try {
      const response = await axios.get<AttendanceReport>("/api/attendance/report", { params: m ? { month: m } : {} });
      setReport(response.data);
      setMonth(response.data.month);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  const marking = useMemo(() => report?.people.filter((p) => p.marksAttendance) ?? [], [report]);
  const thisMonth = report ? report.today.slice(0, 7) : null;
  const todayIsWorkingDay = !!report && report.days.includes(report.today);

  const toggle = async (userId: string, value: boolean, field: "marksAttendance" | "attendanceAlerts" = "marksAttendance") => {
    if (!report) return;
    setSaving(userId);
    try {
      await axios.patch("/api/attendance/report", { userId, [field]: value });
      setReport({ ...report, people: report.people.map((p) => (p.id === userId ? { ...p, [field]: value } : p)) });
    } catch {
      toast.error("Could not save. Try again.");
    } finally {
      setSaving(null);
    }
  };

  if (session && session.user?.role !== "ADMIN") {
    return <p>Only the admin can see attendance.</p>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("Attendance")}</h1>
            <HelpLink section="attendance" />
          </div>
          <p className="text-muted-foreground">
            The time each person marked attendance on Today. Sundays are left out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous month" disabled={!month || loading} onClick={() => month && load(shiftMonth(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-36 text-center font-medium">{month ? monthLabel(month) : "…"}</span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            disabled={!month || loading || month === thisMonth}
            onClick={() => month && load(shiftMonth(month, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" disabled={!report || loading} onClick={() => report && downloadCsv(report, marking)}>
            <Download className="mr-1 h-4 w-4" />
            Excel (CSV)
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>Attendance could not be loaded. Check your connection.</span>
            <Button size="sm" variant="outline" onClick={() => load(month)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!report && loading ? (
        <Skeleton className="h-64" />
      ) : (
        report && (
          <>
            {report.month === thisMonth && (
              <TodayCard report={report} people={marking} workingDay={todayIsWorkingDay} />
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  {monthLabel(report.month)}
                  {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </CardTitle>
                <CardDescription>Time marked (India time). “—” means not marked.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {marking.length === 0 ? (
                  <p className="px-6 pb-6 text-sm text-muted-foreground">Nobody marks attendance. Turn people on below.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">Name</th>
                          <th className="px-2 py-2 text-center font-medium">Present</th>
                          {report.days.map((day) => {
                            const h = dayHeader(day);
                            return (
                              <th
                                key={day}
                                className={cn("px-1.5 py-2 text-center font-medium", day === report.today && "bg-primary/10")}
                              >
                                <div>{h.date}</div>
                                <div className="font-normal text-muted-foreground">{h.weekday}</div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {marking.map((person) => {
                          const marks = report.marks[person.id] ?? {};
                          const past = report.days.filter((d) => d <= report.today).length;
                          return (
                            <tr key={person.id} className="border-b last:border-0">
                              <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-2 font-medium">{person.name}</td>
                              <td className="px-2 py-2 text-center">
                                {Object.keys(marks).length}/{past}
                              </td>
                              {report.days.map((day) => (
                                <td
                                  key={day}
                                  className={cn(
                                    "whitespace-nowrap px-1.5 py-2 text-center",
                                    day === report.today && "bg-primary/10",
                                    marks[day] ? "text-green-700 dark:text-green-400" : "text-muted-foreground"
                                  )}
                                >
                                  {marks[day] ? fmtTime(marks[day]) : day <= report.today ? "—" : ""}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-showme="attendance-switches">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Who marks attendance</CardTitle>
                <CardDescription>
                  Turn off the partners (or anyone) who don&apos;t need to mark attendance. They won&apos;t see the
                  button and won&apos;t be in the report. Admins never mark attendance.
                </CardDescription>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {report.people.map((person) => (
                  <label key={person.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <span className="flex items-center gap-2 text-sm">
                      {person.name}
                      {person.role === "PARTNER" && <Badge variant="outline">Partner</Badge>}
                    </span>
                    <span className="flex items-center gap-2">
                      {saving === person.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      <Switch
                        checked={person.marksAttendance}
                        disabled={saving === person.id}
                        onCheckedChange={(value) => toggle(person.id, value)}
                        aria-label={`${person.name} marks attendance`}
                      />
                    </span>
                  </label>
                ))}
              </CardContent>
            </Card>

            <Card data-showme="attendance-alerts">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Who gets “came to office” notifications</CardTitle>
                <CardDescription>
                  Each time someone marks attendance, a notification (“Staff A came to office · 10:04 am”) goes to
                  the admin and to the partners turned on here.
                </CardDescription>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {report.people
                  .filter((p) => p.role === "PARTNER")
                  .map((person) => (
                    <label key={person.id} className="flex items-center justify-between gap-3 px-6 py-3">
                      <span className="text-sm">{person.name}</span>
                      <span className="flex items-center gap-2">
                        {saving === person.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        <Switch
                          checked={person.attendanceAlerts}
                          disabled={saving === person.id}
                          onCheckedChange={(value) => toggle(person.id, value, "attendanceAlerts")}
                          aria-label={`${person.name} gets came to office notifications`}
                        />
                      </span>
                    </label>
                  ))}
                {!report.people.some((p) => p.role === "PARTNER") && (
                  <p className="px-6 py-3 text-sm text-muted-foreground">No partners.</p>
                )}
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  );
}

function TodayCard({
  report,
  people,
  workingDay,
}: {
  report: AttendanceReport;
  people: AttendanceReport["people"];
  workingDay: boolean;
}) {
  if (!workingDay) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">Today is Sunday: no attendance.</CardContent>
      </Card>
    );
  }
  const present = people
    .filter((p) => report.marks[p.id]?.[report.today])
    .sort((a, b) => report.marks[a.id][report.today].localeCompare(report.marks[b.id][report.today]));
  const absent = people.filter((p) => !report.marks[p.id]?.[report.today]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Fingerprint className="h-5 w-5" />
          Today · {present.length} of {people.length} marked
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium">Marked</p>
          {present.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {present.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span>{p.name}</span>
                  <span className="text-green-700 dark:text-green-400">{fmtTime(report.marks[p.id][report.today])}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Not marked yet</p>
          {absent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everyone has marked.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {absent.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
