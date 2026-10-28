import { NextResponse } from "next/server";
import { isAuthorizedCron, runCleanupNotifications } from "@/lib/cron-jobs";

// Removes notifications older than the retention period, and the workflow
// steps from the history of bills over a year old. Runs daily as part of
// /api/cron/daily; this route remains for running the job on its own by hand.
// Call with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runCleanupNotifications());
  } catch (error) {
    console.error("Error cleaning up old notifications:", error);
    return NextResponse.json(
      { error: "Failed to clean up notifications" },
      { status: 500 }
    );
  }
}
