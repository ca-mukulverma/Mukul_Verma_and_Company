import { NextResponse } from "next/server";
import {
  isAuthorizedCron,
  runBillingEmailDelivery,
  runCleanupNotifications,
  runCompliance,
  runDailyDigest,
  runStep,
} from "@/lib/cron-jobs";

export const maxDuration = 60;

// The one daily background job (see vercel.json: 06:28 UTC = 11:58 AM India
// time, Sundays included).
//
// Why one job: separate crons at 06:00, 07:00, 10:30 and 12:00 IST each woke
// the Neon database on their own, and every wake bills at least 5 minutes of
// compute. Running them together, inside office hours when the database is
// usually already awake, costs at most one short wake a day.
//
// Order: the jobs people see first (new compliance periods, then each
// person's daily digest of tasks, compliance and billing), then
// housekeeping, then the mailbox check (slowest, talks to IMAP) last. Each step
// is isolated: one failing does not stop the rest.
//
// Vercel Cron calls this with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sequential on purpose: one database connection, predictable run time.
  const steps = [
    // New periods first, so the digest counts them
    await runStep("compliance", runCompliance),
    await runStep("daily-digest", runDailyDigest),
    await runStep("cleanup-notifications", runCleanupNotifications),
    await runStep("billing-email-delivery", runBillingEmailDelivery),
  ];

  const failed = steps.filter((s) => !s.ok).map((s) => s.step);
  return NextResponse.json(
    { ok: failed.length === 0, failed, steps },
    { status: failed.length === 0 ? 200 : 500 }
  );
}
