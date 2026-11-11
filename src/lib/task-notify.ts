import { Company } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendInAppNotification } from "@/lib/notifications";
import { getBillingManagerIds } from "@/lib/billing";

// Task notifications, one per person per action (docs/TASKS.md). Each goes to
// the bell and as a push notification; nothing is emailed or sent on WhatsApp.
//
// Before, a status change sent "Task Status Updated" to the creator and
// "Task Updated" to every Admin, and a completion also "ready for billing" to
// the billing managers, so one click could reach a person three times. A
// comment reached an Admin on the task twice.

// A status change can be undone from the toast for a few seconds; it is only
// announced once that time has passed and the task still has the new status
// (the same wait as the bill's "ready for billing" notification)
export const STATUS_NOTIFY_DELAY_MS = 10_000;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  review: "Review",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

async function activeAdminIds() {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  return admins.map((a) => a.id);
}

// The task's creator and the Admins hear about a status change. When the task
// is completed and its bill was just started, the billing managers (Admins
// among them) get only the "ready for billing" notification, which already
// says who completed it.
export async function notifyTaskStatusChange(input: {
  taskId: string;
  title: string;
  company: Company;
  actor: { id: string; name: string };
  creatorId: string;
  oldStatus: string;
  newStatus: string;
  billStarted: boolean;
}) {
  try {
    await new Promise((resolve) => setTimeout(resolve, STATUS_NOTIFY_DELAY_MS));
    const current = await prisma.task.findUnique({ where: { id: input.taskId }, select: { status: true } });
    // Undone (or changed again) in the meantime: the later change speaks for itself
    if (!current || current.status !== input.newStatus) return;

    const [admins, managers] = await Promise.all([
      activeAdminIds(),
      input.newStatus === "completed" && input.billStarted ? getBillingManagerIds(input.company) : Promise.resolve([] as string[]),
    ]);
    const recipients = new Set([input.creatorId, ...admins]);
    recipients.delete(input.actor.id);
    for (const id of managers) recipients.delete(id);

    const completed = input.newStatus === "completed";
    const title = completed ? "Task completed" : "Task status changed";
    const content = completed
      ? `${input.actor.name} completed "${input.title}" [taskId: ${input.taskId}]`
      : `${input.actor.name} moved "${input.title}" from ${statusLabel(input.oldStatus)} to ${statusLabel(input.newStatus)} [taskId: ${input.taskId}]`;

    await Promise.all(
      [...recipients].map((sentToId) =>
        sendInAppNotification({ title, content, sentById: input.actor.id, sentToId, taskId: input.taskId })
      )
    );
  } catch (error) {
    console.error("Failed to send task status notifications:", error);
  }
}

// A new comment: the creator, everyone on the task and the Admins, once each.
// Those asked for a reply get "Reply needed" instead of "New comment".
export async function notifyTaskComment(input: {
  taskId: string;
  title: string;
  actor: { id: string; name: string };
  creatorId: string;
  assigneeIds: string[];
  content: string;
  replyFrom: string[];
}) {
  try {
    const admins = await activeAdminIds();
    const recipients = new Set([input.creatorId, ...input.assigneeIds, ...admins]);
    recipients.delete(input.actor.id);
    const excerpt = input.content.trim() ? `"${input.content.trim().slice(0, 300)}"` : "(an attachment)";
    const replyFrom = new Set(input.replyFrom);

    await Promise.all(
      [...recipients].map((sentToId) =>
        sendInAppNotification({
          title: replyFrom.has(sentToId) ? "Reply needed" : "New comment",
          content: replyFrom.has(sentToId)
            ? `${input.actor.name} asks you to reply on "${input.title}": ${excerpt} [taskId: ${input.taskId}]`
            : `${input.actor.name} on "${input.title}": ${excerpt} [taskId: ${input.taskId}]`,
          sentById: input.actor.id,
          sentToId,
          taskId: input.taskId,
        })
      )
    );
  } catch (error) {
    console.error("Failed to send comment notifications:", error);
  }
}

// Opening a task (or replying to it) clears its notifications from the bell
export async function markTaskNotificationsRead(userId: string, taskId: string) {
  try {
    await prisma.notification.updateMany({ where: { sentToId: userId, taskId, isRead: false }, data: { isRead: true } });
  } catch (error) {
    console.error("Failed to mark task notifications read:", error);
  }
}
