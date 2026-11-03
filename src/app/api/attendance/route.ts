import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { markAttendance } from "@/lib/attendance";

// Mark my attendance for today (the button on Today). The time is the
// server's, so a wrong phone clock can't change it.
export async function POST() {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await markAttendance(user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ markedAt: result.markedAt, alreadyMarked: result.alreadyMarked });
}
