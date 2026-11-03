import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";
import { todayIST } from "@/lib/compliance-periods";
import { marksAttendance } from "@/lib/attendance";
import { ANNOUNCEMENTS, Announcement, Audience, PUSH_WINDOW_DAYS, findAnnouncement } from "@/lib/whats-new";

// What's new on the server: who each card is for, and its one-time push.

interface AudienceUser {
  role: string;
  isActive: boolean;
  marksAttendance: boolean;
}

export function inAudience(user: AudienceUser, audience: Audience) {
  if (!user.isActive) return false;
  if (audience === "admin") return user.role === "ADMIN";
  if (audience === "attendance") return marksAttendance(user);
  return true;
}

// The cards meant for this person (newest first)
export async function myAnnouncementIds(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, marksAttendance: true },
  });
  if (!user) return [];
  return ANNOUNCEMENTS.filter((a) => inAudience(user, a.audience)).map((a) => a.id);
}

export async function pushStatus() {
  const rows = await prisma.announcementPush.findMany();
  return Object.fromEntries(rows.map((r) => [r.id, { sentAt: r.sentAt.toISOString(), recipients: r.recipients }]));
}

export type PushResult = { sent: true; recipients: number } | { sent: false; reason: string };

// Sends the card's push (and bell notification) once. A second call does
// nothing, so the daily job and "Send now" can't send it twice.
export async function sendAnnouncementPush(announcement: Announcement): Promise<PushResult> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, role: true, isActive: true, marksAttendance: true },
  });
  const sender = users.find((u) => u.role === "ADMIN")?.id;
  if (!sender) return { sent: false, reason: "No active Admin to send from" };
  const recipients = users.filter((u) => inAudience(u, announcement.audience));

  // Claim it first: if it was already sent, stop here
  const { count } = await prisma.announcementPush.createMany({
    data: [{ id: announcement.id, recipients: recipients.length }],
    skipDuplicates: true,
  });
  if (count === 0) return { sent: false, reason: "Already sent" };

  const { title, body } = announcement.push;
  const url = `/dashboard/whats-new?open=${announcement.id}`;
  // One person at a time: one database connection
  for (const user of recipients) {
    try {
      await prisma.notification.create({ data: { title, content: body, sentById: sender, sentToId: user.id } });
    } catch (error) {
      console.error("Failed to save announcement notification:", error);
    }
    await sendPushToUser(user.id, { title, body, url, tag: `whats-new-${announcement.id}` });
  }
  return { sent: true, recipients: recipients.length };
}

export async function sendAnnouncementPushById(id: string) {
  const announcement = findAnnouncement(id);
  if (!announcement) return { sent: false as const, reason: "Unknown announcement" };
  return sendAnnouncementPush(announcement);
}

// Daily job: the pushes of cards that launched in the last week and haven't
// gone out yet (older cards never send, so adding one late can't spam)
export async function runAnnouncementPushes() {
  const today = todayIST().getTime();
  const sent = await pushStatus();
  const due = ANNOUNCEMENTS.filter((a) => {
    const launch = new Date(`${a.date}T00:00:00Z`).getTime();
    return !sent[a.id] && launch <= today && today - launch <= PUSH_WINDOW_DAYS * 86_400_000;
  });

  const results: string[] = [];
  for (const announcement of due) {
    const result = await sendAnnouncementPush(announcement);
    results.push(`${announcement.id}: ${result.sent ? `sent to ${result.recipients}` : result.reason}`);
  }
  return { message: results.length ? results.join("; ") : "Nothing to send" };
}
