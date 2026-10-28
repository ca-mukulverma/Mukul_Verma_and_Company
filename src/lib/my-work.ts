import { ComplianceKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";
import { pendingBillingWork, PendingGroup } from "@/lib/billing-pending";
import { periodLabel, todayIST } from "@/lib/compliance-periods";
import { partyName } from "@/lib/compliance";

// Everything waiting for one person, from Tasks, Compliance and Billing, for
// the "My work" page and the daily digest (lib/daily-digest.ts).

const DAY = 86_400_000;
const IST_OFFSET = 5.5 * 3_600_000;
// Compliance work shows from this many days before its due date
export const COMPLIANCE_LOOKAHEAD_DAYS = 7;
const MAX_ROWS = 50;

export type DueState = "overdue" | "today" | "soon" | "later" | "none";

export interface MyTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  due: DueState;
  client: string | null;
  company: string;
  unreadComments: number;
}

export interface MyComplianceItem {
  id: string;
  clientId: string;
  client: string;
  work: string;
  kind: ComplianceKind;
  workTypeId: string;
  period: string;
  // YYYY-MM of the period's first month, to open the sheet on it
  month: string;
  dueDate: string;
  due: DueState;
  status: string;
}

export interface MyWork {
  tasks: MyTask[];
  compliance: MyComplianceItem[];
  billing: PendingGroup[];
  counts: {
    tasksOverdue: number;
    tasksDueToday: number;
    tasksOpen: number;
    complianceOverdue: number;
    complianceDueSoon: number;
    complianceWaitingFiles: number;
    billing: number;
  };
}

function dueState(date: Date | null, today: Date): DueState {
  if (!date) return "none";
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const diff = Math.round((day - today.getTime()) / DAY);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  return "later";
}

export async function getMyWork(userId: string, now = new Date()): Promise<MyWork> {
  const today = todayIST();

  const [tasks, teams, access] = await Promise.all([
    prisma.task.findMany({
      where: { assignees: { some: { userId } }, status: { notIn: ["completed", "cancelled"] } },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        company: true,
        client: { select: { contactPerson: true, companyName: true } },
      },
      // Overdue and due first; tasks without a date last
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: MAX_ROWS,
    }),
    prisma.complianceTeamMember.findMany({ where: { userId, toDate: null }, select: { workTypeId: true } }),
    getBillingAccess(userId),
  ]);

  const workTypeIds = [...new Set(teams.map((t) => t.workTypeId))];
  const horizon = new Date(today.getTime() + COMPLIANCE_LOOKAHEAD_DAYS * DAY);
  const complianceWhere = {
    workTypeId: { in: workTypeIds },
    historical: false,
    workType: { active: true },
  };

  const [items, waitingFiles, billing] = await Promise.all([
    workTypeIds.length
      ? prisma.complianceItem.findMany({
          where: { ...complianceWhere, status: { in: ["pending", "data_received"] }, dueDate: { lte: horizon } },
          select: {
            id: true,
            clientId: true,
            frequency: true,
            periodStart: true,
            dueDate: true,
            status: true,
            workTypeId: true,
            workType: { select: { name: true, kind: true } },
            client: { select: { contactPerson: true, companyName: true } },
          },
          orderBy: [{ dueDate: "asc" }],
          take: MAX_ROWS,
        })
      : Promise.resolve([]),
    workTypeIds.length ? prisma.complianceItem.count({ where: { ...complianceWhere, status: "filed" } }) : Promise.resolve(0),
    access ? pendingBillingWork(access, now) : Promise.resolve([] as PendingGroup[]),
  ]);

  // Unread comments: my unread comment notifications on these tasks
  const taskIds = tasks.map((t) => t.id);
  const unread = taskIds.length
    ? await prisma.notification.groupBy({
        by: ["taskId"],
        where: { sentToId: userId, isRead: false, taskId: { in: taskIds }, title: { contains: "Comment" } },
        _count: true,
      })
    : [];

  const myTasks: MyTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate?.toISOString() ?? null,
    // Task due dates are instants: take their calendar day in India
    due: t.dueDate ? dueState(new Date(t.dueDate.getTime() + IST_OFFSET), today) : "none",
    client: t.client ? partyName(t.client) : null,
    company: t.company,
    unreadComments: unread.find((u) => u.taskId === t.id)?._count ?? 0,
  }));

  const myItems: MyComplianceItem[] = items.map((i) => ({
    id: i.id,
    clientId: i.clientId,
    client: partyName(i.client),
    work: i.workType.name,
    kind: i.workType.kind,
    workTypeId: i.workTypeId,
    period: periodLabel(i.frequency, i.periodStart),
    month: i.periodStart.toISOString().slice(0, 7),
    dueDate: i.dueDate.toISOString(),
    due: dueState(i.dueDate, today),
    status: i.status,
  }));

  return {
    tasks: myTasks,
    compliance: myItems,
    billing,
    counts: {
      tasksOverdue: myTasks.filter((t) => t.due === "overdue").length,
      tasksDueToday: myTasks.filter((t) => t.due === "today").length,
      tasksOpen: myTasks.length,
      complianceOverdue: myItems.filter((i) => i.due === "overdue").length,
      complianceDueSoon: myItems.filter((i) => i.due === "today" || i.due === "soon").length,
      complianceWaitingFiles: waitingFiles,
      billing: billing.reduce((sum, g) => sum + g.count, 0),
    },
  };
}
