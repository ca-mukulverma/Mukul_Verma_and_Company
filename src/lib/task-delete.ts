import { prisma } from "@/lib/prisma";
import cloudinary from "@/lib/cloudinary";
import { partyName } from "@/lib/compliance";
import { dashboardCache, taskCache } from "@/lib/cache";

// Deleting a task (docs/TASKS.md): Admin deletes at once; anyone else on the
// task asks with a reason and Admin approves or rejects. Either way a line is
// kept in TaskDeletionRequest, so a deleted task can be traced. A task with a
// bill (even a draft) can't be deleted: the bill is dealt with first.

export const taskForDeletion = {
  id: true,
  title: true,
  status: true,
  assignedById: true,
  bill: { select: { id: true, status: true } },
  client: { select: { contactPerson: true, companyName: true } },
  assignees: { select: { userId: true } },
  deletionRequests: { where: { status: "pending" as const }, select: { id: true } },
} as const;

export function deletionBlockedReason(task: { status: string; bill: { status: string } | null }): string | null {
  if (!task.bill) return null;
  if (task.bill.status === "approved") return "This task is billed, so it can't be deleted.";
  return task.status === "completed"
    ? "This task has a bill in Billing. Reopen the task (an untouched draft bill is then removed) or deal with the bill in Billing first."
    : "This task has a bill in Billing. Deal with the bill in Billing first.";
}

export function clientLabel(client: { contactPerson: string; companyName: string | null } | null) {
  return client ? partyName(client).slice(0, 150) : null;
}

// Removes the task with its comments, assignments and reply requests, then
// its comment attachments. The deletion record keeps the title and client.
export async function deleteTaskCompletely(taskId: string) {
  const comments = await prisma.taskComment.findMany({ where: { taskId }, select: { attachments: true } });
  await prisma.task.delete({ where: { id: taskId } });
  // Its notifications would lead nowhere now
  await prisma.notification.deleteMany({ where: { taskId } });

  const publicIds = comments
    .flatMap((comment) => (comment.attachments as { public_id?: string }[] | null) || [])
    .map((attachment) => attachment?.public_id)
    .filter((id): id is string => !!id);
  if (publicIds.length > 0) {
    await cloudinary.api.delete_resources(publicIds).catch((error: unknown) =>
      console.error("Failed to delete task attachments:", error)
    );
  }
  await Promise.all([taskCache.delete(`task:${taskId}`), dashboardCache.invalidate("*")]).catch(() => undefined);
}
