import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { sendTaskAssignedNotification } from "@/lib/notifications";
import { syncTaskAssignments } from "@/lib/task-assignment";
import { sendTaskCreatedNotificationToAdmins } from "@/lib/notifications";
import { ensureDraftBillForTask } from "@/lib/billing";
import { TASK_STATUSES, TASK_VIEWS, TaskView, viewWhere } from "@/lib/task-views";
import { canFollowUpTasks } from "@/lib/task-follow-up";

// Schema for task creation
const taskCreateSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(TASK_STATUSES),
  dueDate: z.string().optional().nullable(),
  assignedToIds: z.array(z.string()).optional().default([]),
  assignedToId: z.string().optional().nullable(), // Legacy field
  clientId: z.string().optional().nullable(),
  company: z.enum(["MVC", "BEDGE"]).optional().default("MVC"),
});

const DAY = 86_400_000;
// A task with no comment and no change for this long shows under "No update"
const STALE_DAYS = 3;
const QUICK_FILTERS = ["waiting_on_me", "unanswered", "overdue", "stale"] as const;
type QuickFilter = (typeof QUICK_FILTERS)[number];

const userBrief = { select: { id: true, name: true, email: true, role: true, avatar: true } } as const;

// GET /api/tasks?view=active|awaiting_bill|closed|deletion&filter=&status=&search=&assignedToMe=&page=&limit=
// The task list (docs/TASKS.md). Admins see every task, partners the tasks
// they created or are on, staff the tasks they are on. Admins and partners
// who follow up tasks also get each task's last three comments.
export async function GET(request: NextRequest) {
  try {
    const currentUser = getSessionUser(await getServerSession(authOptions));
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedView = searchParams.get("view") as TaskView | null;
    const isAdmin = currentUser.role === "ADMIN";
    const view: TaskView =
      requestedView && TASK_VIEWS.includes(requestedView) && (requestedView !== "deletion" || isAdmin) ? requestedView : "active";
    const status = searchParams.get("status");
    const filter = searchParams.get("filter") as QuickFilter | null;
    const searchTerm = searchParams.get("search")?.trim();
    const assignedToMe = searchParams.get("assignedToMe") === "true";
    const page = Math.max(parseInt(searchParams.get("page") || "1") || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get("limit") || "20") || 20, 1), 100);

    // Who sees which tasks
    const scope: Prisma.TaskWhereInput = assignedToMe
      ? { assignees: { some: { userId: currentUser.id } } }
      : isAdmin
        ? {}
        : currentUser.role === "PARTNER"
          ? { OR: [{ assignedById: currentUser.id }, { assignees: { some: { userId: currentUser.id } } }] }
          : { assignees: { some: { userId: currentUser.id } } };

    const now = new Date();
    const staleSince = new Date(now.getTime() - STALE_DAYS * DAY);
    const filters: Prisma.TaskWhereInput[] = [];
    // A status within Active (Pending, In progress, Review)
    if (view === "active" && status && status !== "all" && (TASK_STATUSES as readonly string[]).includes(status)) {
      filters.push({ status: status as Prisma.EnumTaskStatusFilter["equals"] });
    }
    if (searchTerm) {
      filters.push({
        OR: [
          { title: { contains: searchTerm, mode: "insensitive" } },
          { description: { contains: searchTerm, mode: "insensitive" } },
          { client: { is: { OR: [{ companyName: { contains: searchTerm, mode: "insensitive" } }, { contactPerson: { contains: searchTerm, mode: "insensitive" } }] } } },
        ],
      });
    }
    if (filter && QUICK_FILTERS.includes(filter)) {
      if (filter === "waiting_on_me") filters.push({ replyRequests: { some: { userId: currentUser.id, resolvedAt: null } } });
      if (filter === "unanswered") filters.push({ replyRequests: { some: { resolvedAt: null } } });
      if (filter === "overdue") filters.push({ dueDate: { lt: now }, status: { in: ["pending", "in_progress", "review"] } });
      if (filter === "stale") filters.push({ updatedAt: { lt: staleSince }, comments: { none: { createdAt: { gte: staleSince } } } });
    }
    const where: Prisma.TaskWhereInput = { AND: [scope, viewWhere(view), ...filters] };

    const followUp = await canFollowUpTasks(currentUser);
    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      view === "awaiting_bill"
        ? [{ completedAt: { sort: "asc", nulls: "first" } }]
        : view === "closed"
          ? [{ completedAt: { sort: "desc", nulls: "last" } }]
          : [{ createdAt: "desc" }];

    const [totalCount, tasks, viewCounts] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        include: {
          assignedBy: { select: { id: true, name: true, email: true, role: true } },
          assignees: { include: { user: userBrief } },
          client: { select: { id: true, contactPerson: true, companyName: true } },
          lastStatusUpdatedBy: { select: { id: true, name: true } },
          bill: { select: { status: true } },
          deletionRequests: {
            where: { status: "pending" },
            select: { id: true, reason: true, createdAt: true, requestedBy: { select: { id: true, name: true } } },
          },
          // The latest comment for everyone ("last activity"); the last three
          // for those who follow up tasks
          comments: {
            orderBy: { createdAt: "desc" },
            take: followUp ? 3 : 1,
            select: { id: true, content: true, createdAt: true, attachments: true, user: { select: { id: true, name: true } } },
          },
          replyRequests: {
            where: { resolvedAt: null },
            select: { userId: true, createdAt: true, user: { select: { name: true } } },
          },
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      // The number on each view's tab (with the same scope, not the filters)
      Promise.all(
        (isAdmin ? TASK_VIEWS : TASK_VIEWS.filter((v) => v !== "deletion"))
          .filter((v) => v !== "closed")
          .map(async (v) => [v, await prisma.task.count({ where: { AND: [scope, viewWhere(v)] } })] as const)
      ).then((entries) => Object.fromEntries(entries)),
    ]);

    const shaped = tasks.map(({ comments, replyRequests, bill, deletionRequests, ...task }) => {
      const lastComment = comments[0];
      const statusAt = task.lastStatusUpdatedAt;
      const lastActivity =
        lastComment && (!statusAt || lastComment.createdAt > statusAt)
          ? { at: lastComment.createdAt, text: `${lastComment.user.name} commented` }
          : statusAt
            ? { at: statusAt, text: `${task.lastStatusUpdatedBy?.name ?? "Someone"} set ${task.status.replace("_", " ")}` }
            : { at: task.createdAt, text: `${task.assignedBy.name} created it` };
      // Who has the ball: those asked for a reply, else the people on the task
      const waitingOn = replyRequests.length
        ? [...new Set(replyRequests.map((r) => r.user.name))]
        : task.status === "completed"
          ? []
          : task.assignees.map((a) => a.user.name);
      return {
        ...task,
        billStage: task.status === "completed" ? bill?.status ?? "none" : null,
        pendingDeletion: deletionRequests[0] ?? null,
        lastActivity,
        waitingOn,
        awaitingReply: replyRequests.length,
        awaitingMyReply: replyRequests.some((r) => r.userId === currentUser.id),
        recentComments: followUp ? [...comments].reverse() : undefined,
      };
    });

    return NextResponse.json({
      tasks: shaped,
      view,
      followUp,
      viewCounts,
      pagination: {
        total: totalCount,
        page,
        pageSize,
        pageCount: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (error) {
    console.error("Error fetching tasks:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only admin and partner can create tasks
    if (session.user.role !== "ADMIN" && session.user.role !== "PARTNER") {
      return NextResponse.json({ error: "Only administrators and partners can create tasks" }, { status: 403 });
    }

    // Get current user for assignedBy
    const currentUser = getSessionUser(session);

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Parse request body
    const body = await request.json();
    
    // Validate request data
    const validatedData = taskCreateSchema.parse(body);

    // Start a transaction to create task and assignees
    const result = await prisma.$transaction(async (tx) => {
      // Create the task first without any assignee references
      const task = await tx.task.create({
        data: {
          title: validatedData.title,
          description: validatedData.description,
          priority: validatedData.priority,
          status: validatedData.status,
          dueDate: validatedData.dueDate ? new Date(validatedData.dueDate) : null,
          assignedById: currentUser.id,
          clientId: validatedData.clientId,
          company: validatedData.company,
        },
      });
      
      // Determine final list of assignees
      const assigneeIds = validatedData.assignedToIds?.length 
        ? validatedData.assignedToIds 
        : (validatedData.assignedToId ? [validatedData.assignedToId] : []);
      
      // Use the helper function to handle assignments
      return syncTaskAssignments(tx, task.id, assigneeIds);
    });

    // A task created as already completed is ready for billing straight away
    if (result && validatedData.status === "completed") {
      await ensureDraftBillForTask(result.id, currentUser.id);
    }

    // Create activity log
    if (result) {
      await prisma.activity.create({
        data: {
          type: "task",
          action: "created",
          target: validatedData.title,
          details: { taskId: result.id },
          userId: currentUser.id,
        },
      });
    } else {
      console.error("Failed to create task: result is null");
      return NextResponse.json(
        { error: "Failed to create task" },
        { status: 500 }
      );
    }

    // Send notifications after the response so the user isn't kept waiting
    const taskId = result.id;
    const dueDate = validatedData.dueDate ? new Date(validatedData.dueDate) : undefined;
    const notifyIds = (validatedData.assignedToIds?.length
      ? validatedData.assignedToIds
      : (validatedData.assignedToId ? [validatedData.assignedToId] : [])
    ).filter((id) => id !== currentUser.id);

    after(() =>
      Promise.all([
        sendTaskCreatedNotificationToAdmins(taskId, validatedData.title, currentUser.id, notifyIds),
        ...notifyIds.map((assigneeId) =>
          sendTaskAssignedNotification(
            taskId,
            validatedData.title,
            currentUser.id,
            assigneeId,
            undefined,
            dueDate
          )
        ),
      ])
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error creating task:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create task" },
      { status: 500 }
    );
  }
}