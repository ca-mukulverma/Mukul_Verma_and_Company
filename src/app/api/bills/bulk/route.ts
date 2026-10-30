import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing";
import { MVC_BILL_TYPES } from "@/lib/billing-constants";
import { finalApprove, managerApprove } from "@/lib/bill-approvals";
import { requestAmounts, setBillTypes } from "@/lib/bill-steps";

const ids = z.array(z.string().min(1)).min(1).max(100);
const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("manager_approve"), ids }),
  z.object({ action: z.literal("final_approve"), ids }),
  z.object({ action: z.literal("set_type"), ids, type: z.enum(MVC_BILL_TYPES) }),
  z.object({ action: z.literal("request_amount"), ids, userId: z.string().min(1), remark: z.string().trim().max(1000).optional() }),
]);

// POST /api/bills/bulk – approve, set the type of, or send for the amount
// several bills at once
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bulkSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Select up to 100 bills" }, { status: 400 });
  const input = parsed.data;
  const { action } = input;
  const uniqueIds = [...new Set(input.ids)];

  if (input.action === "set_type" || input.action === "request_amount") {
    if (access.manages.length === 0) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    if (input.action === "set_type") return NextResponse.json(await setBillTypes(uniqueIds, input.type, user, access));
    const result = await requestAmounts(uniqueIds, input.userId, user, access, input.remark);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  }

  if (action === "manager_approve") {
    if (access.manages.length === 0) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    return NextResponse.json(await managerApprove(uniqueIds, user, access));
  }

  if (!access.isAdmin) return NextResponse.json({ error: "Only Admin gives final approval" }, { status: 403 });
  return NextResponse.json(await finalApprove(uniqueIds, user));
}
