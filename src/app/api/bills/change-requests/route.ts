import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";

// GET /api/bills/change-requests – pending edit/cancel/reissue requests.
// Admin sees all; billing managers see their own company's.
export async function GET() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access || access.manages.length === 0) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const requests = await prisma.billChangeRequest.findMany({
    where: { status: "pending", bill: { company: { in: access.manages } } },
    orderBy: { createdAt: "asc" },
    include: {
      requestedBy: { select: { id: true, name: true } },
      bill: {
        select: {
          id: true,
          company: true,
          type: true,
          billNumber: true,
          billDate: true,
          amount: true,
          description: true,
          workDate: true,
          client: { select: { id: true, contactPerson: true, companyName: true } },
          billToName: true,
        },
      },
    },
  });

  // Names of the clients that reissue requests would move bills to
  const newClientIds = requests
    .map((r) => (r.changes as { clientId?: string } | null)?.clientId)
    .filter((id): id is string => !!id);
  const newClients = newClientIds.length
    ? await prisma.client.findMany({
        where: { id: { in: newClientIds } },
        select: { id: true, contactPerson: true, companyName: true },
      })
    : [];

  return NextResponse.json({
    requests: requests.map((r) => ({
      ...r,
      bill: { ...r.bill, amount: r.bill.amount !== null ? Number(r.bill.amount) : null },
      newClient: newClients.find((c) => c.id === (r.changes as { clientId?: string } | null)?.clientId) ?? null,
    })),
  });
}
