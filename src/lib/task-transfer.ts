import ExcelJS from "exceljs";
import { Company, Prisma, TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatIndianDate } from "@/lib/billing-constants";

// Tasks out to Excel and back in (Admin, Partner): download the tasks before
// the task data is cleared, then upload the file to add them again as new
// tasks. Clients and staff are found again by GSTIN, name or email, so the
// file still works after clients are re-imported.

export const MAX_TASK_ROWS = 5000;

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  review: "Review",
  completed: "Completed",
  cancelled: "Cancelled",
};
const PRIORITY_LABELS: Record<TaskPriority, string> = { low: "Low", medium: "Medium", high: "High" };
const COMPANY_NAMES: Record<Company, string> = { MVC: "MVC", BEDGE: "B Edge" };

const COLUMNS = [
  { key: "title", header: "Title*", width: 40, note: "Required. 3 to 150 characters." },
  { key: "description", header: "Description", width: 50, note: "Optional." },
  { key: "client", header: "Client", width: 32, note: "Optional. Company name or contact person of a client in the app." },
  { key: "clientGstin", header: "Client GSTIN", width: 18, note: "Optional. Finds the client first by GSTIN, then by name." },
  { key: "company", header: "Company", width: 10, note: "MVC or B Edge. Empty means MVC." },
  { key: "priority", header: "Priority", width: 10, note: "Low, Medium or High. Empty means Medium." },
  { key: "status", header: "Status", width: 13, note: "Pending, In progress or Review. Completed and Cancelled tasks are added as Pending." },
  { key: "dueDate", header: "Due date", width: 12, note: "Optional. A date, e.g. 15/11/2026." },
  { key: "assignees", header: "Assigned to (emails)", width: 40, note: "Optional. Staff emails separated by commas; names also work." },
] as const;

// Columns written in the export for reference only, not read on import
const INFO_COLUMNS = [
  { key: "assigneeNames", header: "Assigned to (names)", width: 30 },
  { key: "assignedBy", header: "Created by", width: 20 },
  { key: "createdAt", header: "Created on", width: 12 },
  { key: "billing", header: "Billing", width: 16 },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];
type RowData = Record<ColumnKey, string | null>;

export interface TaskImportRow {
  row: number;
  data: RowData;
  errors: string[];
  warnings: string[];
  duplicate: string | null;
  // Resolved values, set when the row has no errors
  task?: {
    title: string;
    description: string | null;
    clientId: string | null;
    company: Company;
    priority: TaskPriority;
    status: TaskStatus;
    dueDate: string | null; // ISO
    assigneeIds: string[];
  };
}

export class TaskImportFileError extends Error {}

// "2026-11-15" as the start of that day in India, as the date picker saves it
function istDay(ymd: string) {
  return new Date(`${ymd}T00:00:00+05:30`);
}

// The day of a date in India, as yyyy-mm-dd
function istYmd(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export async function buildTaskExport(where: Prisma.TaskWhereInput, downloadedBy: string): Promise<Buffer> {
  const tasks = await prisma.task.findMany({
    where,
    include: {
      client: { select: { contactPerson: true, companyName: true, gstin: true } },
      assignees: { include: { user: { select: { name: true, email: true } } } },
      assignedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_TASK_ROWS,
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MV Company";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Tasks", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [...COLUMNS, ...INFO_COLUMNS].map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  COLUMNS.forEach((c, i) => {
    header.getCell(i + 1).note = c.note;
  });
  INFO_COLUMNS.forEach((_, i) => {
    const cell = header.getCell(COLUMNS.length + i + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6B7280" } };
    cell.note = "For reference only; not read on import.";
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  sheet.getColumn("clientGstin").numFmt = "@";
  sheet.getColumn("dueDate").numFmt = "dd/mm/yyyy";

  for (const task of tasks) {
    const row = sheet.addRow({
      title: task.title,
      description: task.description ?? "",
      client: task.client ? task.client.companyName || task.client.contactPerson : "",
      clientGstin: task.client?.gstin ?? "",
      company: COMPANY_NAMES[task.company],
      priority: PRIORITY_LABELS[task.priority],
      status: STATUS_LABELS[task.status],
      // The India day at midnight UTC, so Excel shows the same date
      dueDate: task.dueDate ? new Date(`${istYmd(task.dueDate)}T00:00:00Z`) : null,
      assignees: task.assignees.map((a) => a.user.email).join(", "),
      assigneeNames: task.assignees.map((a) => a.user.name).join(", "),
      assignedBy: task.assignedBy.name,
      createdAt: formatIndianDate(task.createdAt),
      billing:
        task.status !== "completed" ? "" : task.billingStatus === "billed" || task.billingStatus === "paid" ? "Billed" : "Pending billing",
    });
    row.alignment = { vertical: "top", wrapText: true };
  }

  // Drop-down lists for the fixed choices
  const lastRow = Math.max(tasks.length + 1, 500);
  const lists: [ColumnKey, string[]][] = [
    ["company", Object.values(COMPANY_NAMES)],
    ["priority", Object.values(PRIORITY_LABELS)],
    ["status", Object.values(STATUS_LABELS)],
  ];
  for (const [key, values] of lists) {
    const col = sheet.getColumn(key).letter;
    for (let r = 2; r <= lastRow; r++) {
      sheet.getCell(`${col}${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${values.join(",")}"`],
      };
    }
  }

  const help = workbook.addWorksheet("Instructions");
  help.columns = [{ width: 24 }, { width: 100 }];
  const lines: [string, string][] = [
    ["Downloaded on", formatIndianDate(new Date(), "medium")],
    ["Downloaded by", downloadedBy],
    ["Tasks", String(tasks.length)],
    ["", ""],
    ["How to import", "Change the 'Tasks' sheet as you need (edit, delete or add rows; update due dates), then upload it in"],
    ["", "Tasks → Import tasks. Every row is checked and shown before anything is saved."],
    ["New tasks", "Each row is added as a new task, created by the person importing. Comments and bills are not carried over."],
    ["Clients", "Found by GSTIN, then by company name or contact person. If no client matches, the task is added without one."],
    ["Staff", "Found by email (or name). Staff not found are left out; the task is still added."],
    ["Duplicates", "A row with the same title and client as a task already in the app is skipped, so the file can be uploaded again safely."],
    ["Limit", `Up to ${MAX_TASK_ROWS} tasks per file.`],
    ["", ""],
    ["Column", "What to enter"],
    ...COLUMNS.map((c) => [c.header, c.note] as [string, string]),
    ...INFO_COLUMNS.map((c) => [c.header, "For reference only; not read on import."] as [string, string]),
  ];
  for (const line of lines) help.addRow(line);
  help.getColumn(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  }
  return String(value);
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function readTaskRows(buffer: ArrayBuffer): Promise<{ row: number; data: RowData }[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new TaskImportFileError("This file could not be read. Please upload the .xlsx file downloaded from Export tasks.");
  }
  const sheet = workbook.getWorksheet("Tasks") ?? workbook.worksheets[0];
  if (!sheet) throw new TaskImportFileError("The file has no sheets.");

  const positions = new Map<ColumnKey, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const heading = normalise(cellText(cell.value));
    const column = COLUMNS.find((c) => normalise(c.header) === heading);
    if (column) positions.set(column.key, col);
  });
  if (!positions.has("title")) {
    throw new TaskImportFileError("The 'Title*' column was not found. Please use the file from Export tasks.");
  }

  const rows: { row: number; data: RowData }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = Object.fromEntries(
      COLUMNS.map((c) => {
        const col = positions.get(c.key);
        const text = col ? cellText(row.getCell(col).value).trim() : "";
        return [c.key, text || null];
      })
    ) as RowData;
    if (Object.values(data).some((v) => v !== null)) rows.push({ row: rowNumber, data });
  });

  if (rows.length > MAX_TASK_ROWS) {
    throw new TaskImportFileError(`The file has ${rows.length} tasks; the limit is ${MAX_TASK_ROWS} per file.`);
  }
  return rows;
}

// Due date text as yyyy-mm-dd: 2026-11-15, 15/11/2026, 15-11-26, 15.11.2026
function parseDay(text: string): string | null {
  let y: number, m: number, d: number;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

function pick<T extends string>(labels: Record<T, string>, text: string | null): T | null | undefined {
  if (!text) return null;
  const wanted = normalise(text);
  return (Object.keys(labels) as T[]).find((k) => normalise(labels[k]) === wanted || normalise(k) === wanted);
}

export interface TaskImportOptions {
  allPending: boolean; // start every task as Pending
  clearDueDates: boolean; // leave every due date empty
}

export async function checkTaskRows(
  rows: { row: number; data: RowData }[],
  options: TaskImportOptions
): Promise<TaskImportRow[]> {
  const [clients, users, existing] = await Promise.all([
    prisma.client.findMany({ select: { id: true, contactPerson: true, companyName: true, gstin: true } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true } }),
    prisma.task.findMany({ select: { title: true, clientId: true } }),
  ]);

  const byGstin = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const c of clients) {
    if (c.gstin) byGstin.set(c.gstin.toUpperCase(), c.id);
    for (const name of new Set([c.companyName, c.contactPerson].filter(Boolean).map((n) => normalise(n!)))) {
      byName.set(name, [...(byName.get(name) ?? []), c.id]);
    }
  }
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const byUserName = new Map<string, string[]>();
  for (const u of users) byUserName.set(normalise(u.name), [...(byUserName.get(normalise(u.name)) ?? []), u.id]);

  const taskKey = (title: string, clientId: string | null) => `${title.trim().toLowerCase()}|${clientId ?? ""}`;
  const seen = new Map<string, string>(existing.map((t) => [taskKey(t.title, t.clientId), "a task already in the app"]));

  return rows.map(({ row, data }) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const title = data.title ?? "";
    if (!title) errors.push("Title is missing");
    else if (title.length < 3) errors.push("Title should be at least 3 characters");
    else if (title.length > 150) errors.push("Title is longer than 150 characters");

    // Client: GSTIN first, then a name that matches exactly one client
    let clientId: string | null = null;
    if (data.clientGstin || data.client) {
      const gstin = data.clientGstin?.toUpperCase().replace(/\s/g, "");
      const named = data.client ? byName.get(normalise(data.client)) ?? [] : [];
      if (gstin && byGstin.has(gstin)) clientId = byGstin.get(gstin)!;
      else if (named.length === 1) clientId = named[0];
      else if (named.length > 1) warnings.push(`More than one client is named "${data.client}"; added without a client`);
      else warnings.push(`Client "${data.client || gstin}" not found; added without a client`);
    }

    const company = pick(COMPANY_NAMES, data.company);
    if (company === undefined) errors.push("Company should be MVC or B Edge");
    const priority = pick(PRIORITY_LABELS, data.priority);
    if (priority === undefined) errors.push("Priority should be Low, Medium or High");
    let status = pick(STATUS_LABELS, data.status);
    if (status === undefined) errors.push("Status should be Pending, In progress or Review");
    if (options.allPending || status === "completed" || status === "cancelled" || !status) status = "pending";

    let dueDate: string | null = null;
    if (data.dueDate && !options.clearDueDates) {
      const day = parseDay(data.dueDate);
      if (day) dueDate = istDay(day).toISOString();
      else errors.push("Due date is not a date (use e.g. 15/11/2026)");
    }

    const assigneeIds: string[] = [];
    for (const part of (data.assignees ?? "").split(/[,;\n]/).map((p) => p.trim()).filter(Boolean)) {
      const id = byEmail.get(part.toLowerCase()) ?? (byUserName.get(normalise(part))?.length === 1 ? byUserName.get(normalise(part))![0] : undefined);
      if (id) {
        if (!assigneeIds.includes(id)) assigneeIds.push(id);
      } else warnings.push(`Staff "${part}" not found; left out`);
    }

    let duplicate: string | null = null;
    if (errors.length === 0) {
      const key = taskKey(title, clientId);
      if (seen.has(key)) duplicate = `Same title and client as ${seen.get(key)}`;
      else seen.set(key, `row ${row}`);
    }

    return {
      row,
      data,
      errors,
      warnings,
      duplicate,
      ...(errors.length === 0 && {
        task: {
          title,
          description: data.description,
          clientId,
          company: company ?? "MVC",
          priority: priority ?? "medium",
          status,
          dueDate,
          assigneeIds,
        },
      }),
    };
  });
}

// Adds the rows that passed every check as new tasks created by the importer;
// returns how many were added. No notifications are sent for imported tasks.
export async function importTaskRows(rows: TaskImportRow[], userId: string) {
  const ready = rows.filter((r) => r.task && !r.duplicate).map((r) => r.task!);
  if (ready.length === 0) return 0;

  const tasks = ready.map((t) => ({ ...t, id: crypto.randomUUID() }));
  await prisma.$transaction([
    prisma.task.createMany({
      data: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        clientId: t.clientId,
        company: t.company,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate ? new Date(t.dueDate) : null,
        assignedById: userId,
      })),
    }),
    prisma.taskAssignee.createMany({
      data: tasks.flatMap((t) => t.assigneeIds.map((assigneeId) => ({ taskId: t.id, userId: assigneeId }))),
      skipDuplicates: true,
    }),
    prisma.activity.create({
      data: {
        type: "task",
        action: "created",
        target: `Imported ${tasks.length} task${tasks.length === 1 ? "" : "s"} from Excel`,
        userId,
      },
    }),
  ]);
  return tasks.length;
}
