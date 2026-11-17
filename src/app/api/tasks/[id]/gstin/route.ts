import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientCache } from "@/lib/cache";
import { GSTIN_PATTERN } from "@/lib/task-kinds";

const requestSchema = z.object({
  gstin: z
    .string()
    .transform((value) => value.replace(/\s/g, "").toUpperCase())
    .refine((value) => GSTIN_PATTERN.test(value), "GSTIN should be 15 characters starting with the state code"),
});

// POST /api/tasks/[id]/gstin { gstin } – after a GST registration task is
// completed, anyone on it saves the new GSTIN on the client (docs/TASKS.md).
// Only fills an empty GSTIN: a GSTIN already on the client is changed in the
// client's own form.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  const currentUser = getSessionUser(await getServerSession(authOptions));
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter the GSTIN" }, { status: 400 });
  const { gstin } = parsed.data;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      kind: true,
      status: true,
      title: true,
      assignedById: true,
      assignees: { where: { userId: currentUser.id }, select: { userId: true } },
      client: { select: { id: true, gstin: true } },
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const onTask = currentUser.role === "ADMIN" || task.assignedById === currentUser.id || task.assignees.length > 0;
  if (!onTask) return NextResponse.json({ error: "You are not on this task" }, { status: 403 });
  if (task.kind !== "GST_REGISTRATION" || task.status !== "completed" || !task.client) {
    return NextResponse.json({ error: "The GSTIN is saved from a completed GST registration task with a client" }, { status: 400 });
  }
  if (task.client.gstin) {
    return NextResponse.json({ error: "The client already has a GSTIN. Change it in the client's details." }, { status: 400 });
  }

  const clientId = task.client.id;
  // Only while it is still empty, in case someone else saved one meanwhile
  const updated = await prisma.client.updateMany({
    where: { id: clientId, OR: [{ gstin: null }, { gstin: "" }] },
    data: { gstin },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "The client already has a GSTIN. Change it in the client's details." }, { status: 400 });
  }

  after(async () => {
    await Promise.all([
      prisma.clientHistory
        .create({
          data: { clientId, content: `GSTIN ${gstin} added on completing the task "${task.title}".`, createdById: currentUser.id },
        })
        .catch((error) => console.error("Failed to note the GSTIN in client history:", error)),
      clientCache.delete(`client:${clientId}`).catch(() => undefined),
    ]);
  });
  return NextResponse.json({ gstin });
}
