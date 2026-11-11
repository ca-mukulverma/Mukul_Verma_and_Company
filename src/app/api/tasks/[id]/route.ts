import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendTaskAllotmentNotifications, sendTaskUpdatedNotificationToAdmins } from "@/lib/notifications";
import { z } from "zod";
import { syncTaskAssignments } from "@/lib/task-assignment";
import { dashboardCache, taskCache, clientCache } from "@/lib/cache";
import { ensureDraftBillForTask, removeUntouchedDraftBillForTask, syncBillCompanyForTask } from "@/lib/billing";
import { markTaskNotificationsRead, notifyTaskStatusChange } from "@/lib/task-notify";
import { TASK_STATUSES } from "@/lib/task-views";
import { clientLabel, deleteTaskCompletely, deletionBlockedReason, taskForDeletion } from "@/lib/task-delete";

// Task update schema
const taskUpdateSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").optional(),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: z.string().optional().nullable(),
  // Add support for array of assignees
  assignedToIds: z.array(z.string()).optional(),
  // Keep for backward compatibility
  assignedToId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  company: z.enum(["MVC", "BEDGE"]).optional(),
  note: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const taskId = resolvedParams.id;
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get current user
    const currentUser = getSessionUser(session);

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch the task with related data, including all assignees
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatar: true,
          },
        },
        lastStatusUpdatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatar: true,
          },
        },
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatar: true,
              },
            },
          },
        },
        client: {
          select: {
            id: true,
            contactPerson: true,
            companyName: true,
          },
        },
        bill: { select: { status: true } },
        deletionRequests: {
          where: { status: "pending" },
          select: { id: true, reason: true, createdAt: true, requestedBy: { select: { id: true, name: true } } },
        },
        // Comments here that wait for this person's reply
        replyRequests: {
          where: { userId: currentUser.id, resolvedAt: null },
          select: { createdAt: true, requestedBy: { select: { name: true } }, comment: { select: { content: true } } },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if user has permission to view this task
    const canViewTask =
      currentUser.role === "ADMIN" || // Admin can view any task
      task.assignedById === currentUser.id || // Creator can view their tasks
      task.lastStatusUpdatedById === currentUser.id || // Last updater can view
      task.assignees.some(a => a.userId === currentUser.id) || // Assignee can view
      // Partners who see everyone's Work Done can open the completed tasks listed there
      (currentUser.role === "PARTNER" &&
        task.status === "completed" &&
        !!(await prisma.user.findUnique({ where: { id: currentUser.id }, select: { canViewWorkDone: true } }))
          ?.canViewWorkDone);

    if (!canViewTask) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // The task page asks for the comments in the same request (?include=comments)
    // to save a second round trip; comments use the same permission check as above
    if (request.nextUrl.searchParams.get("include") === "comments") {
      // Opening the task clears its notifications from the bell
      after(() => markTaskNotificationsRead(currentUser.id, taskId));
      const comments = await prisma.taskComment.findMany({
        where: { taskId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });
      return NextResponse.json({ ...task, comments });
    }

    return NextResponse.json(task);
  } catch (error) {
    console.error("Error fetching task:", error);
    return NextResponse.json(
      { error: "Failed to fetch task" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const taskId = resolvedParams.id;

    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const currentUser = getSessionUser(session);

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch the task first, before using it in permission checks
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignees: {
          include: {
            user: true
          }
        }
      }
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const pendingDeletion = await prisma.taskDeletionRequest.findFirst({ where: { taskId, status: "pending" }, select: { id: true } });
    if (pendingDeletion) {
      return NextResponse.json({ error: "This task is waiting for Admin to approve its deletion" }, { status: 400 });
    }

    // Maintain original permission checks
    if (currentUser.role !== "ADMIN") {
      // Partners can update the status of any task
      if (currentUser.role === "PARTNER" && Object.keys(body).length === 1 && body.hasOwnProperty("status")) {
        // This is allowed - only updating status
      }
      // Partners can update tasks they created
      else if (currentUser.role === "PARTNER" && task.assignedById === currentUser.id) {
        // This is allowed - partner is updating their own task
      }
      // Junior staff can only update status
      else if (Object.keys(body).length > 1 || !body.hasOwnProperty("status")) {
        return NextResponse.json(
          { error: "You can only update the task status" },
          { status: 403 }
        );
      }
    }

    // Validate update data
    try {
      taskUpdateSchema.parse(body);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return NextResponse.json({ error: validationError.errors }, { status: 400 });
      }
    }

    const originalTask = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!originalTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Moving a task between MVC and B Edge moves its bill too, unless the
    // bill has already been approved
    if (body.company && body.company !== originalTask.company) {
      const synced = await syncBillCompanyForTask(taskId, body.company, currentUser.id);
      if (!synced) {
        return NextResponse.json(
          { error: "The bill for this task is already approved, so the company can't be changed" },
          { status: 400 }
        );
      }
    }

    // Use a transaction to update everything atomically
    const updatedTask = await prisma.$transaction(async (tx) => {
      // Extract assignedToIds from body and remove it
      const { assignedToIds, assignedToId, ...updateData } = body;

      // If we're updating status, also update the lastStatusUpdatedBy fields
    if (updateData.status && updateData.status !== task.status) {
      updateData.lastStatusUpdatedById = currentUser.id;
      updateData.lastStatusUpdatedAt = new Date();
    }
      
      // Update the task without any assignment fields
      const updated = await tx.task.update({
        where: { id: taskId },
        data: updateData,
      });
      
      // If assignedToIds is provided, update the task assignments
      if (assignedToIds && Array.isArray(assignedToIds)) {
        return syncTaskAssignments(tx, taskId, assignedToIds);
      }
      // For backward compatibility, handle the legacy assignedToId
      else if (assignedToId) {
        return syncTaskAssignments(tx, taskId, [assignedToId]);
      }
      
      // If no assignment updates, just return the updated task
      return updated;
    });

    // Start or withdraw the bill when the task is completed or reopened
    let billStarted = false;
    if (body.status && body.status !== originalTask.status) {
      if (body.status === "completed") {
        billStarted = await ensureDraftBillForTask(taskId, currentUser.id);
      } else if (originalTask.status === "completed") {
        await removeUntouchedDraftBillForTask(taskId);
      }
    }

    // Log the activity
    await prisma.activity.create({
      data: {
        type: "task",
        action: "updated",
        target: task.title,
        details: { taskId: task.id },
        userId: currentUser.id,
      },
    });

    // Work out whether the assignees changed by comparing with the ones loaded
    // before the update (re-reading them now would already include the new ones)
    const previousAssigneeIds = task.assignees.map((a) => a.userId);
    const assignmentRequested = Array.isArray(body.assignedToIds) || !!body.assignedToId;
    const requestedAssigneeIds: string[] = Array.isArray(body.assignedToIds)
      ? body.assignedToIds
      : (body.assignedToId ? [body.assignedToId] : []);
    const assigneesChanged =
      assignmentRequested &&
      (requestedAssigneeIds.some((id) => !previousAssigneeIds.includes(id)) ||
        previousAssigneeIds.some((id) => !requestedAssigneeIds.includes(id)));
    const statusChanged = body.status && body.status !== originalTask.status;

    // Send notifications after the response so the user isn't kept waiting:
    // a change of assignees and a change of status each tell everyone
    // concerned once; any other edit tells the Admins
    after(() =>
      Promise.all([
        assigneesChanged
          ? sendTaskAllotmentNotifications({
              taskId: originalTask.id,
              taskTitle: originalTask.title,
              actor: currentUser,
              creatorId: originalTask.assignedById,
              previousAssigneeIds,
              newAssigneeIds: requestedAssigneeIds,
              note: body.note || undefined,
            })
          : Promise.resolve(),
        statusChanged
          ? notifyTaskStatusChange({
              taskId: originalTask.id,
              title: originalTask.title,
              company: (body.company as typeof originalTask.company) || originalTask.company,
              actor: currentUser,
              creatorId: originalTask.assignedById,
              oldStatus: originalTask.status,
              newStatus: body.status,
              billStarted,
            })
          : Promise.resolve(),
        !assigneesChanged && !statusChanged
          ? sendTaskUpdatedNotificationToAdmins(task.id, task.title, currentUser.id)
          : Promise.resolve(),
      ])
    );

    // Invalidate related caches
    await taskCache.delete(`task:${taskId}`);
    await dashboardCache.invalidate('*'); // Clear all dashboard caches
    
    // If client assignment changed, invalidate client cache
    if (body.clientId && body.clientId !== originalTask?.clientId) {
      await clientCache.delete(`client:${body.clientId}`);
      if (originalTask?.clientId) {
        await clientCache.delete(`client:${originalTask.clientId}`);
      }
    }

    return NextResponse.json(updatedTask);
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json(
      { error: "Failed to update task" },
      { status: 500 }
    );
  }
}

// DELETE /api/tasks/[id] { reason? } – Admin deletes a task at once. Others
// ask with POST /api/tasks/[id]/deletion-request. A task with a bill (even a
// draft) can't be deleted until the bill is dealt with.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  const currentUser = getSessionUser(await getServerSession(authOptions));
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Ask Admin to delete this task: use Request deletion with a reason" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null;

  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: taskForDeletion });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const blocked = deletionBlockedReason(task);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

    const now = new Date();
    // A request waiting for this task is approved by the deletion itself;
    // otherwise the Admin's own deletion is recorded
    const updated = await prisma.taskDeletionRequest.updateMany({
      where: { taskId, status: "pending" },
      data: { status: "approved", decidedById: currentUser.id, decidedAt: now, ...(reason && { decisionNote: reason }) },
    });
    if (updated.count === 0) {
      await prisma.taskDeletionRequest.create({
        data: {
          taskId,
          taskTitle: task.title.slice(0, 150),
          clientName: clientLabel(task.client),
          reason,
          status: "approved",
          requestedById: currentUser.id,
          decidedById: currentUser.id,
          decidedAt: now,
        },
      });
    }
    await deleteTaskCompletely(taskId);

    after(() =>
      prisma.activity
        .create({
          data: { type: "task", action: "deleted", target: task.title, details: { taskId, reason }, userId: currentUser.id },
        })
        .catch((error) => console.error("Failed to log task deletion:", error))
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting task:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
