import { NextResponse } from "next/server";
import { sendDailyBillingReminders } from "@/lib/billing-pending";

// Daily job at 11:58 AM India time, Sundays included (see vercel.json: 06:28
// UTC). Everyone with pending billing work gets a push and in-app
// notification listing it; work waiting more than 3 days is also sent to
// Admin (see lib/billing-pending.ts). From the 25th, Admin is reminded that
// bills are dated on the day of final approval.
// Vercel Cron calls this with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { reminded, escalated } = await sendDailyBillingReminders();
  return NextResponse.json({ message: `Reminded ${reminded} person(s); ${escalated} with work over 3 days sent to Admin` });
}
