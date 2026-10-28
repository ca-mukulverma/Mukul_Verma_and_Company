import { NextResponse } from "next/server";
import { isAuthorizedCron, runBillingEmailDelivery } from "@/lib/cron-jobs";

// Reads bounce notices from the billing mailbox, so failed bill emails are
// recorded even if nobody opens the Billing List. Runs daily as part of
// /api/cron/daily; this route remains for running the job on its own by hand.
// Call with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runBillingEmailDelivery());
}
