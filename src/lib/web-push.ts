import webpush from "web-push";
import { prisma } from "@/lib/prisma";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let vapidConfigured: boolean | null = null;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

  if (!publicKey || !privateKey) {
    console.warn("Push notifications disabled: VAPID keys are not configured");
    vapidConfigured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

// Remove internal markers like "[taskId: ...]" that are only meant for the web UI
function cleanBody(text: string): string {
  return text
    .replace(/\[(taskId|clientId):\s*[a-f0-9-]+\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Send a push notification to every device the user has enabled push on.
// Never throws: push is best-effort and must not break the request that triggered it.
export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!ensureVapidConfigured()) return;

  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) return;

    const message = JSON.stringify({
      title: payload.title,
      body: cleanBody(payload.body).slice(0, 240),
      url: payload.url || "/dashboard",
      tag: payload.tag,
    });

    const expired: string[] = [];

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            message,
            { TTL: 60 * 60 * 24 }
          );
        } catch (error: unknown) {
          const statusCode = (error as { statusCode?: number })?.statusCode;
          // 404/410: the device unsubscribed or the app was removed
          if (statusCode === 404 || statusCode === 410) {
            expired.push(sub.id);
          } else {
            console.error("Failed to send push notification:", error);
          }
        }
      })
    );

    if (expired.length > 0) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: expired } } });
    }
  } catch (error) {
    console.error("Failed to send push notifications:", error);
  }
}

// Convenience helper for places that already have a Notification row
export async function sendPushForNotification(notification: {
  title: string;
  content: string | null;
  sentToId: string;
  taskId?: string | null;
}) {
  const content = notification.content || "";
  const taskId =
    notification.taskId || content.match(/\[taskId:\s*([a-f0-9-]+)\]/i)?.[1];

  await sendPushToUser(notification.sentToId, {
    title: notification.title,
    body: content,
    url: taskId ? `/dashboard/tasks/${taskId}` : "/dashboard",
  });
}
