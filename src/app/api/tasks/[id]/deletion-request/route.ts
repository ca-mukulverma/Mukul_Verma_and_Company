import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendInAppNotification } from "@/lib/notifications";
import { clientLabel, deletionBlockedReason, taskForDeletion } from "@/lib/task-delete";

const requestSchema = z.object({
  reason: z.string().trim().min(5, "Say why the task should be deleted").max(1000),
});

// POST /api/tasks/[id]/deletion-request { reason } – anyone on the task (its
// creator or an assignee) asks Admin to delete it. The task stays, marked,
// and can't be worked on until Admin approves or rejects. Admins delete
// directly (DELETE /api/tasks/[id]).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  const currentUser = getSessionUser(await getServerSession(authOptions));
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Give a reason" }, { status: 400 });

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: taskForDeletion });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const onTask =
    currentUser.role === "ADMIN" ||
    task.assignedById === currentUser.id ||
    task.assignees.some((a) => a.userId === currentUser.id);
  if (!onTask) return NextResponse.json({ error: "You are not on this task" }, { status: 403 });
  if (task.deletionRequests.length) return NextResponse.json({ error: "Deletion has already been requested" }, { status: 400 });
  const blocked = deletionBlockedReason(task);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

  try {
    await prisma.taskDeletionRequest.create({
      data: {
        taskId,
        taskTitle: task.title.slice(0, 150),
        clientName: clientLabel(task.client),
        reason: parsed.data.reason,
        requestedById: currentUser.id,
      },
    });
  } catch (error) {
    // Asked by someone else at the same moment (one open request per task)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Deletion has already been requested" }, { status: 400 });
    }
    console.error("Failed to request task deletion:", error);
    return NextResponse.json({ error: "Could not send the request" }, { status: 500 });
  }

  after(async () => {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true, NOT: { id: currentUser.id } }, select: { id: true } });
    await Promise.all(
      admins.map((admin) =>
        sendInAppNotification({
          title: "Task deletion requested",
          content: `${currentUser.name} asks to delete "${task.title}": ${parsed.data.reason} [taskId: ${taskId}]`,
          sentById: currentUser.id,
          sentToId: admin.id,
          taskId,
        })
      )
    );
  });

  return NextResponse.json({ success: true });
}
