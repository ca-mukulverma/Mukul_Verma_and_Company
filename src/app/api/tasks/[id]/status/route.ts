import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BillingStatus } from "@prisma/client";
import { z } from "zod";
import { ensureDraftBillForTask, removeUntouchedDraftBillForTask } from "@/lib/billing";
import { notifyTaskStatusChange } from "@/lib/task-notify";
import { TASK_STATUSES } from "@/lib/task-views";

// "Cancelled" is no longer a status to choose: a task that isn't needed is
// deleted (by Admin, or on Admin's approval of a request with a reason).
// `undo` is sent by the toast's Undo button: the change it takes back was
// never announced, so the undo isn't either.
const statusUpdateSchema = z.object({
  status: z.enum(TASK_STATUSES),
  undo: z.boolean().optional(),
});

// PATCH /api/tasks/[id]/status – by Admin, the task's creator or anyone on it
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const currentUser = getSessionUser(await getServerSession(authOptions));
    if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = statusUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose Pending, In progress, Review or Completed" }, { status: 400 });
    const { status, undo } = parsed.data;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        company: true,
        assignedById: true,
        lastStatusUpdatedById: true,
        assignees: { where: { userId: currentUser.id }, select: { userId: true } },
        deletionRequests: { where: { status: "pending" }, select: { id: true } },
      },
    });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const allowed =
      currentUser.role === "ADMIN" ||
      task.assignedById === currentUser.id ||
      task.lastStatusUpdatedById === currentUser.id ||
      task.assignees.length > 0;
    if (!allowed) return NextResponse.json({ error: "You are not on this task" }, { status: 403 });
    if (task.deletionRequests.length) {
      return NextResponse.json({ error: "This task is waiting for Admin to approve its deletion" }, { status: 400 });
    }
    if (status === task.status) return NextResponse.json({ status: task.status });

    const completing = status === "completed";
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        status,
        ...(completing && { billingStatus: BillingStatus.pending_billing }),
        lastStatusUpdatedById: currentUser.id,
        lastStatusUpdatedAt: new Date(),
      },
      select: { status: true, billingStatus: true },
    });

    // Start the bill for this work (docs/BILLING.md), or withdraw it on reopening
    let billStarted = false;
    if (completing) billStarted = await ensureDraftBillForTask(taskId, currentUser.id);
    else if (task.status === "completed") await removeUntouchedDraftBillForTask(taskId);

    if (!undo) {
      after(() =>
        notifyTaskStatusChange({
          taskId,
          title: task.title,
          company: task.company,
          actor: currentUser,
          creatorId: task.assignedById,
          oldStatus: task.status,
          newStatus: status,
          billStarted,
        })
      );
    }
    after(() =>
      prisma.activity
        .create({
          data: {
            type: "task",
            action: "status_changed",
            target: task.title,
            details: { taskId, oldStatus: task.status, newStatus: status, ...(undo && { undo: true }) },
            userId: currentUser.id,
          },
        })
        .catch((error) => console.error("Failed to log status change:", error))
    );

    return NextResponse.json({
      status: updatedTask.status,
      billingStatus: updatedTask.billingStatus,
      lastStatusUpdatedBy: currentUser.name,
    });
  } catch (error) {
    console.error("Error updating task status:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to update task status" }, { status: 500 });
  }
}
