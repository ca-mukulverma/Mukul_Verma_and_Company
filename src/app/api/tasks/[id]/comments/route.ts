import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { markTaskNotificationsRead, notifyTaskComment } from "@/lib/task-notify";
import { canFollowUpTasks } from "@/lib/task-follow-up";

// Schema for comment creation
const attachmentSchema = z.object({
  url: z.string().url(),
  secure_url: z.string().url(),
  public_id: z.string(),
  format: z.string().optional(),
  resource_type: z.string(),
  original_filename: z.string().optional(),
});

const commentSchema = z.object({
  content: z.string().max(5000).optional().default(""),
  attachments: z.array(attachmentSchema).optional(),
  noReplyNeeded: z.boolean().optional(),
}).refine(data => data.content.trim() !== "" || (data.attachments && data.attachments.length > 0), {
  message: "Comment must contain text or attachments",
});

// Helper function to check if a user has permission to access a task
async function checkTaskPermission(userId: string, taskId: string) {
  // Check if the user is an admin (admins can access all tasks)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true }
  });
  
  if (user?.role === "ADMIN") {
    return true;
  }
  
  // Check if task exists and user's relationship to it
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignees: {
        where: { userId: userId }
      }
    }
  });
  
  if (!task) {
    return false; // Task doesn't exist
  }
  
  // User has permission if they:
  // 1. Created the task
  // 2. Are assigned to the task
  // 3. Last updated the task status
  return (
    task.assignedById === userId ||
    task.lastStatusUpdatedById === userId ||
    task.assignees.length > 0
  );
}

// POST /api/tasks/[id]/comments { content, attachments?, noReplyNeeded? } –
// anyone on the task. A comment from Admin, or from a partner who follows up
// tasks, asks everyone else on the task for a reply (unless "No reply needed"
// is ticked); their reply is any comment of theirs on the task.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const currentUser = getSessionUser(await getServerSession(authOptions));
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = commentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }
    const validatedData = parsed.data;

    // The task and whether the commenter follows up tasks, together
    const [task, follower] = await Promise.all([
      prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          title: true,
          assignedById: true,
          lastStatusUpdatedById: true,
          assignees: { select: { userId: true, user: { select: { isActive: true } } } },
        },
      }),
      canFollowUpTasks(currentUser),
    ]);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const hasPermission =
      currentUser.role === "ADMIN" ||
      task.assignedById === currentUser.id ||
      task.lastStatusUpdatedById === currentUser.id ||
      task.assignees.some((assignee) => assignee.userId === currentUser.id);
    if (!hasPermission) {
      return NextResponse.json(
        { error: "You don't have permission to comment on this task" },
        { status: 403 }
      );
    }

    const comment = await prisma.taskComment.create({
      data: {
        content: validatedData.content,
        taskId,
        userId: currentUser.id,
        attachments: validatedData.attachments,
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, avatar: true } },
      },
    });

    // Who is asked to reply: everyone else on the task who is still active
    const replyFrom =
      follower && !validatedData.noReplyNeeded
        ? [...new Set([task.assignedById, ...task.assignees.filter((a) => a.user.isActive).map((a) => a.userId)])].filter(
            (id) => id !== currentUser.id
          )
        : [];

    await Promise.all([
      // This comment answers whatever was waiting for a reply from this person here
      prisma.taskReplyRequest.updateMany({
        where: { taskId, userId: currentUser.id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      }),
      replyFrom.length
        ? prisma.taskReplyRequest.createMany({
            data: replyFrom.map((userId) => ({ taskId, commentId: comment.id, userId, requestedById: currentUser.id })),
            skipDuplicates: true,
          })
        : Promise.resolve(),
    ]);

    // Notifications, the activity log and the commenter's own bell after the
    // response, so the comment posts straight away
    after(() =>
      Promise.all([
        notifyTaskComment({
          taskId,
          title: task.title,
          actor: currentUser,
          creatorId: task.assignedById,
          assigneeIds: task.assignees.map((a) => a.userId),
          content: comment.content,
          replyFrom,
        }),
        markTaskNotificationsRead(currentUser.id, taskId),
        prisma.activity
          .create({
            data: {
              type: "task",
              action: "commented",
              target: task.title,
              details: { taskId, commentId: comment.id, hasAttachments: !!validatedData.attachments?.length },
              userId: currentUser.id,
            },
          })
          .catch((error) => console.error("Failed to log comment:", error)),
      ])
    );

    return NextResponse.json({ ...comment, replyRequested: replyFrom.length > 0 }, { status: 201 });
  } catch (error) {
    console.error("Error creating comment:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Failed to add comment" },
      { status: 500 }
    );
  }
}

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

    const currentUser = getSessionUser(session);

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if task exists
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

    // Consolidated permission check - same as POST for consistency
    const hasPermission = 
      currentUser.role === "ADMIN" ||
      task.assignedById === currentUser.id ||
      task.lastStatusUpdatedById === currentUser.id ||
      task.assignees.some(assignee => assignee.userId === currentUser.id);

    if (!hasPermission) {
      return NextResponse.json(
        { error: "You don't have permission to view comments on this task" },
        { status: 403 }
      );
    }

    // Get task comments
    const comments = await prisma.taskComment.findMany({
      where: { taskId: taskId },
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

    return NextResponse.json(comments);
  } catch (error) {
    console.error("Error fetching comments:", error);
    return NextResponse.json(
      { error: "Failed to fetch comments" },
      { status: 500 }
    );
  }
}