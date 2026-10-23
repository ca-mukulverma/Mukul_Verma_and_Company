import { NextResponse } from "next/server";
import { deleteOldNotifications, NOTIFICATION_RETENTION_DAYS } from "@/lib/notifications";
import { pruneOldBillHistory } from "@/lib/billing";

// Nightly job (see vercel.json): removes notifications older than the retention
// period, and the workflow steps from the history of bills over a year old.
// Vercel Cron calls this with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deletedCount = await deleteOldNotifications();
    const billHistoryDeleted = await pruneOldBillHistory();
    return NextResponse.json({
      message: `Deleted notifications older than ${NOTIFICATION_RETENTION_DAYS} days`,
      deletedCount,
      billHistoryDeleted,
    });
  } catch (error) {
    console.error("Error cleaning up old notifications:", error);
    return NextResponse.json(
      { error: "Failed to clean up notifications" },
      { status: 500 }
    );
  }
}
