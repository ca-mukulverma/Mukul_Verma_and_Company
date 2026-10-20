import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { amountSetterWhere, notifyBillingUsers } from "@/lib/billing";
import { countLabel } from "@/lib/bill-approvals";

const REMINDER_TITLE = "Reminder: bills awaiting your amount";
// The first notice goes out when the bill is sent; reminders start an hour later.
// A little under an hour, so a bill sent just after one run isn't skipped by the next.
const FIRST_REMINDER_AFTER_MS = 55 * 60 * 1000;
// No reminders at night (Indian time): from 9 PM until 8 AM
const QUIET_FROM_HOUR = 21;
const QUIET_UNTIL_HOUR = 8;

// Hourly job (see vercel.json). Reminds each Admin or Partner every hour about
// the bills sent to them for the amount, until they enter it or send it back.
// Vercel Cron calls this with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(new Date())
  );
  if (hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR) {
    return NextResponse.json({ message: "No reminders at night" });
  }

  const bills = await prisma.bill.findMany({
    where: {
      status: "awaiting_amount",
      // Only people who may still enter amounts
      amountRequestedFrom: amountSetterWhere,
    },
    select: {
      amountRequestedFromId: true,
      events: {
        where: { action: "amount_requested" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  // Bills sent at least an hour ago, counted per person
  const cutoff = Date.now() - FIRST_REMINDER_AFTER_MS;
  const counts = new Map<string, number>();
  for (const bill of bills) {
    const sentAt = bill.events[0]?.createdAt;
    if (!bill.amountRequestedFromId || (sentAt && sentAt.getTime() > cutoff)) continue;
    counts.set(bill.amountRequestedFromId, (counts.get(bill.amountRequestedFromId) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return NextResponse.json({ message: "No bills waiting for an amount" });
  }

  await Promise.all(
    [...counts].map(async ([userId, count]) => {
      // Replace the previous reminder instead of piling one up every hour
      await prisma.notification.deleteMany({ where: { sentToId: userId, title: REMINDER_TITLE } });
      await notifyBillingUsers([userId], {
        title: REMINDER_TITLE,
        content: `${countLabel(count)} ${count === 1 ? "is" : "are"} waiting for you to enter the amount. Open Billing to enter ${count === 1 ? "it" : "them"} or send ${count === 1 ? "it" : "them"} back. You will be reminded every hour until then.`,
        sentById: userId,
      });
    })
  );

  return NextResponse.json({ message: `Reminded ${counts.size} user(s)` });
}
