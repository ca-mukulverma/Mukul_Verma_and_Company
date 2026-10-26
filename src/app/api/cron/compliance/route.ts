import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureItemsAround, resolveTdsReturns } from "@/lib/compliance";
import { todayIST } from "@/lib/compliance-periods";
import { sendInAppNotification } from "@/lib/notifications";

// Daily job (see vercel.json): creates the coming periods' compliance items,
// settles TDS returns of quarters without challans, and sends each team member
// one short summary of what is due and overdue in their works.
// Vercel Cron calls this with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureItemsAround(null);
  await resolveTdsReturns();

  const today = todayIST();
  const soon = new Date(today.getTime() + 3 * 86_400_000);
  const [members, admin] = await Promise.all([
    prisma.complianceTeamMember.findMany({
      where: { toDate: null, user: { isActive: true } },
      select: { userId: true, workTypeId: true },
    }),
    prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } }),
  ]);
  if (!admin || members.length === 0) return NextResponse.json({ message: "Items created; no teams to notify" });

  const open = { in: ["pending", "data_received"] as ("pending" | "data_received")[] };
  const [overdue, dueSoon, docsPending] = await Promise.all([
    prisma.complianceItem.groupBy({ by: ["workTypeId"], where: { status: open, historical: false, dueDate: { lt: today } }, _count: true }),
    prisma.complianceItem.groupBy({ by: ["workTypeId"], where: { status: open, historical: false, dueDate: { gte: today, lte: soon } }, _count: true }),
    prisma.complianceItem.groupBy({ by: ["workTypeId"], where: { status: "filed", historical: false }, _count: true }),
  ]);
  const sumFor = (rows: { workTypeId: string; _count: number }[], ids: string[]) =>
    rows.filter((r) => ids.includes(r.workTypeId)).reduce((s, r) => s + r._count, 0);

  const byUser = new Map<string, string[]>();
  for (const m of members) byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m.workTypeId]);

  let notified = 0;
  for (const [userId, workTypeIds] of byUser) {
    const o = sumFor(overdue, workTypeIds);
    const d = sumFor(dueSoon, workTypeIds);
    const p = sumFor(docsPending, workTypeIds);
    if (o + d + p === 0) continue;
    const parts = [
      d && `${d} due in the next 3 days`,
      o && `${o} overdue`,
      p && `${p} filed but waiting for files or steps`,
    ].filter(Boolean);
    await sendInAppNotification({
      title: "Compliance work today",
      content: `Your compliance work: ${parts.join(", ")}. Open Compliance to see the sheets.`,
      sentById: admin.id,
      sentToId: userId,
    });
    notified++;
  }

  return NextResponse.json({ message: `Items created; ${notified} team member(s) notified` });
}
