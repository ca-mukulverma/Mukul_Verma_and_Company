import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import cloudinary from "@/lib/cloudinary";
import { sendInAppNotification } from "@/lib/notifications";
import { dashboardCache, taskCache } from "@/lib/cache";

const requestSchema = z.object({
  remark: z.string().trim().max(500).optional(),
});

// POST /api/tasks/:id/no-billing – the work is done but nothing is to be
// billed: the task is completed and removed completely, with any bill not yet
// numbered. The client's history keeps a line that the work was done.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  const session = await getServerSession(authOptions);
  const currentUser = getSessionUser(session);
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Remark is too long" }, { status: 400 });
  const remark = parsed.data.remark || null;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      bill: { select: { id: true, status: true } },
      assignees: { select: { userId: true } },
      comments: { select: { attachments: true } },
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Admins, partners and the person who created the task decide that it is not billed
  if (currentUser.role !== "ADMIN" && currentUser.role !== "PARTNER" && task.assignedById !== currentUser.id) {
    return NextResponse.json({ error: "Only Admin, a partner or the task's creator can close it without billing" }, { status: 403 });
  }
  // A numbered bill is never deleted (docs/BILLING.md)
  if (task.bill && (task.bill.status === "approved" || task.bill.status === "cancelled")) {
    return NextResponse.json({ error: "This task's bill is already approved" }, { status: 400 });
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      if (task.clientId) {
        await tx.clientHistory.create({
          data: {
            clientId: task.clientId,
            content: `Task "${task.title}" was completed. No billing required.${remark ? ` Remark: ${remark}` : ""}`,
            type: "task_completed",
            createdById: currentUser.id,
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description || "",
            taskStatus: "completed",
            taskCompletedDate: now,
          },
        });
      }
      if (task.bill) {
        // Only if still unnumbered; otherwise someone approved it meanwhile
        const { count } = await tx.bill.deleteMany({
          where: { id: task.bill.id, status: { notIn: ["approved", "cancelled"] } },
        });
        if (count === 0) throw new Error("bill_approved");
      }
      // Comments and assignments go with the task
      await tx.task.delete({ where: { id: task.id } });
      await tx.activity.create({
        data: {
          type: "task",
          action: "completed_no_billing",
          target: task.title,
          details: { taskId: task.id, clientId: task.clientId, remark, billRemoved: !!task.bill },
          userId: currentUser.id,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "bill_approved") {
      return NextResponse.json({ error: "This task's bill is already approved" }, { status: 409 });
    }
    // Deleted by someone else at the same moment
    const exists = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    console.error("Failed to close task without billing:", error);
    return NextResponse.json({ error: "Could not close the task" }, { status: 500 });
  }

  await Promise.all([taskCache.delete(`task:${taskId}`), dashboardCache.invalidate("*")]).catch(() => undefined);

  after(async () => {
    // Attachments of the task's comments
    const publicIds = task.comments
      .flatMap((comment) => (comment.attachments as { public_id?: string }[] | null) || [])
      .map((attachment) => attachment?.public_id)
      .filter((id): id is string => !!id);
    if (publicIds.length > 0) {
      await cloudinary.api.delete_resources(publicIds).catch((error: unknown) =>
        console.error("Failed to delete task attachments:", error)
      );
    }

    // The Admins, the task's creator and its assignees
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    const recipients = new Set([...admins.map((a) => a.id), task.assignedById, ...task.assignees.map((a) => a.userId)]);
    recipients.delete(currentUser.id);
    await Promise.all(
      [...recipients].map((sentToId) =>
        sendInAppNotification({
          title: "Task closed without billing",
          content:
            `${currentUser.name} completed "${task.title}" with no billing; the task has been removed.` +
            (remark ? ` Remark: ${remark}` : ""),
          sentById: currentUser.id,
          sentToId,
        })
      )
    );
  });

  return NextResponse.json({ success: true });
}
