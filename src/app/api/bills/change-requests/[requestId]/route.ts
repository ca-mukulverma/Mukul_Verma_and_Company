import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { decideChangeRequest } from "@/lib/bill-approvals";

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  remark: z.string().trim().max(1000).optional(),
});

// POST /api/bills/change-requests/:requestId – Admin approves or rejects
export async function POST(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only Admin can approve changes to approved bills" }, { status: 403 });
  }

  const parsed = decisionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const error = await decideChangeRequest(
    (await params).requestId,
    parsed.data.decision === "approve",
    parsed.data.remark || null,
    user
  );
  if (error) return NextResponse.json({ error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
