import { NextResponse } from "next/server";
import { isAuthorizedCron, runCompliance } from "@/lib/cron-jobs";

// Creates the coming periods' compliance items, settles TDS returns of
// quarters without challans (what is due goes into each person's daily
// digest, /api/cron/daily-digest). Runs daily as part of
// /api/cron/daily; this route remains for running the job on its own by hand.
// Call with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runCompliance());
}
