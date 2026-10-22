import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import cloudinary from "@/lib/cloudinary";
import { sendInAppNotification } from "@/lib/notifications";
import { getBillingAccess, isEditableStatus, managesCompany } from "@/lib/billing";
import { dashboardCache, taskCache } from "@/lib/cache";

const requestSchema = z.object({
  remark: z.string().trim().max(500).optional(),
});

// POST /api/tasks/:id/no-billing – the billing manager decides that a
// completed task's bill is not to be made: the task is removed completely,
// with its bill. The client's history keeps a line that the work was done.
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

  // Only once the task is completed and its bill is with the billing manager
  if (task.status !== "completed" || !task.bill) {
    return NextResponse.json({ error: "No billing can be chosen once the task is completed and its bill is with the billing manager" }, { status: 400 });
  }
  const bill = task.bill;
  // The billing managers of the task's company (and Admin) decide
  const access = await getBillingAccess(currentUser.id);
  if (!access || !managesCompany(access, task.company)) {
    return NextResponse.json({ error: "Only the billing manager or Admin can choose no billing" }, { status: 403 });
  }
  // Before final approval only; a numbered bill is never deleted (docs/BILLING.md)
  if (!isEditableStatus(bill.status) && bill.status !== "not_billable") {
    return NextResponse.json({ error: "This bill is already past the billing manager" }, { status: 400 });
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
      // Only if still with the billing manager; otherwise it moved on meanwhile
      const { count } = await tx.bill.deleteMany({
        where: { id: bill.id, status: { in: ["draft", "awaiting_amount", "amount_entered", "not_billable"] } },
      });
      if (count === 0) throw new Error("bill_moved");
      // Comments and assignments go with the task
      await tx.task.delete({ where: { id: task.id } });
      await tx.activity.create({
        data: {
          type: "task",
          action: "completed_no_billing",
          target: task.title,
          details: { taskId: task.id, clientId: task.clientId, billId: bill.id, remark },
          userId: currentUser.id,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "bill_moved") {
      return NextResponse.json({ error: "This bill was changed by someone else. Refresh and try again." }, { status: 409 });
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
            `${currentUser.name} chose no billing for "${task.title}"; the task and its bill have been removed.` +
            (remark ? ` Remark: ${remark}` : ""),
          sentById: currentUser.id,
          sentToId,
        })
      )
    );
  });

  return NextResponse.json({ success: true });
}
