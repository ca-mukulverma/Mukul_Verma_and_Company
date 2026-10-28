import { NextResponse } from "next/server";
import { isAuthorizedCron, runBillingReminders } from "@/lib/cron-jobs";

// Everyone with pending billing work gets a push and in-app notification
// listing it; work waiting more than 3 days is also sent to Admin (see
// lib/billing-pending.ts). Runs daily at 11:58 AM India time as part of
// /api/cron/daily; this route remains for running the job on its own by hand.
// Call with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runBillingReminders());
}
