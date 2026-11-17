import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { partyName } from "@/lib/compliance";
import { sendInAppNotification } from "@/lib/notifications";
import { GST_BANK_ACCOUNT_DAYS, TASK_KIND_LABELS } from "@/lib/task-kinds";

// Work that follows a completed task (docs/TASKS.md). A completed GST
// registration creates a compulsory "Add bank account in GST" task for the
// same client, company and people, with no bill. Completing the registration
// again (after reopening it) never creates a second one.

const DAY = 86_400_000;
// The status toast can undo a completion for a few seconds (as with bills):
// the people on the new task are told only after that
const UNDO_WINDOW_MS = 10_000;

const BANK_ACCOUNT_CHECKLIST = [
  "Get a cancelled cheque, passbook first page or bank statement with the account holder's name",
  "GST portal → Services → Registration → Amendment of Registration Non-core Fields",
  "Bank Accounts tab: add the account number, type, IFSC and upload the proof",
  "Verification tab: submit with EVC or DSC",
  "Save the ARN in the task and tell the client",
];

export interface FollowOnTask {
  id: string;
  title: string;
}

// Called whenever a task becomes completed. Returns the task created, if any.
export async function createFollowOnTasks(taskId: string, actorId: string): Promise<FollowOnTask | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      kind: true,
      title: true,
      company: true,
      clientId: true,
      assignedById: true,
      client: { select: { contactPerson: true, companyName: true } },
      assignees: { select: { userId: true } },
      followOnTasks: { where: { kind: "GST_BANK_ACCOUNT" }, select: { id: true } },
    },
  });
  if (!task || task.kind !== "GST_REGISTRATION" || task.followOnTasks.length > 0) return null;

  const title = `${TASK_KIND_LABELS.GST_BANK_ACCOUNT}${task.client ? ` – ${partyName(task.client)}` : ""}`.slice(0, 150);
  const dueDate = new Date(Date.now() + GST_BANK_ACCOUNT_DAYS * DAY);
  const description = [
    `GST registration completed ("${task.title}"). The bank account must be added on the GST portal within ${GST_BANK_ACCOUNT_DAYS} days of registration, or before the first GSTR-1 / IFF if that is earlier (Rule 10A).`,
    "",
    ...BANK_ACCOUNT_CHECKLIST.map((step) => `☐ ${step}`),
  ].join("\n");
  const assigneeIds = [...new Set(task.assignees.map((a) => a.userId))];

  let created: FollowOnTask;
  try {
    created = await prisma.$transaction(async (tx) => {
      const row = await tx.task.create({
        data: {
          title,
          description,
          priority: "high",
          status: "pending",
          dueDate,
          company: task.company,
          clientId: task.clientId,
          // Shown as created by whoever created the registration task
          assignedById: task.assignedById,
          kind: "GST_BANK_ACCOUNT",
          billable: false,
          billingStatus: null,
          parentTaskId: task.id,
        },
        select: { id: true, title: true },
      });
      if (assigneeIds.length) {
        await tx.taskAssignee.createMany({ data: assigneeIds.map((userId) => ({ taskId: row.id, userId })) });
      }
      return row;
    });
  } catch (error) {
    // Completed twice at the same moment: the other request created it
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }

  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, UNDO_WINDOW_MS));
    const stillThere = await prisma.task.findUnique({ where: { id: created.id }, select: { id: true } });
    if (!stillThere) return;
    await prisma.activity
      .create({
        data: {
          type: "task",
          action: "created",
          target: created.title,
          details: { taskId: created.id, fromTaskId: task.id, automatic: true },
          userId: actorId,
        },
      })
      .catch((error) => console.error("Failed to log follow-on task:", error));
    const notify = [...new Set([...assigneeIds, task.assignedById])].filter((id) => id !== actorId);
    await Promise.all(
      notify.map((sentToId) =>
        sendInAppNotification({
          title: "New Task Assigned",
          content: `GST registration done: "${created.title}" has been created for you. Add the bank account on the GST portal within ${GST_BANK_ACCOUNT_DAYS} days. [taskId: ${created.id}]`,
          sentById: actorId,
          sentToId,
          taskId: created.id,
        })
      )
    );
  });
  return created;
}

// Called when a completed task is reopened: a follow-on task nobody has
// touched yet (still pending, no comment) goes again, so an undone or
// mistaken completion leaves nothing behind. One that was worked on stays.
export async function withdrawFollowOnTasks(taskId: string) {
  const untouched = await prisma.task.findMany({
    where: {
      parentTaskId: taskId,
      status: "pending",
      lastStatusUpdatedAt: null,
      comments: { none: {} },
      deletionRequests: { none: {} },
    },
    select: { id: true },
  });
  if (untouched.length === 0) return;
  const ids = untouched.map((t) => t.id);
  await prisma.task.deleteMany({ where: { id: { in: ids } } });
  await prisma.notification.deleteMany({ where: { taskId: { in: ids } } });
}
