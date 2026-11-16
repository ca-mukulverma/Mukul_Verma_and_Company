import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { BillType } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing";
import { prepareDirectSend, tallyTypesFor } from "@/lib/tally";

const schema = z.object({ type: z.nativeEnum(BillType), billIds: z.array(z.string().min(1)).min(1).max(500) });

// POST /api/billing/tally/send – the import request of each chosen bill and
// the voucher types and ledgers they need, for the Tally extension. Nothing
// is marked as sent here; /send/results records what Tally answered.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose the bills to send" }, { status: 400 });
  const { type, billIds } = parsed.data;
  if (!tallyTypesFor(access).includes(type)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  return NextResponse.json(await prepareDirectSend(type, billIds), { headers: { "Cache-Control": "no-store" } });
}
