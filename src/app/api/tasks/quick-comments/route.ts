import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_QUICK_COMMENTS, QUICK_COMMENTS_SETTING } from "@/lib/task-views";
import { getQuickComments } from "@/lib/task-follow-up";

// The one-click comments on task cards, in the bell and on Today

export async function GET() {
  if (!getSessionUser(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ comments: await getQuickComments() });
}

const putSchema = z.object({
  comments: z.array(z.string().trim().min(1).max(120)).min(1, "Keep at least one").max(MAX_QUICK_COMMENTS),
});

// PUT { comments } – Admin changes the list
export async function PUT(request: NextRequest) {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Only Admin changes the quick comments" }, { status: 403 });
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the comments" }, { status: 400 });
  const comments = [...new Set(parsed.data.comments)];
  await prisma.complianceSetting.upsert({
    where: { key: QUICK_COMMENTS_SETTING },
    create: { key: QUICK_COMMENTS_SETTING, value: comments },
    update: { value: comments },
  });
  return NextResponse.json({ comments });
}
