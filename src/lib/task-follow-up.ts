import { prisma } from "@/lib/prisma";
import { DEFAULT_QUICK_COMMENTS, QUICK_COMMENTS_SETTING } from "@/lib/task-views";

// Following up tasks (docs/TASKS.md): Admins, and partners Admin switches on
// (Settings → Permissions → Follow up tasks), see the last comments and the
// one-click comments on the task cards, and their comments ask for a reply.

export async function canFollowUpTasks(user: { id: string; role: string }): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (user.role !== "PARTNER") return false;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { canFollowUpTasks: true } });
  return !!row?.canFollowUpTasks;
}

export async function getQuickComments(): Promise<string[]> {
  const setting = await prisma.complianceSetting.findUnique({ where: { key: QUICK_COMMENTS_SETTING } });
  const value = setting?.value;
  return Array.isArray(value) && value.length && value.every((v) => typeof v === "string")
    ? (value as string[])
    : DEFAULT_QUICK_COMMENTS;
}
