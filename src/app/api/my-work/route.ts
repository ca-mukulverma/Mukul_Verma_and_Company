import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getMyWork } from "@/lib/my-work";
import { getAttendanceToday } from "@/lib/attendance";

// Everything waiting for the signed-in person (the "My work" page), plus
// whether they still have to mark today's attendance (no extra request)
export async function GET() {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [work, attendance] = await Promise.all([getMyWork(user.id), getAttendanceToday(user.id)]);
  return NextResponse.json({ ...work, attendance });
}
