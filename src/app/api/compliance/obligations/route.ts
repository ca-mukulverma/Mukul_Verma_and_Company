import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addLinesToOpenItems, ensureItemsAround } from "@/lib/compliance";
import { parseMonthKey } from "@/lib/compliance-periods";
import { badRequest, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { obligationSchema } from "@/lib/compliance-schemas";

// POST /api/compliance/obligations – a monthly RCM or TDS payment of a client
// that must not be missed. Any staff member can add one.
export async function POST(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(obligationSchema.extend({ clientId: z.string().min(1) }), await request.json());
  if (body.error) return body.error;
  const data = body.data;
  const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
  if (!client) return notFound("Client not found");
  const fromMonth = parseMonthKey(data.fromMonth)!;
  const toMonth = data.toMonth ? parseMonthKey(data.toMonth) : null;
  if (toMonth && toMonth < fromMonth) return badRequest("The last month is before the first month");

  await prisma.clientObligation.create({
    data: { ...data, fromMonth, toMonth },
  });
  // Every open GSTR-3B / TDS payment period from its first month gets the new line
  await ensureItemsAround(null, undefined, [data.clientId]);
  await addLinesToOpenItems([data.clientId]);
  return NextResponse.json({ ok: true }, { status: 201 });
}
