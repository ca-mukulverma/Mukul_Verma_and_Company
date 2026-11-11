import type { BillStatus, Prisma } from "@prisma/client";

// Shared by the task API and pages (docs/TASKS.md). Safe to import in the
// browser: no database access here.

// The statuses a task can be given. "cancelled" stays in the database type
// for old tasks, but isn't offered: tasks are deleted instead.
export const TASK_STATUSES = ["pending", "in_progress", "review", "completed"] as const;
export type TaskStatusChoice = (typeof TASK_STATUSES)[number];
export const OPEN_STATUSES = ["pending", "in_progress", "review"] as const;

// The task list's views:
// - active: work still to do (and tasks waiting for their deletion to be approved)
// - awaiting_bill: completed, the bill not numbered yet (or not started)
// - closed: completed and billed, or no bill to be made
// - deletion: deletion requests waiting for Admin (Admin only)
export const TASK_VIEWS = ["active", "awaiting_bill", "closed", "deletion"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const VIEW_LABEL: Record<TaskView, string> = {
  active: "Active",
  awaiting_bill: "Done – awaiting bill",
  closed: "Closed",
  deletion: "Deletion requests",
};

// Bill stages before it is numbered: the task waits in "Done – awaiting bill"
export const UNBILLED_BILL_STATUSES: BillStatus[] = ["draft", "awaiting_amount", "amount_entered", "manager_approved"];

export const BILL_STAGE_LABEL: Record<string, string> = {
  none: "Bill not started",
  draft: "With the billing manager",
  awaiting_amount: "Waiting for the amount",
  amount_entered: "Amount entered, to approve",
  manager_approved: "Waiting for final approval",
  approved: "Billed",
  cancelled: "Bill cancelled",
  not_billable: "No bill",
};

export function viewWhere(view: TaskView): Prisma.TaskWhereInput {
  switch (view) {
    case "awaiting_bill":
      return {
        status: "completed",
        OR: [{ bill: { is: null } }, { bill: { is: { status: { in: UNBILLED_BILL_STATUSES } } } }],
      };
    case "closed":
      return {
        status: "completed",
        bill: { is: { status: { notIn: UNBILLED_BILL_STATUSES } } },
      };
    case "deletion":
      return { deletionRequests: { some: { status: "pending" } } };
    case "active":
    default:
      return {
        OR: [{ status: { in: [...OPEN_STATUSES] } }, { deletionRequests: { some: { status: "pending" } } }],
      };
  }
}

// One-click comments on the task cards; Admin can change them (Tasks → Quick comments)
export const DEFAULT_QUICK_COMMENTS = [
  "Status?",
  "Please update today",
  "Client data received?",
  "Send for review",
  "Call me",
  "Done? Please mark it completed",
];
export const QUICK_COMMENTS_SETTING = "task_quick_comments";
export const MAX_QUICK_COMMENTS = 12;

// Whether the signed-in person follows up tasks (cards with comments, and
// their comments ask for a reply): Admins, and partners switched on by Admin
export function followsUpTasks(user: { role?: string; canFollowUpTasks?: boolean } | null | undefined) {
  return user?.role === "ADMIN" || (user?.role === "PARTNER" && !!user.canFollowUpTasks);
}
