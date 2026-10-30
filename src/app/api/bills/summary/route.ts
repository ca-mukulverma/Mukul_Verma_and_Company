import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OPEN_RETURN_WHERE, getBillingAccess } from "@/lib/billing";
import { pendingTallyWhere, tallyTypesFor } from "@/lib/tally";

// GET /api/bills/summary – numbers for the dashboard billing card
export async function GET() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tallyTypes = tallyTypesFor(access);
  const [awaitingMyAmount, grouped, returned, awaitingFinalCount, pendingChangeRequests, tallyDueCount] = await Promise.all([
    access.canEnterAmounts
      ? prisma.bill.findMany({
          where: { amountRequestedFromId: user.id, status: "awaiting_amount" },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: {
            id: true,
            company: true,
            description: true,
            client: { select: { contactPerson: true, companyName: true } },
            billToName: true,
          },
        })
      : Promise.resolve([]),
    access.manages.length > 0
      ? prisma.bill.groupBy({
          by: ["company", "status"],
          where: { company: { in: access.manages } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    // Sent back or returned by Admin, waiting for the billing manager
    access.manages.length > 0
      ? prisma.bill.groupBy({
          by: ["company"],
          where: { company: { in: access.manages }, ...OPEN_RETURN_WHERE },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    access.isAdmin ? prisma.bill.count({ where: { status: "manager_approved" } }) : Promise.resolve(0),
    access.manages.length > 0
      ? prisma.billChangeRequest.count({ where: { status: "pending", bill: { company: { in: access.manages } } } })
      : Promise.resolve(0),
    // Numbered bills still to be sent (or sent again) to Tally
    tallyTypes.length > 0
      ? prisma.bill.count({ where: { OR: tallyTypes.map((type) => pendingTallyWhere(type)) } })
      : Promise.resolve(0),
  ]);

  const awaitingMyAmountCount =
    awaitingMyAmount.length < 5
      ? awaitingMyAmount.length
      : await prisma.bill.count({ where: { amountRequestedFromId: user.id, status: "awaiting_amount" } });

  const counts: Record<string, Record<string, number>> = {};
  for (const company of access.manages) counts[company] = {};
  for (const row of grouped) counts[row.company][row.status] = row._count._all;
  for (const row of returned) counts[row.company].returned = row._count._all;

  return NextResponse.json({
    manages: access.manages,
    listCompanies: access.listCompanies,
    listTypes: access.listTypes,
    canEnterAmounts: access.canEnterAmounts,
    isAdmin: access.isAdmin,
    awaitingMyAmount,
    awaitingMyAmountCount,
    counts,
    awaitingFinalCount,
    pendingChangeRequests,
    tallyDueCount,
  });
}
