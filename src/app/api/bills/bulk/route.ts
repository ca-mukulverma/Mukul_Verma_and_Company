import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing";
import { finalApprove, managerApprove } from "@/lib/bill-approvals";

const bulkSchema = z.object({
  action: z.enum(["manager_approve", "final_approve"]),
  ids: z.array(z.string().min(1)).min(1).max(100),
});

// POST /api/bills/bulk – approve several bills at once
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bulkSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Select up to 100 bills" }, { status: 400 });
  const { action, ids } = parsed.data;
  const uniqueIds = [...new Set(ids)];

  if (action === "manager_approve") {
    if (access.manages.length === 0) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    return NextResponse.json(await managerApprove(uniqueIds, user, access));
  }

  if (!access.isAdmin) return NextResponse.json({ error: "Only Admin gives final approval" }, { status: 403 });
  return NextResponse.json(await finalApprove(uniqueIds, user));
}
