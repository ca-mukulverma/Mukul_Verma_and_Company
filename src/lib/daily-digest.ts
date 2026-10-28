import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";
import { getMyWork, MyWork } from "@/lib/my-work";
import { billingDigestText, PersonPending, sendBillingEscalations } from "@/lib/billing-pending";

// The daily digest: one notification per staff member with what is waiting
// for them today, from Tasks, Compliance and Billing. It replaces the separate
// compliance summary and billing reminder (three notifications became one).
// Single notifications (a task assigned, a bill sent for your amount …) are
// not affected and still arrive as things happen.

export function digestLines(work: MyWork, billingText: string | null) {
  const c = work.counts;
  const lines: string[] = [];

  const tasks = [
    c.tasksOverdue && `${c.tasksOverdue} overdue`,
    c.tasksDueToday && `${c.tasksDueToday} due today`,
  ].filter(Boolean);
  if (tasks.length) lines.push(`Tasks: ${tasks.join(", ")} (${c.tasksOpen} open in all)`);
  else if (c.tasksOpen) lines.push(`Tasks: ${c.tasksOpen} open`);

  const compliance = [
    c.complianceOverdue && `${c.complianceOverdue} overdue`,
    c.complianceDueSoon && `${c.complianceDueSoon} due in the next 3 days`,
    c.complianceWaitingFiles && `${c.complianceWaitingFiles} filed but waiting for files or steps`,
  ].filter(Boolean);
  if (compliance.length) lines.push(`Compliance: ${compliance.join(", ")}`);

  if (billingText) lines.push(`Billing: ${billingText}`);
  return lines;
}

export async function sendDailyDigests(now = new Date()) {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const sender = users.find((u) => u.role === "ADMIN")?.id;
  if (!sender) return { message: "No active Admin to send from", sent: 0, escalated: 0 };

  let sent = 0;
  // Everyone's pending billing work, for the escalation to Admin afterwards
  const billingPeople: PersonPending[] = [];
  // One person at a time: one database connection, predictable run time
  for (const user of users) {
    const work = await getMyWork(user.id, now);
    const billingPerson = { userId: user.id, name: user.name, groups: work.billing };
    if (work.billing.length) billingPeople.push(billingPerson);
    const billing = work.billing.length ? billingDigestText(billingPerson, now) : null;
    const lines = digestLines(work, billing?.text ?? null);
    if (lines.length === 0) continue;

    const total =
      work.counts.tasksOverdue +
      work.counts.tasksDueToday +
      work.counts.complianceOverdue +
      work.counts.complianceDueSoon +
      (billing?.total ?? 0);
    const title = total > 0 ? `Your day: ${total} thing${total === 1 ? "" : "s"} need you` : "Your day";
    const content = `${lines.join(". ")}. Open My work to see them.`;

    try {
      await prisma.notification.create({ data: { title, content, sentById: sender, sentToId: user.id } });
    } catch (error) {
      console.error("Failed to save daily digest:", error);
    }
    await sendPushToUser(user.id, { title, body: content, url: "/dashboard/my-work", tag: "daily-digest" });
    sent++;
  }

  const escalated = await sendBillingEscalations(billingPeople);
  return { message: `Digest sent to ${sent} person(s); ${escalated} with billing work over 3 days sent to Admin`, sent, escalated };
}
