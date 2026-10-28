import { deleteOldNotifications, NOTIFICATION_RETENTION_DAYS } from "@/lib/notifications";
import { pruneOldBillHistory } from "@/lib/billing";
import { ensureItemsAround, resolveTdsReturns } from "@/lib/compliance";
import { checkBillEmailDelivery } from "@/lib/bill-email-bounces";
import { sendDailyBillingReminders } from "@/lib/billing-pending";
import { sendDailyDigests } from "@/lib/daily-digest";

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
 * Creates the coming periods' compliance items and settles TDS returns of
 * quarters without challans. What each team member has due goes into their
 * daily digest (runDailyDigest).
 */
export async function runCompliance() {
  await ensureItemsAround(null);
  await resolveTdsReturns();
  return { message: "Items created" };
}

/**
 * Each staff member's morning summary in one notification: their tasks,
 * compliance work and billing work. The single notifications (task assigned,
 * bill awaiting your amount …) still go out as things happen; this is the
 * overview on top. Admins also get the separate billing escalation.
 */
export async function runDailyDigest() {
  return sendDailyDigests();
}

/** Reads bounce notices from the billing mailbox so failed bill emails are recorded. */
export async function runBillingEmailDelivery() {
  return checkBillEmailDelivery(60);
}

/**
 * Billing reminders on their own (each person's pending work and the
 * escalation to Admin). The daily job sends these inside the digest instead.
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
