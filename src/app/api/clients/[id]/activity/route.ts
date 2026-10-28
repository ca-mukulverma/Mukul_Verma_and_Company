import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EVENT_LABELS } from "@/components/compliance/event-labels";
import { periodLabel } from "@/lib/compliance-periods";

const LIMIT = 8;

export interface ActivityEntry {
  id: string;
  at: string;
  who: string | null;
  text: string;
  href: string | null;
}

// GET /api/clients/:id/activity – the latest things done for a client, from
// tasks, compliance, history notes and Send to Client, newest first
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: clientId } = await params;

  const [notes, tasks, events, dispatches] = await Promise.all([
    prisma.clientHistory.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: { id: true, content: true, createdAt: true, taskId: true, createdBy: { select: { name: true } } },
    }),
    prisma.task.findMany({
      where: { clientId, lastStatusUpdatedAt: { not: null } },
      orderBy: { lastStatusUpdatedAt: "desc" },
      take: LIMIT,
      select: { id: true, title: true, status: true, lastStatusUpdatedAt: true, lastStatusUpdatedBy: { select: { name: true } } },
    }),
    prisma.complianceEvent.findMany({
      where: { item: { clientId } },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: {
        id: true,
        action: true,
        createdAt: true,
        user: { select: { name: true } },
        item: { select: { frequency: true, periodStart: true, workType: { select: { name: true } } } },
      },
    }),
    prisma.clientDispatch.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: { id: true, requestName: true, sentTo: true, createdAt: true, sentBy: { select: { name: true } } },
    }),
  ]);

  const entries: ActivityEntry[] = [
    ...notes.map((n) => ({
      id: `note-${n.id}`,
      at: n.createdAt.toISOString(),
      who: n.createdBy?.name ?? null,
      text: n.content.length > 140 ? `${n.content.slice(0, 140)}…` : n.content,
      href: n.taskId ? `/dashboard/tasks/${n.taskId}` : null,
    })),
    ...tasks.map((t) => ({
      id: `task-${t.id}`,
      at: t.lastStatusUpdatedAt!.toISOString(),
      who: t.lastStatusUpdatedBy?.name ?? null,
      text: `Task “${t.title}” set to ${t.status.replace("_", " ")}`,
      href: `/dashboard/tasks/${t.id}`,
    })),
    ...events.map((e) => ({
      id: `compliance-${e.id}`,
      at: e.createdAt.toISOString(),
      who: e.user?.name ?? null,
      text: `${e.item.workType.name} ${periodLabel(e.item.frequency, e.item.periodStart)}: ${EVENT_LABELS[e.action] ?? e.action.replace(/_/g, " ")}`,
      href: `/dashboard/compliance?tab=clients&client=${clientId}`,
    })),
    ...dispatches.map((d) => ({
      id: `sent-${d.id}`,
      at: d.createdAt.toISOString(),
      who: d.sentBy?.name ?? null,
      text: `Sent “${d.requestName}” to ${d.sentTo}`,
      href: `/dashboard/clients/${clientId}/send`,
    })),
  ];

  entries.sort((a, b) => b.at.localeCompare(a.at));
  return NextResponse.json({ entries: entries.slice(0, LIMIT) });
}
