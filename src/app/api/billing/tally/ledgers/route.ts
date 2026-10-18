import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";

const schema = z.object({
  clientId: z.string().min(1),
  // Empty: use the client's name
  tallyLedgerName: z.string().trim().max(100),
});

// PUT /api/billing/tally/ledgers – the client's party ledger name in Tally (billing managers)
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getBillingAccess(user.id);
  if (!access || access.manages.length === 0) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid ledger name" }, { status: 400 });

  const client = await prisma.client.update({
    where: { id: parsed.data.clientId },
    data: { tallyLedgerName: parsed.data.tallyLedgerName || null },
    select: { id: true, contactPerson: true, companyName: true, tallyLedgerName: true },
  }).catch(() => null);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(client);
}
