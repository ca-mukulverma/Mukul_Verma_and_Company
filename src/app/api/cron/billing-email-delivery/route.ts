import { NextResponse } from "next/server";
import { checkBillEmailDelivery } from "@/lib/bill-email-bounces";

// Daily job (see vercel.json): reads bounce notices from the billing mailbox,
// so failed bill emails are recorded even if nobody opens the Billing List.
// Vercel Cron calls this with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await checkBillEmailDelivery(60));
}
