import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";

// Send a test push to all of the current user's devices
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const devices = await prisma.pushSubscription.count({
    where: { userId: session.user.id },
  });
  if (devices === 0) {
    return NextResponse.json(
      { error: "Push notifications are not enabled on any device" },
      { status: 400 }
    );
  }

  await sendPushToUser(session.user.id, {
    title: "Test notification",
    body: "Push notifications are working on this device.",
    url: "/dashboard/settings/notifications",
  });

  return NextResponse.json({ success: true, devices });
}
