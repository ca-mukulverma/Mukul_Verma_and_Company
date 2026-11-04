import { prisma } from "@/lib/prisma";
import { todayIST, utcDate } from "@/lib/compliance-periods";
import { sendPushToUser } from "@/lib/web-push";
import { lateShort, minutesLate, OFFICE_START_LABEL } from "@/lib/attendance-time";

// Attendance: staff tap "Mark attendance" on Today once a day; the admin sees
// the times on the Attendance page. Sundays are skipped. Admins never mark,
// and the admin can turn marking off for selected people (marksAttendance).
//
// Cheap on purpose: the "marked today?" check rides along with the Today
// request, a mark is one insert, and the report is read only when the admin
// opens it. No background job of its own, no polling: the "not marked yet"
// reminder rides along with the daily job (11:58 AM India time).
//
// Office time is 11:30 AM with 5 minutes' grace (lib/attendance-time.ts).
// Lateness is worked out from markedAt, so nothing extra is stored.

export interface AttendanceToday {
  // Whether this person marks attendance at all
  required: boolean;
  // Sunday in India: no attendance
  sunday: boolean;
  // ISO time of today's mark, or null
  markedAt: string | null;
}

export function isSunday(date: Date) {
  return date.getUTCDay() === 0;
}

export function marksAttendance(user: { role: string; marksAttendance: boolean; isActive?: boolean }) {
  return user.role !== "ADMIN" && user.marksAttendance && user.isActive !== false;
}

export async function getAttendanceToday(userId: string): Promise<AttendanceToday> {
  const today = todayIST();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      marksAttendance: true,
      attendances: { where: { date: today }, select: { markedAt: true }, take: 1 },
    },
  });
  return {
    required: !!user && marksAttendance(user),
    sunday: isSunday(today),
    markedAt: user?.attendances[0]?.markedAt.toISOString() ?? null,
  };
}

export type MarkResult =
  | {
      ok: true;
      markedAt: string;
      alreadyMarked: boolean;
      // Minutes late after 11:30 AM (0: on time or within the grace)
      lateMinutes: number;
      // Late days this month including today (0 when on time)
      lateDaysThisMonth: number;
    }
  | { ok: false; error: string; status: number };

// Marks today's attendance with the server's time. A second tap keeps the
// first time.
export async function markAttendance(userId: string): Promise<MarkResult> {
  const today = todayIST();
  if (isSunday(today)) return { ok: false, error: "No attendance on Sunday.", status: 400 };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, marksAttendance: true, isActive: true },
  });
  if (!user || !marksAttendance(user)) {
    return { ok: false, error: "You don't need to mark attendance.", status: 403 };
  }

  // Insert unless already there (also safe when two taps arrive together)
  const { count } = await prisma.attendance.createMany({ data: [{ userId, date: today }], skipDuplicates: true });
  const row = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: today } },
    select: { markedAt: true },
  });
  if (!row) return { ok: false, error: "Could not mark attendance. Try again.", status: 500 };

  // Only when late: this month's marks, to count the late days
  const lateMinutes = minutesLate(row.markedAt);
  let lateDaysThisMonth = 0;
  if (lateMinutes > 0) {
    const first = utcDate(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
    const month = await prisma.attendance.findMany({
      where: { userId, date: { gte: first, lte: today } },
      select: { markedAt: true },
    });
    lateDaysThisMonth = month.filter((m) => minutesLate(m.markedAt) > 0).length;
  }
  return { ok: true, markedAt: row.markedAt.toISOString(), alreadyMarked: count === 0, lateMinutes, lateDaysThisMonth };
}

export interface AttendancePerson {
  id: string;
  name: string;
  role: string;
  // Off: this person doesn't mark attendance and isn't in the report
  marksAttendance: boolean;
  // Partners: gets a notification when someone marks attendance
  attendanceAlerts: boolean;
}

export interface AttendanceReport {
  month: string; // YYYY-MM
  today: string; // YYYY-MM-DD (India)
  // Working days of the month (Sundays left out), YYYY-MM-DD
  days: string[];
  // Everyone who can mark, including those switched off (for the switches)
  people: AttendancePerson[];
  // marks[userId][YYYY-MM-DD] = ISO time marked
  marks: Record<string, Record<string, string>>;
}

export function parseMonth(value: string | null): { year: number; month: number } | null {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { year, month };
}

export function workingDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  for (let d = utcDate(year, month, 1); d.getUTCMonth() === month - 1; d = new Date(d.getTime() + 86_400_000)) {
    if (!isSunday(d)) days.push(d);
  }
  return days;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function getAttendanceReport(year: number, month: number): Promise<AttendanceReport> {
  const first = utcDate(year, month, 1);
  const next = utcDate(year, month + 1, 1);

  const [users, rows] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, role: { not: "ADMIN" } },
      select: { id: true, name: true, role: true, marksAttendance: true, attendanceAlerts: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: first, lt: next } },
      select: { userId: true, date: true, markedAt: true },
    }),
  ]);

  const marks: AttendanceReport["marks"] = {};
  for (const row of rows) {
    (marks[row.userId] ??= {})[dayKey(row.date)] = row.markedAt.toISOString();
  }

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    today: dayKey(todayIST()),
    days: workingDays(year, month).map(dayKey),
    people: users,
    marks,
  };
}

export async function setMarksAttendance(userId: string, value: boolean) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role === "ADMIN") return false;
  await prisma.user.update({ where: { id: userId }, data: { marksAttendance: value } });
  return true;
}

// Only partners are chosen; admins always get the alerts
export async function setAttendanceAlerts(userId: string, value: boolean) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== "PARTNER") return false;
  await prisma.user.update({ where: { id: userId }, data: { attendanceAlerts: value } });
  return true;
}

const alertTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

// "Staff A came to office · 10:04 am" (with "22 min late" when late) to every admin and the partners with
// alerts on (not to the person who marked). Bell notification + phone push.
export async function sendArrivalAlerts(userId: string, markedAt: string) {
  const [person, recipients] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: userId },
        OR: [{ role: "ADMIN" }, { role: "PARTNER", attendanceAlerts: true }],
      },
      select: { id: true, role: true },
    }),
  ]);
  if (!person || recipients.length === 0) return;

  const time = alertTime.format(new Date(markedAt));
  const title = `${person.name} came to office`.slice(0, 75);
  const late = minutesLate(markedAt);
  const content = late
    ? `${person.name} marked attendance at ${time}, ${lateShort(late)} late (office time ${OFFICE_START_LABEL}).`
    : `${person.name} marked attendance at ${time}.`;
  await prisma.notification.createMany({
    data: recipients.map((r) => ({ title, content, sentById: userId, sentToId: r.id })),
  });
  await Promise.all(
    recipients.map((r) =>
      sendPushToUser(r.id, {
        title,
        body: content,
        // Only the admin can open the report
        url: r.role === "ADMIN" ? "/dashboard/attendance" : "/dashboard",
        tag: `arrival-${userId}`,
      })
    )
  );
}

// Daily job (11:58 AM India time): a reminder to each person who marks
// attendance and hasn't yet today. Not on Sundays. Bell notification + push.
export async function sendAttendanceReminders() {
  const today = todayIST();
  if (isSunday(today)) return { message: "Sunday: no attendance", sent: 0 };

  const [admin, users] = await Promise.all([
    prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } }),
    prisma.user.findMany({
      where: { isActive: true, role: { not: "ADMIN" }, marksAttendance: true, attendances: { none: { date: today } } },
      select: { id: true },
    }),
  ]);
  if (!admin) return { message: "No active Admin to send from", sent: 0 };
  if (users.length === 0) return { message: "Everyone has marked attendance", sent: 0 };

  const title = "Attendance not marked yet";
  const content = `Office time is ${OFFICE_START_LABEL}. If you are in the office, open Today and tap Mark attendance.`;
  await prisma.notification.createMany({
    data: users.map((u) => ({ title, content, sentById: admin.id, sentToId: u.id })),
  });
  for (const u of users) {
    await sendPushToUser(u.id, { title, body: content, url: "/dashboard/my-work", tag: "attendance-reminder" });
  }
  return { message: `Reminded ${users.length} person(s)`, sent: users.length };
}
