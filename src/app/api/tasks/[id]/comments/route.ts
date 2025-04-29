import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { sendTaskCommentNotificationToAdmins } from "@/lib/notifications";

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
  content: z.string().optional().default(""),
  attachments: z.array(attachmentSchema).optional(),
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = params instanceof Promise ? await params : params;
    const taskId = resolvedParams.id;
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get current user
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email as string },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedBy: true,
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

    // Consolidated permission check
    const hasPermission = 
      currentUser.role === "ADMIN" ||
      task.assignedById === currentUser.id ||
      task.lastStatusUpdatedById === currentUser.id ||
      task.assignees.some(assignee => assignee.userId === currentUser.id);

    if (!hasPermission) {
      return NextResponse.json(
        { error: "You don't have permission to comment on this task" },
        { status: 403 }
      );
    }

    // Validate request data
    const body = await request.json();
    const validatedData = commentSchema.parse(body);

    // Create the comment
    const comment = await prisma.taskComment.create({
      data: {
        content: validatedData.content,
        taskId: taskId,
        userId: currentUser.id,
        attachments: validatedData.attachments,
      },
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
    });

    // Create activity log
    await prisma.activity.create({
      data: {
        type: "task",
        action: "commented",
        target: task.title,
        details: { 
          taskId: task.id, 
          commentId: comment.id,
          hasAttachments: validatedData.attachments && validatedData.attachments.length > 0
        },
        userId: currentUser.id,
      },
    });

    // Create notification for task owner if different from commenter
    if (task.assignedById !== currentUser.id) {
      await prisma.notification.create({
        data: {
          title: "New Comment on Task",
          content: `${currentUser.name} commented on task: ${task.title} - "${comment.content}" [taskId: ${task.id}]`,
          sentById: currentUser.id,
          sentToId: task.assignedById,
        },
      });
    }

    // Create notifications for all assignees if different from commenter
    for (const assignee of task.assignees) {
      if (assignee.userId !== currentUser.id) {
        await prisma.notification.create({
          data: {
            title: "New Comment on Task",
            content: `${currentUser.name} commented on task: ${task.title}  - "${comment.content}" [taskId: ${task.id}]`,
            sentById: currentUser.id,
            sentToId: assignee.userId,
          },
        });
      }
    }

    await sendTaskCommentNotificationToAdmins(
      task.id,
      task.title,
      currentUser.id,
      task.assignedById,
      { content: comment.content },
    );

    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    
    console.error("Error creating comment:", error);
    return NextResponse.json(
      { error: "Failed to add comment" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = params instanceof Promise ? await params : params;
    const taskId = resolvedParams.id;
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email as string },
    });

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