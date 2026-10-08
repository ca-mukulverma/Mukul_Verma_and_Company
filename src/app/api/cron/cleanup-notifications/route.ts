import { NextResponse } from "next/server";
import { deleteOldNotifications, NOTIFICATION_RETENTION_DAYS } from "@/lib/notifications";

// Nightly job (see vercel.json): removes notifications older than the retention period.
// Vercel Cron calls this with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deletedCount = await deleteOldNotifications();
    return NextResponse.json({
      message: `Deleted notifications older than ${NOTIFICATION_RETENTION_DAYS} days`,
      deletedCount,
    });
  } catch (error) {
    console.error("Error cleaning up old notifications:", error);
    return NextResponse.json(
      { error: "Failed to clean up notifications" },
      { status: 500 }
    );
  }
}
