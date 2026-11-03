import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { sendAnnouncementPushById } from "@/lib/whats-new-server";

export const maxDuration = 60;

const schema = z.object({ id: z.string().min(1).max(50) });

// Admin: send a card's push now instead of waiting for the daily job.
// Sent once only.
export async function POST(request: NextRequest) {
  const user = getSessionUser(await getServerSession(authOptions));
  if (user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const result = await sendAnnouncementPushById(body.data.id);
  if (!result.sent) return NextResponse.json({ error: result.reason }, { status: 409 });
  return NextResponse.json(result);
}
