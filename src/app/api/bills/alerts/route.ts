import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";
import { everyonesPendingWork, labelForOthers, pendingBillingWork } from "@/lib/billing-pending";

// GET /api/bills/alerts – the red alert on the dashboard: the user's billing
// work waiting more than 3 days, and for Admin everyone else's too; and
// whether the user gets phone notifications at all
export async function GET() {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const billingRole = access.isAdmin || access.manages.length > 0 || access.canEnterAmounts;
  if (!billingRole) return NextResponse.json({ billingRole, mine: [], others: [], pushEnabled: true });

  const [mine, everyone, devices] = await Promise.all([
    pendingBillingWork(access),
    access.isAdmin ? everyonesPendingWork() : Promise.resolve([]),
    prisma.pushSubscription.count({ where: { userId: user.id } }),
  ]);
  const others = everyone
    .filter((p) => p.userId !== user.id)
    .map((p) => ({ name: p.name, groups: p.groups.filter((g) => g.overdue > 0).map((g) => ({ ...g, label: labelForOthers(g.label) })) }))
    .filter((p) => p.groups.length > 0);

  return NextResponse.json({ billingRole, mine, others, pushEnabled: devices > 0 });
}
