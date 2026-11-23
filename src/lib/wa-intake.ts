import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { sendPushToUser } from "@/lib/web-push";
import { deleteObject, downloadUrl, r2Configured, uploadUrl } from "@/lib/r2";
import { classify, last10, officeMinutes } from "@/lib/wa-classify";

export { classify, last10, officeMinutes };

/**
 * WhatsApp intake (docs/WHATSAPP_INTAKE.md).
 *
 * The firm's dedicated number sits in every client group. A small listener on
 * the office PC (listener/ in this repository) collects what is said there and
 * calls this app:
 *   POST /api/whatsapp/upload-url – a 10-minute R2 link to upload one file to
 *   POST /api/whatsapp/batch      – the messages since the last call (every 30
 *                                   minutes 11:00–20:00 IST, once after 20:00)
 * A client's Desk collects its files at its own contact times (Redis only):
 *   GET  /api/desk/files          – files + texts waiting for this Desk
 *   POST /api/desk/files/ack      – collected: the R2 copy is deleted
 *
 * Neon cost: one database call per batch, inside office use; the Desk's calls
 * are answered from Redis (like the Control Centre's rules). The unanswered-
 * message alert and the evening summary run inside the batch call: no cron.
 */

export const UNANSWERED_HOURS = Number(process.env.WA_UNANSWERED_HOURS ?? 3); // MV, 23-Nov-2026
const DESK_FEED = "wa:desk:"; // + Desk code -> list of JSON items
const ACKED = "wa:desk:acked"; // set of WaMessage ids collected by a Desk (written to the DB at the next batch)
const LISTENER_SEEN = "wa:listener:seen";
const STAFF_CACHE = "wa:staff:v1";
const DAY = 24 * 60 * 60;


export interface IncomingMessage {
  waId: string;
  groupJid: string;
  groupName?: string;
  senderPhone: string;
  senderName?: string;
  sentAt: string; // ISO
  text?: string;
  fileName?: string;
  fileKey?: string;
  fileSize?: number;
}

// ------------------------------------------------------------------ listener key
const sha = (s: string) => crypto.createHash("sha256").update(s).digest();

/** True when "Authorization: Bearer <WA_LISTENER_KEY>" matches (Vercel env). */
export async function listenerFromRequest(request: Request): Promise<boolean> {
  const want = process.env.WA_LISTENER_KEY;
  if (!want || want.length < 20) return false;
  const m = /^Bearer\s+(\S{20,200})$/.exec((request.headers.get("authorization") ?? "").trim());
  if (!m || !crypto.timingSafeEqual(sha(m[1]), sha(want))) return false;
  try {
    await redis.set(LISTENER_SEEN, new Date().toISOString(), "EX", 30 * DAY);
  } catch {
    /* optional */
  }
  return true;
}

export async function listenerLastSeen(): Promise<string | null> {
  try {
    return await redis.get(LISTENER_SEEN);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ staff phones

/** {last 10 digits: userId} of active staff whose phone is saved (Users). Cached for an hour. */
async function staffPhones(): Promise<Record<string, string>> {
  try {
    const c = await redis.get(STAFF_CACHE);
    if (c) return JSON.parse(c);
  } catch {
    /* fall through */
  }
  const users = await prisma.user.findMany({ where: { isActive: true, phone: { not: null } }, select: { id: true, phone: true } });
  const map = Object.fromEntries(users.filter((u) => last10(u.phone).length === 10).map((u) => [last10(u.phone), u.id]));
  try {
    await redis.set(STAFF_CACHE, JSON.stringify(map), "EX", 3600);
  } catch {
    /* optional */
  }
  return map;
}

export async function forgetStaffPhones() {
  try {
    await redis.del(STAFF_CACHE);
  } catch {
    /* optional */
  }
}

// ------------------------------------------------------------------ files
export function fileKeyFor(fileName: string) {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "file";
  const ym = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 7);
  return `whatsapp/${ym}/${crypto.randomUUID()}-${safe}`;
}

export async function fileUploadUrl(fileName: string, contentType: string) {
  if (!r2Configured()) throw new Error("File storage (R2) is not set up");
  const key = fileKeyFor(fileName);
  return { key, url: await uploadUrl(key, contentType || "application/octet-stream", false) };
}

// ------------------------------------------------------------------ the Desk's feed (Redis only)
export interface DeskItem {
  id: string; // WaMessage id
  waId: string;
  receivedAt: string;
  sender: string;
  senderName: string | null;
  caption: string | null;
  text: string | null;
  fileName: string | null;
  fileKey: string | null;
}

export async function deskItems(code: string): Promise<(DeskItem & { url: string | null })[]> {
  let raw: string[] = [];
  try {
    raw = await redis.lrange(DESK_FEED + code, 0, 199);
  } catch {
    return [];
  }
  const items = raw.map((r) => JSON.parse(r) as DeskItem);
  return Promise.all(
    items.map(async (i) => ({ ...i, url: i.fileKey && r2Configured() ? await downloadUrl(i.fileKey, i.fileName ?? "file", 900) : null }))
  );
}

/** The Desk has the items: delete the R2 copies, drop them from the feed, remember for the database. */
export async function ackDeskItems(code: string, ids: string[]) {
  const want = new Set(ids);
  let raw: string[] = [];
  try {
    raw = await redis.lrange(DESK_FEED + code, 0, -1);
  } catch {
    return 0;
  }
  let n = 0;
  for (const r of raw) {
    const i = JSON.parse(r) as DeskItem;
    if (!want.has(i.id)) continue;
    if (i.fileKey && r2Configured()) {
      try {
        await deleteObject(i.fileKey);
      } catch {
        /* deleted later by the clean-up of old files */
      }
    }
    await redis.lrem(DESK_FEED + code, 1, r);
    await redis.sadd(ACKED, i.id);
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ the batch
export interface BatchResult {
  saved: number;
  answered: number;
  alerts: number;
  groups: number;
  summary: number;
}

export async function saveBatch(messages: IncomingMessage[], endOfDay = false, now = new Date()): Promise<BatchResult> {
  const res: BatchResult = { saved: 0, answered: 0, alerts: 0, groups: 0, summary: 0 };
  // Desk collections since the last batch
  let acked: string[] = [];
  try {
    acked = await redis.smembers(ACKED);
  } catch {
    /* optional */
  }
  if (acked.length) {
    await prisma.waMessage.updateMany({ where: { id: { in: acked } }, data: { deskStatus: "COLLECTED", fileKey: null } });
    try {
      await redis.srem(ACKED, ...acked);
    } catch {
      /* optional */
    }
  }
  const staff = await staffPhones();
  const groups = new Map<string, { id: string; clientId: string | null; deskCode: string | null }>();
  for (const jid of [...new Set(messages.map((m) => m.groupJid))]) {
    const name = messages.find((m) => m.groupJid === jid && m.groupName)?.groupName ?? jid;
    const g = await prisma.waGroup.upsert({
      where: { jid },
      create: { jid, name: name.slice(0, 120) },
      update: { name: name.slice(0, 120) },
    });
    let deskCode: string | null = null;
    if (g.deskClientId) {
      const d = await prisma.deskClient.findUnique({ where: { id: g.deskClientId }, select: { code: true, active: true } });
      deskCode = d?.active ? d.code : null;
    }
    groups.set(jid, { id: g.id, clientId: g.active ? g.clientId : null, deskCode: g.active ? deskCode : null });
    res.groups++;
  }
  for (const m of [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) {
    const g = groups.get(m.groupJid)!;
    if (await prisma.waMessage.findUnique({ where: { waId: m.waId }, select: { id: true } })) continue;
    const staffUserId = staff[last10(m.senderPhone)] ?? null;
    const { kind, status } = classify(m.text, !!m.fileName, !!staffUserId);
    const toDesk = !!g.deskCode && !staffUserId && (!!m.fileKey || !!m.text);
    const row = await prisma.waMessage.create({
      data: {
        waId: m.waId, groupId: g.id, clientId: g.clientId, senderPhone: last10(m.senderPhone) || m.senderPhone.slice(0, 20),
        senderName: m.senderName?.slice(0, 80) ?? null, staffUserId, text: m.text ?? null,
        fileName: m.fileName?.slice(0, 200) ?? null, fileKey: m.fileKey ?? null, fileSize: m.fileSize ?? null, kind,
        status, deskStatus: toDesk ? "WAITING" : null, sentAt: new Date(m.sentAt),
      },
    });
    res.saved++;
    if (staffUserId) {
      // a reply from MVC answers every open client message in the group sent before it
      const u = await prisma.waMessage.updateMany({
        where: { groupId: g.id, status: "NEW", staffUserId: null, sentAt: { lte: row.sentAt } },
        data: { status: "ANSWERED", answeredAt: row.sentAt, answeredById: staffUserId },
      });
      res.answered += u.count;
    }
    if (toDesk) {
      const item: DeskItem = {
        id: row.id, waId: row.waId, receivedAt: m.sentAt, sender: row.senderPhone, senderName: row.senderName,
        caption: m.fileName ? m.text ?? null : null, text: m.fileName ? null : m.text ?? null,
        fileName: row.fileName, fileKey: row.fileKey,
      };
      try {
        await redis.rpush(DESK_FEED + g.deskCode, JSON.stringify(item));
        await redis.expire(DESK_FEED + g.deskCode, 14 * DAY);
      } catch {
        /* the Desk falls back to nothing; the file stays in R2 and in the Inbox */
      }
    }
  }
  res.alerts = await sendUnansweredAlerts(now);
  if (endOfDay) res.summary = await sendEveningSummary(now);
  return res;
}

// ------------------------------------------------------------------ alerts
async function managersOf(clientIds: string[]) {
  const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, managerId: true, companyName: true, contactPerson: true } });
  return new Map(clients.map((c) => [c.id, c]));
}

/** Client requests with no MVC reply and no task after 3 office hours: push to the client's manager and Admins. */
export async function sendUnansweredAlerts(now = new Date()) {
  const open = await prisma.waMessage.findMany({
    where: { status: "NEW", alertedAt: null, sentAt: { lte: new Date(now.getTime() - UNANSWERED_HOURS * 3600 * 1000) } },
    include: { group: { select: { name: true } } },
    take: 200,
  });
  const late = open.filter((m) => officeMinutes(m.sentAt, now) >= UNANSWERED_HOURS * 60);
  if (!late.length) return 0;
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  const mgr = await managersOf([...new Set(late.map((m) => m.clientId).filter((x): x is string => !!x))]);
  const byUser = new Map<string, string[]>();
  for (const m of late) {
    const who = new Set(admins.map((a) => a.id));
    const c = m.clientId ? mgr.get(m.clientId) : null;
    if (c?.managerId) who.add(c.managerId);
    const line = `${m.group.name}: "${(m.text ?? m.fileName ?? "").slice(0, 60)}"`;
    for (const u of who) byUser.set(u, [...(byUser.get(u) ?? []), line]);
  }
  const sender = admins[0]?.id;
  for (const [userId, lines] of byUser) {
    const title = `WhatsApp: ${lines.length} client message${lines.length === 1 ? "" : "s"} without a reply for ${UNANSWERED_HOURS} hours`;
    const content = `${lines.slice(0, 5).join(" | ")}${lines.length > 5 ? ` and ${lines.length - 5} more` : ""}. Open the WhatsApp inbox.`;
    if (sender) {
      try {
        await prisma.notification.create({ data: { title, content, sentById: sender, sentToId: userId } });
      } catch {
        /* the push still goes */
      }
    }
    await sendPushToUser(userId, { title, body: content, url: "/dashboard/whatsapp", tag: "wa-unanswered" });
  }
  await prisma.waMessage.updateMany({ where: { id: { in: late.map((m) => m.id) } }, data: { alertedAt: now } });
  return late.length;
}

/** After office hours: open client messages per manager (one push each), Admin gets the whole list. */
export async function sendEveningSummary(now = new Date()) {
  const open = await prisma.waMessage.findMany({
    where: { status: "NEW" },
    select: { clientId: true, group: { select: { name: true } } },
  });
  if (!open.length) return 0;
  const mgr = await managersOf([...new Set(open.map((m) => m.clientId).filter((x): x is string => !!x))]);
  const per = new Map<string, Map<string, number>>();
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  for (const m of open) {
    const users = new Set(admins.map((a) => a.id));
    const c = m.clientId ? mgr.get(m.clientId) : null;
    if (c?.managerId) users.add(c.managerId);
    for (const u of users) {
      const g = per.get(u) ?? new Map<string, number>();
      g.set(m.group.name, (g.get(m.group.name) ?? 0) + 1);
      per.set(u, g);
    }
  }
  for (const [userId, g] of per) {
    const total = [...g.values()].reduce((a, b) => a + b, 0);
    await sendPushToUser(userId, {
      title: `WhatsApp: ${total} client message${total === 1 ? "" : "s"} still open`,
      body: [...g.entries()].map(([n, c]) => `${n} ${c}`).join(", "),
      url: "/dashboard/whatsapp",
      tag: "wa-evening",
    });
  }
  void now;
  return per.size;
}
