import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getAttendanceReport, parseMonth, setAttendanceAlerts, setMarksAttendance } from "@/lib/attendance";
import { todayIST } from "@/lib/compliance-periods";

// The Attendance page: admin only.

async function requireAdmin() {
  const user = getSessionUser(await getServerSession(authOptions));
  return user?.role === "ADMIN" ? user : null;
}

// GET ?month=YYYY-MM (default: this month in India)
export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const param = request.nextUrl.searchParams.get("month");
  const today = todayIST();
  const parsed = param ? parseMonth(param) : { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
  if (!parsed) return NextResponse.json({ error: "Month must look like 2026-11" }, { status: 400 });

  return NextResponse.json(await getAttendanceReport(parsed.year, parsed.month));
}

const switchSchema = z.union([
  z.object({ userId: z.string().min(1).max(36), marksAttendance: z.boolean() }),
  z.object({ userId: z.string().min(1).max(36), attendanceAlerts: z.boolean() }),
]);

// PATCH { userId, marksAttendance }: who has to mark attendance
// PATCH { userId, attendanceAlerts }: which partners get "came to office"
export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = switchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const ok =
    "marksAttendance" in body.data
      ? await setMarksAttendance(body.data.userId, body.data.marksAttendance)
      : await setAttendanceAlerts(body.data.userId, body.data.attendanceAlerts);
  if (!ok) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
