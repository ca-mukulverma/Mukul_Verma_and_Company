import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendInAppNotification } from "@/lib/notifications";
import { deleteTaskCompletely, deletionBlockedReason, taskForDeletion } from "@/lib/task-delete";

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional(),
});

// PATCH /api/tasks/deletion-requests/[requestId] { decision, note? } – Admin
// approves (the task is deleted) or rejects (the task goes back to work; an
// old cancelled task becomes Pending). The person who asked is told.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const currentUser = getSessionUser(await getServerSession(authOptions));
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (currentUser.role !== "ADMIN") return NextResponse.json({ error: "Only Admin decides deletions" }, { status: 403 });

  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Approve or reject" }, { status: 400 });
  const { decision } = parsed.data;
  const note = parsed.data.note || null;

  const deletion = await prisma.taskDeletionRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, taskId: true, taskTitle: true, requestedById: true },
  });
  if (!deletion || deletion.status !== "pending") {
    return NextResponse.json({ error: "This request has already been decided" }, { status: 400 });
  }
  const taskId = deletion.taskId;
  const task = taskId ? await prisma.task.findUnique({ where: { id: taskId }, select: taskForDeletion }) : null;

  const now = new Date();
  try {
    if (decision === "approve" && task) {
      const blocked = deletionBlockedReason(task);
      if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
    }
    const { count } = await prisma.taskDeletionRequest.updateMany({
      where: { id: requestId, status: "pending" },
      data: { status: decision === "approve" ? "approved" : "rejected", decidedById: currentUser.id, decidedAt: now, decisionNote: note },
    });
    if (count === 0) return NextResponse.json({ error: "This request has already been decided" }, { status: 400 });

    if (task && decision === "approve") {
      await deleteTaskCompletely(task.id);
    } else if (task && decision === "reject" && task.status === "cancelled") {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "pending", lastStatusUpdatedById: currentUser.id, lastStatusUpdatedAt: now },
      });
    }
  } catch (error) {
    console.error("Failed to decide task deletion:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not save the decision" }, { status: 500 });
  }

  after(async () => {
    await prisma.activity
      .create({
        data: {
          type: "task",
          action: decision === "approve" ? "deleted" : "deletion_rejected",
          target: deletion.taskTitle,
          details: { taskId, requestId, note },
          userId: currentUser.id,
        },
      })
      .catch((error) => console.error("Failed to log deletion decision:", error));
    if (deletion.requestedById === currentUser.id) return;
    await sendInAppNotification({
      title: decision === "approve" ? "Task deleted" : "Task deletion rejected",
      content:
        decision === "approve"
          ? `${currentUser.name} approved deleting "${deletion.taskTitle}".${note ? ` Note: ${note}` : ""}`
          : `${currentUser.name} kept "${deletion.taskTitle}"; it is back in the task list.${note ? ` Note: ${note}` : ""}${taskId ? ` [taskId: ${taskId}]` : ""}`,
      sentById: currentUser.id,
      sentToId: deletion.requestedById,
      ...(decision === "reject" && taskId ? { taskId } : {}),
    });
  });

  return NextResponse.json({ success: true });
}
