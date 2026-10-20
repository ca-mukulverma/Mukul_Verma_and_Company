import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing";
import { checkBillEmailDelivery } from "@/lib/bill-email-bounces";

// POST /api/bills/email/delivery – read new bounce notices from the billing
// mailbox and record failed deliveries on the bills. Called when the Billing
// List opens (at most every 3 minutes) and by its "Check delivery" button
// ({ "force": true }, at most every 15 seconds).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access || access.listCompanies.length === 0) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  return NextResponse.json(await checkBillEmailDelivery(body?.force === true ? 15 : 180));
}
