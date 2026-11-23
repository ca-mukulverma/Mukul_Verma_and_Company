import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncTaskAssignments } from "@/lib/task-assignment";

export const dynamic = "force-dynamic";

const MANAGERS = ["ADMIN", "PARTNER"];
const OPEN = ["NEW"];

async function me() {
  return getSessionUser(await getServerSession(authOptions));
}

// GET /api/whatsapp/inbox?show=open|all&clientId= – client WhatsApp messages.
// Admin and partners see every group; others the groups of clients they manage.
export async function GET(request: NextRequest) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const show = request.nextUrl.searchParams.get("show") ?? "open";
  const clientId = request.nextUrl.searchParams.get("clientId");
  const mine = MANAGERS.includes(user.role)
    ? undefined
    : (await prisma.client.findMany({ where: { managerId: user.id }, select: { id: true } })).map((c) => c.id);
  const where = {
    staffUserId: null,
    ...(show === "open" ? { status: { in: OPEN } } : { kind: { not: "CHAT" } }),
    ...(clientId ? { clientId } : {}),
    ...(mine ? { clientId: clientId && mine.includes(clientId) ? clientId : { in: mine } } : {}),
  };
  const rows = await prisma.waMessage.findMany({
    where,
    orderBy: { sentAt: "desc" },
    take: 300,
    select: {
      id: true, sentAt: true, senderName: true, senderPhone: true, text: true, fileName: true, kind: true, status: true,
      taskId: true, answeredAt: true, alertedAt: true, deskStatus: true, clientId: true, group: { select: { name: true } },
    },
  });
  const clients = await prisma.client.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x))] } },
    select: { id: true, companyName: true, contactPerson: true },
  });
  const names = Object.fromEntries(clients.map((c) => [c.id, c.companyName || c.contactPerson]));
  const counts = await prisma.waMessage.groupBy({
    by: ["status"],
    where: { ...where, status: undefined, kind: undefined, staffUserId: null },
    _count: true,
  });
  return NextResponse.json({
    messages: rows.map((r) => ({ ...r, clientName: r.clientId ? names[r.clientId] ?? null : null })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    canMakeTask: MANAGERS.includes(user.role),
  });
}

// PATCH /api/whatsapp/inbox – { id, action: task | answered | info | close | reopen, assigneeId? }
export async function PATCH(request: NextRequest) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const msg = await prisma.waMessage.findUnique({ where: { id: String(b.id ?? "") }, include: { group: true } });
  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (!MANAGERS.includes(user.role)) {
    const own = msg.clientId && (await prisma.client.findFirst({ where: { id: msg.clientId, managerId: user.id }, select: { id: true } }));
    if (!own) return NextResponse.json({ error: "Not your client" }, { status: 403 });
  }
  const action = String(b.action ?? "");
  if (action === "task") {
    if (!MANAGERS.includes(user.role)) return NextResponse.json({ error: "Only Admin and partners create tasks" }, { status: 403 });
    if (msg.taskId) return NextResponse.json({ error: "A task is already made", taskId: msg.taskId }, { status: 400 });
    const client = msg.clientId ? await prisma.client.findUnique({ where: { id: msg.clientId }, select: { managerId: true } }) : null;
    const assignee = String(b.assigneeId ?? "") || client?.managerId || user.id;
    const words = (msg.text ?? msg.fileName ?? "WhatsApp request").replace(/\s+/g, " ").trim();
    const task = await prisma.$transaction(async (tx) => {
      const t = await tx.task.create({
        data: {
          title: `WhatsApp: ${words}`.slice(0, 150),
          description: `From ${msg.senderName ?? msg.senderPhone} in "${msg.group.name}" on ${msg.sentAt.toISOString().slice(0, 16).replace("T", " ")} UTC:\n${msg.text ?? ""}${msg.fileName ? `\nFile: ${msg.fileName}` : ""}`,
          assignedById: user.id,
          clientId: msg.clientId,
          priority: "medium",
        },
      });
      await syncTaskAssignments(tx, t.id, [assignee]);
      return t;
    });
    await prisma.waMessage.update({ where: { id: msg.id }, data: { status: "TASK", taskId: task.id, doneById: user.id } });
    return NextResponse.json({ ok: true, taskId: task.id });
  }
  const status = { answered: "ANSWERED", info: "INFO", close: "CLOSED", reopen: "NEW" }[action];
  if (!status) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  await prisma.waMessage.update({
    where: { id: msg.id },
    data: {
      status, doneById: user.id,
      ...(status === "ANSWERED" ? { answeredAt: new Date(), answeredById: user.id } : {}),
      ...(status === "NEW" ? { alertedAt: null } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
