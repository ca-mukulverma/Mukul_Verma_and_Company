import { NextResponse } from "next/server";
import { isAuthorizedCron, runDailyDigest } from "@/lib/cron-jobs";

// Sends each staff member their daily digest of tasks, compliance and billing
// work (lib/daily-digest.ts). Runs daily as part of
// /api/cron/daily; this route remains for running the job on its own by hand.
// Call with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDailyDigest());
}
