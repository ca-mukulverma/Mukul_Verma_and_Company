import { Company, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BILL_STATUS_LABELS } from "@/lib/billing-constants";
import { periodLabel } from "@/lib/compliance-periods";
import { partyName } from "@/lib/compliance";

// "Work Done": one list of finished work from tasks, logged work and
// compliance, with who did it. Admins and the partners Admin allows see
// everyone's; everyone else sees only their own. No fees are shown.
//
// Who did it:
//   task        – the people it is assigned to (the person who marked it
//                 completed when nobody is assigned); also shows who marked it
//   logged work – the person who logged it
//   compliance  – the person who filed it (or closed the month); also shows
//                 who checked it

export type WorkSource = "task" | "logged" | "compliance";
export const WORK_SOURCES: WorkSource[] = ["task", "logged", "compliance"];
export const WORK_SOURCE_LABELS: Record<WorkSource, string> = {
  task: "Task",
  logged: "Logged work",
  compliance: "Compliance",
};

export interface Person {
  id: string;
  name: string;
}

export interface WorkDoneRow {
  key: string;
  source: WorkSource;
  // Calendar day in India, YYYY-MM-DD
  date: string;
  work: string;
  client: string | null;
  company: Company;
  doneBy: Person[];
  // "Marked completed by …" / "Checked by …", when it adds something
  note: string | null;
  status: string;
  // Where the row opens; logged work opens only for the person who logged it
  // (under Billing → My entries)
  href: string | null;
}

export interface StaffCount {
  id: string;
  name: string;
  task: number;
  logged: number;
  compliance: number;
  total: number;
}

export interface WorkDoneFilter {
  from: string; // YYYY-MM-DD (India)
  to: string; // YYYY-MM-DD (India), inclusive
  userId?: string | null;
  company?: Company | null;
  source?: WorkSource | null;
  search?: string | null;
}

// Each kind of work is read up to this many rows; more asks for shorter dates
export const MAX_ROWS_PER_SOURCE = 5000;

const IST_OFFSET = 5.5 * 3_600_000;
const DAY = 86_400_000;

const SHEET_TAB: Record<string, string> = {
  GSTR1: "gst",
  GSTR3B: "gst",
  TDS_PAYMENT: "tds",
  TDS_RETURN: "tds",
  GENERIC: "work",
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Who may see everyone's work: Admin, and partners Admin turned it on for
export async function seesAllWork(user: { id: string; role: string }) {
  if (user.role === "ADMIN") return true;
  if (user.role !== "PARTNER") return false;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { canViewWorkDone: true } });
  return !!row?.canViewWorkDone;
}

// The calendar day in India of an instant
function istDay(date: Date) {
  return new Date(date.getTime() + IST_OFFSET).toISOString().slice(0, 10);
}

export async function getWorkDone(filter: WorkDoneFilter, viewerId: string) {
  // Instants for timestamps, and calendar days for DATE columns
  const fromInstant = new Date(Date.parse(`${filter.from}T00:00:00Z`) - IST_OFFSET);
  const toInstant = new Date(Date.parse(`${filter.to}T00:00:00Z`) - IST_OFFSET + DAY);
  const fromDay = new Date(`${filter.from}T00:00:00Z`);
  const toDay = new Date(`${filter.to}T00:00:00Z`);
  const instantRange = { gte: fromInstant, lt: toInstant };
  const search = filter.search?.trim() || null;
  const contains = (value: string) => ({ contains: value, mode: Prisma.QueryMode.insensitive });
  const clientMatch = (value: string): Prisma.ClientWhereInput => ({
    OR: [{ companyName: contains(value) }, { contactPerson: contains(value) }],
  });
  const wants = (source: WorkSource) => !filter.source || filter.source === source;
  const userId = filter.userId || null;

  const taskWhere: Prisma.TaskWhereInput = {
    status: "completed",
    completedAt: instantRange,
    ...(filter.company && { company: filter.company }),
    AND: [
      ...(userId
        ? [
            {
              OR: [
                { assignees: { some: { userId } } },
                { assignees: { none: {} }, completedById: userId },
              ],
            },
          ]
        : []),
      ...(search ? [{ OR: [{ title: contains(search) }, { client: clientMatch(search) }] }] : []),
    ],
  };

  const loggedWhere: Prisma.BillWhereInput = {
    // Work logged directly: not from a task or a compliance item
    taskId: null,
    complianceItem: { is: null },
    // A reissued bill is the same work again
    reissuedFromId: null,
    workDate: instantRange,
    ...(filter.company && { company: filter.company }),
    ...(userId && { createdById: userId }),
    ...(search && {
      OR: [{ description: contains(search) }, { billToName: contains(search) }, { client: clientMatch(search) }],
    }),
  };

  const complianceWhere: Prisma.ComplianceItemWhereInput = {
    status: { in: ["filed", "completed"] },
    // Periods entered from before tracking started were not done in the app
    historical: false,
    OR: [{ filedAt: { gte: fromDay, lte: toDay } }, { filedAt: null, completedAt: instantRange }],
    ...(filter.company && { workType: { company: filter.company } }),
    ...(userId && { completedById: userId }),
    ...(search && {
      AND: [{ OR: [{ workType: { name: contains(search) } }, { client: clientMatch(search) }] }],
    }),
  };

  const person = { select: { id: true, name: true } } as const;
  const [tasks, bills, items] = await Promise.all([
    wants("task")
      ? prisma.task.findMany({
          where: taskWhere,
          select: {
            id: true,
            title: true,
            company: true,
            completedAt: true,
            client: { select: { contactPerson: true, companyName: true } },
            completedBy: person,
            assignees: { select: { user: person }, orderBy: { assignedAt: "asc" } },
          },
          orderBy: { completedAt: "desc" },
          take: MAX_ROWS_PER_SOURCE + 1,
        })
      : Promise.resolve([]),
    wants("logged")
      ? prisma.bill.findMany({
          where: loggedWhere,
          select: {
            id: true,
            description: true,
            company: true,
            workDate: true,
            status: true,
            billToName: true,
            client: { select: { contactPerson: true, companyName: true } },
            createdBy: person,
            reissuedAs: { select: { id: true } },
          },
          orderBy: { workDate: "desc" },
          take: MAX_ROWS_PER_SOURCE + 1,
        })
      : Promise.resolve([]),
    wants("compliance")
      ? prisma.complianceItem.findMany({
          where: complianceWhere,
          select: {
            id: true,
            status: true,
            frequency: true,
            periodStart: true,
            filedAt: true,
            completedAt: true,
            workTypeId: true,
            workType: { select: { name: true, kind: true, company: true } },
            client: { select: { contactPerson: true, companyName: true } },
            completedBy: person,
            checkedBy: person,
          },
          orderBy: [{ filedAt: "desc" }, { completedAt: "desc" }],
          take: MAX_ROWS_PER_SOURCE + 1,
        })
      : Promise.resolve([]),
  ]);

  const tooMany = [tasks, bills, items].some((rows) => rows.length > MAX_ROWS_PER_SOURCE);

  const rows: WorkDoneRow[] = [];
  for (const t of tasks.slice(0, MAX_ROWS_PER_SOURCE)) {
    const assignees = t.assignees.map((a) => a.user);
    const doneBy = assignees.length ? assignees : t.completedBy ? [t.completedBy] : [];
    const markedBySomeoneElse = t.completedBy && !doneBy.some((p) => p.id === t.completedBy!.id);
    rows.push({
      key: `task:${t.id}`,
      source: "task",
      date: istDay(t.completedAt!),
      work: t.title,
      client: t.client ? partyName(t.client) : null,
      company: t.company,
      doneBy,
      note: markedBySomeoneElse ? `Marked completed by ${t.completedBy!.name}` : null,
      status: "Completed",
      href: `/dashboard/tasks/${t.id}`,
    });
  }
  for (const b of bills.slice(0, MAX_ROWS_PER_SOURCE)) {
    rows.push({
      key: `logged:${b.id}`,
      source: "logged",
      // Logged work is dated midday, so the day is the same anywhere in India
      date: istDay(b.workDate),
      work: b.description,
      client: b.client ? partyName(b.client) : b.billToName,
      company: b.company,
      doneBy: [b.createdBy],
      note: null,
      status: b.reissuedAs ? "Billed (reissued)" : BILL_STATUS_LABELS[b.status],
      href: b.createdBy.id === viewerId ? "/dashboard/billing?tab=mine" : null,
    });
  }
  for (const i of items.slice(0, MAX_ROWS_PER_SOURCE)) {
    const checkedBySomeoneElse = i.checkedBy && i.checkedBy.id !== i.completedBy?.id;
    const month = i.periodStart.toISOString().slice(0, 7);
    rows.push({
      key: `compliance:${i.id}`,
      source: "compliance",
      date: i.filedAt ? i.filedAt.toISOString().slice(0, 10) : istDay(i.completedAt!),
      work: `${i.workType.name} · ${periodLabel(i.frequency, i.periodStart)}`,
      client: partyName(i.client),
      company: i.workType.company,
      doneBy: i.completedBy ? [i.completedBy] : [],
      note: checkedBySomeoneElse ? `Checked by ${i.checkedBy!.name}` : i.checkedBy ? "Self-checked" : null,
      status: i.status === "filed" ? "Filed" : "Completed",
      href: `/dashboard/compliance?tab=${SHEET_TAB[i.workType.kind] ?? "work"}&month=${month}&item=${i.id}${
        i.workType.kind === "GENERIC" ? `&work=${i.workTypeId}` : ""
      }`,
    });
  }

  // Newest first; the same day keeps tasks, then logged work, then compliance
  rows.sort((a, b) => (a.date === b.date ? WORK_SOURCES.indexOf(a.source) - WORK_SOURCES.indexOf(b.source) : a.date < b.date ? 1 : -1));

  // Per person: how much work they did in these dates
  const counts = new Map<string, StaffCount>();
  for (const row of rows) {
    for (const p of row.doneBy) {
      const entry = counts.get(p.id) ?? { id: p.id, name: p.name, task: 0, logged: 0, compliance: 0, total: 0 };
      entry[row.source] += 1;
      entry.total += 1;
      counts.set(p.id, entry);
    }
  }
  const byStaff = [...counts.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return { rows, byStaff, tooMany };
}

// Filters from the address (?from=&to=&user=&company=&source=&search=).
// Without dates: this month so far.
export function parseWorkDoneFilter(params: URLSearchParams): WorkDoneFilter | { error: string } {
  const today = istDay(new Date());
  const from = params.get("from") || `${today.slice(0, 8)}01`;
  const to = params.get("to") || today;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return { error: "Enter the dates as YYYY-MM-DD" };
  }
  if (from > to) return { error: "The From date is after the To date" };
  const company = params.get("company");
  const source = params.get("source");
  return {
    from,
    to,
    userId: params.get("user") || null,
    company: company === "MVC" || company === "BEDGE" ? company : null,
    source: source && (WORK_SOURCES as string[]).includes(source) ? (source as WorkSource) : null,
    search: params.get("search")?.slice(0, 100) || null,
  };
}
