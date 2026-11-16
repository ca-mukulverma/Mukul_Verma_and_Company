import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { BillType } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing";
import { recordDirectResults, tallyTypesFor } from "@/lib/tally";

const schema = z.object({
  type: z.nativeEnum(BillType),
  results: z
    .array(
      z.object({
        billId: z.string().min(1),
        version: z.string().min(1),
        ok: z.boolean(),
        error: z.string().max(2000).optional(),
      })
    )
    .min(1)
    .max(500),
});

// POST /api/billing/tally/send/results – what Tally answered for bills sent
// straight into it by the Tally extension; sent after each bill
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid results" }, { status: 400 });
  const { type, results } = parsed.data;
  if (!tallyTypesFor(access).includes(type)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const recorded = await recordDirectResults(type, user.id, results);
  return NextResponse.json({ recorded });
}
