/**
 * Web Push (iPhone home-screen app, Android Chrome, desktop browsers).
 *
 * Safe by design:
 *  - If the VAPID_* environment variables are not set, every function quietly does nothing.
 *  - Errors are caught and logged; they never break the request that created the notification.
 *  - Subscriptions live in their own new table "PushSubscription" (created automatically,
 *    IF NOT EXISTS). No existing table or data is changed.
 */
import webpush from "web-push";
import { basePrisma as db } from "@/lib/prisma";

const globalForPush = global as unknown as { pushTableReady?: Promise<void> };

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

let configured = false;
export function pushEnabled(): boolean {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false;
  if (!configured) {
    try {
      webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
      configured = true;
    } catch (e) {
      console.error("[push] invalid VAPID keys", e);
      return false;
    }
  }
  return true;
}

export function getPublicKey(): string {
  return PUBLIC_KEY;
}

/** Creates the PushSubscription table once (additive, idempotent). */
function ensureTable(): Promise<void> {
  if (!globalForPush.pushTableReady) {
    globalForPush.pushTableReady = (async () => {
      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PushSubscription" (
          "id"        CHAR(36)     NOT NULL,
          "userId"    CHAR(36)     NOT NULL,
          "endpoint"  TEXT         NOT NULL,
          "p256dh"    VARCHAR(255) NOT NULL,
          "auth"      VARCHAR(100) NOT NULL,
          "userAgent" VARCHAR(255),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
        )`);
      await db.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint")`
      );
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId")`
      );
    })().catch((e) => {
      globalForPush.pushTableReady = undefined; // retry next time
      throw e;
    });
  }
  return globalForPush.pushTableReady;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(userId: string, sub: PushSubscriptionInput, userAgent?: string | null) {
  await ensureTable();
  await db.$executeRaw`
    INSERT INTO "PushSubscription" ("id", "userId", "endpoint", "p256dh", "auth", "userAgent")
    VALUES (${crypto.randomUUID()}, ${userId}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth},
            ${(userAgent || "").slice(0, 250)})
    ON CONFLICT ("endpoint") DO UPDATE
      SET "userId" = EXCLUDED."userId", "p256dh" = EXCLUDED."p256dh",
          "auth" = EXCLUDED."auth", "userAgent" = EXCLUDED."userAgent"`;
}

export async function removeSubscription(endpoint: string) {
  await ensureTable();
  await db.$executeRaw`DELETE FROM "PushSubscription" WHERE "endpoint" = ${endpoint}`;
}

export async function countSubscriptions(userId: string): Promise<number> {
  await ensureTable();
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "PushSubscription" WHERE "userId" = ${userId}`;
  return Number(rows[0]?.n || 0);
}

/** Removes "[taskId: …]" markers the app stores inside notification text. */
function cleanText(s?: string | null): string {
  return (s || "")
    .replace(/\[taskId:\s*[a-f0-9-]+\]/gi, "")
    .replace(/\(taskId:\s*[a-f0-9-]+\)/gi, "")
    .replace(/taskId:\s*[a-f0-9-]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface PushPayload {
  title: string;
  body?: string | null;
  taskId?: string | null;
  url?: string;
  tag?: string;
}

/** Sends a push to every device of one user. Never throws. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!userId || !pushEnabled()) return;
  try {
    await ensureTable();
    const subs = await db.$queryRaw<{ endpoint: string; p256dh: string; auth: string }[]>`
      SELECT "endpoint", "p256dh", "auth" FROM "PushSubscription" WHERE "userId" = ${userId}`;
    if (!subs.length) return;

    let unread: number | undefined;
    try {
      unread = await db.notification.count({ where: { sentToId: userId, isRead: false } });
    } catch {
      unread = undefined;
    }

    // taskId is sometimes only embedded in the text as "[taskId: …]"
    const taskId =
      payload.taskId ||
      (payload.body || "").match(/taskId:\s*([a-f0-9-]{36})/i)?.[1] ||
      null;

    const body = JSON.stringify({
      title: cleanText(payload.title) || "MVC Tasks",
      body: cleanText(payload.body).slice(0, 240),
      url: payload.url || (taskId ? `/dashboard/tasks/${taskId}` : "/"),
      tag: payload.tag,
      unread,
    });

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60 * 24, urgency: "high" }
          );
        } catch (err: unknown) {
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            // Device unsubscribed / app removed – forget it
            await db.$executeRaw`DELETE FROM "PushSubscription" WHERE "endpoint" = ${s.endpoint}`.catch(() => {});
          } else {
            console.error("[push] send failed", code, (err as Error)?.message);
          }
        }
      })
    );
  } catch (e) {
    console.error("[push] sendPushToUser error", e);
  }
}

/** Same as sendPushToUser but gives up after `ms` so it can never slow a request down much. */
export function sendPushWithTimeout(userId: string, payload: PushPayload, ms = 5000): Promise<void> {
  return Promise.race([
    sendPushToUser(userId, payload),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}
