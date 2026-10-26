import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partyName } from "@/lib/compliance";
import { addMonths, todayIST, utcDate } from "@/lib/compliance-periods";
import { emailsSentToday, GMAIL_DAILY_LIMIT } from "@/lib/compliance-email";
import { requireComplianceAccess } from "@/lib/compliance-api";
import { billingEmailConfigured } from "@/lib/bill-email";
import { r2Configured } from "@/lib/r2";

// GET /api/compliance/overview – counts per work, and for Admins and Partners
// the notes from Claude's nightly review
export async function GET() {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;

  const today = todayIST();
  const inAWeek = new Date(today.getTime() + 7 * 86_400_000);
  const monthStart = utcDate(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const open = { in: ["pending", "data_received"] as ("pending" | "data_received")[] };

  const [workTypes, overdue, dueSoon, pending, dataReceived, filed, completed, notes, sentToday] = await Promise.all([
    prisma.complianceWorkType.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, kind: true, frequency: true, team: { where: { toDate: null }, select: { user: { select: { name: true } } } } },
    }),
    prisma.complianceItem.groupBy({ by: ["workTypeId"], where: { status: open, historical: false, dueDate: { lt: today } }, _count: true }),
    prisma.complianceItem.groupBy({ by: ["workTypeId"], where: { status: open, historical: false, dueDate: { gte: today, lte: inAWeek } }, _count: true }),
    prisma.complianceItem.groupBy({ by: ["workTypeId"], where: { status: "pending", historical: false, periodEnd: { gte: addMonths(monthStart, -12) } }, _count: true }),
    prisma.complianceItem.groupBy({ by: ["workTypeId"], where: { status: "data_received", historical: false }, _count: true }),
    prisma.complianceItem.groupBy({ by: ["workTypeId"], where: { status: "filed", historical: false }, _count: true }),
    prisma.complianceItem.groupBy({ by: ["workTypeId"], where: { status: "completed", completedAt: { gte: monthStart } }, _count: true }),
    access.isManager
      ? prisma.complianceNote.findMany({
          orderBy: { createdAt: "desc" },
          take: 40,
          select: { id: true, body: true, createdAt: true, client: { select: { id: true, contactPerson: true, companyName: true } } },
        })
      : Promise.resolve([]),
    emailsSentToday(),
  ]);

  const count = (rows: { workTypeId: string; _count: number }[], id: string) => rows.find((r) => r.workTypeId === id)?._count ?? 0;
  return NextResponse.json({
    isManager: access.isManager,
    works: workTypes.map((wt) => ({
      id: wt.id,
      name: wt.name,
      kind: wt.kind,
      frequency: wt.frequency,
      team: wt.team.map((t) => t.user.name),
      mine: access.teamWorkTypeIds.has(wt.id),
      overdue: count(overdue, wt.id),
      dueSoon: count(dueSoon, wt.id),
      pending: count(pending, wt.id),
      dataReceived: count(dataReceived, wt.id),
      docsPending: count(filed, wt.id),
      completedThisMonth: count(completed, wt.id),
    })),
    notes: notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString(), client: n.client ? { id: n.client.id, name: partyName(n.client) } : null })),
    email: { sentToday, limit: GMAIL_DAILY_LIMIT, mvc: billingEmailConfigured("MVC"), bedge: billingEmailConfigured("BEDGE") },
    storageReady: r2Configured(),
  });
}
