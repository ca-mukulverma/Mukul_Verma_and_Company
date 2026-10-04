import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { basePrisma } from "@/lib/prisma";
import { pushEnabled, sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";

/** POST /api/push/test → sends a test push to the logged-in user's own devices */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushEnabled()) return NextResponse.json({ error: "Push not configured" }, { status: 503 });

  const user = await basePrisma.user.findUnique({
    where: { email: session.user.email as string },
    select: { id: true, name: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await sendPushToUser(user.id, {
    title: "Test notification",
    body: `Hi ${user.name || ""}, notifications are working on this device.`.replace("  ", " "),
    url: "/dashboard/settings/notifications",
    tag: "mvc-test",
  });
  return NextResponse.json({ ok: true });
}
