import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fileResponse } from "@/lib/bill-files";
import { buildTaskExport, MAX_TASK_ROWS } from "@/lib/task-transfer";

// GET /api/tasks/export – the tasks as an Excel file that Import tasks reads
// back (Admin: every task; Partner: the tasks they created or are assigned)
export async function GET() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (user?.role !== "ADMIN" && user?.role !== "PARTNER") {
    return NextResponse.json({ error: "Only administrators and partners can export tasks" }, { status: 403 });
  }

  const where: Prisma.TaskWhereInput =
    user.role === "ADMIN" ? {} : { OR: [{ assignedById: user.id }, { assignees: { some: { userId: user.id } } }] };
  const total = await prisma.task.count({ where });
  if (total > MAX_TASK_ROWS) {
    return NextResponse.json({ error: `There are ${total} tasks; the export holds up to ${MAX_TASK_ROWS}.` }, { status: 400 });
  }

  const file = await buildTaskExport(where, user.name);
  const stamp = new Date().toISOString().slice(0, 10);
  return fileResponse(file, "xlsx", `Tasks-${stamp}.xlsx`);
}
