import { prisma } from "@/lib/prisma";
import { deleteOldNotifications, NOTIFICATION_RETENTION_DAYS, sendInAppNotification } from "@/lib/notifications";
import { pruneOldBillHistory } from "@/lib/billing";
import { ensureItemsAround, resolveTdsReturns } from "@/lib/compliance";
import { todayIST } from "@/lib/compliance-periods";
import { checkBillEmailDelivery } from "@/lib/bill-email-bounces";
import { sendDailyBillingReminders } from "@/lib/billing-pending";

/**
 * The daily background jobs, as plain functions.
 *
 * Why they live here: each job used to be its own Vercel cron, and every cron
 * that fired at a different time woke the Neon database separately (each wake
 * bills at least 5 minutes of compute). They now run together from
 * /api/cron/daily, once a day, inside office hours when the database is
 * usually awake anyway. The individual /api/cron/* routes still call these
 * functions, so any job can still be triggered on its own by hand.
 */

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Removes old notifications and the workflow steps of bills over a year old. */
export async function runCleanupNotifications() {
  const deletedCount = await deleteOldNotifications();
  const billHistoryDeleted = await pruneOldBillHistory();
  return {
    message: `Deleted notifications older than ${NOTIFICATION_RETENTION_DAYS} days`,
    deletedCount,
    billHistoryDeleted,
  };
}

/**
 * Creates the coming periods' compliance items, settles TDS returns of
 * quarters without challans, and sends each team member one short summary of
 * what is due and overdue in their works.
 */
export async function runCompliance() {
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
  if (!admin || members.length === 0) return { message: "Items created; no teams to notify" };

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

  return { message: `Items created; ${notified} team member(s) notified` };
}

/** Reads bounce notices from the billing mailbox so failed bill emails are recorded. */
export async function runBillingEmailDelivery() {
  return checkBillEmailDelivery(60);
}

/**
 * Everyone with pending billing work gets a push and in-app notification
 * listing it; work waiting more than 3 days is also sent to Admin. From the
 * 25th, Admin is reminded that bills are dated on the day of final approval.
 */
export async function runBillingReminders() {
  const { reminded, escalated } = await sendDailyBillingReminders();
  return { message: `Reminded ${reminded} person(s); ${escalated} with work over 3 days sent to Admin` };
}

/** Runs one job, timing it and keeping its failure from stopping the others. */
export async function runStep<T>(name: string, job: () => Promise<T>) {
  const started = Date.now();
  try {
    const result = await job();
    return { step: name, ok: true as const, ms: Date.now() - started, result };
  } catch (error) {
    console.error(`Daily job step "${name}" failed:`, error);
    return { step: name, ok: false as const, ms: Date.now() - started, error: String(error) };
  }
}
