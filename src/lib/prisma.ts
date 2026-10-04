import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

/** Plain client (unchanged from before). */
export const basePrisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Adding connection pool configuration
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma;

/**
 * Runs `fn` after the HTTP response has been sent (Next.js `after`), so push sending
 * can never slow down or break the request / database transaction that created the notification.
 */
async function runAfterResponse(fn: () => Promise<void>) {
  try {
    const { after } = await import("next/server");
    after(fn);
  } catch {
    // Outside a request (scripts, cron helpers): just run it in the background
    fn().catch(() => {});
  }
}

/**
 * Same client as before, plus one addition: whenever a Notification row is created,
 * a phone push notification is also sent to the receiver (if they enabled it).
 * The notification itself is saved exactly as before, even if push fails.
 */
export const prisma = basePrisma.$extends({
  query: {
    notification: {
      async create({ args, query }) {
        const result = await query(args);
        try {
          const r = result as { sentToId?: string; title?: string; content?: string | null; taskId?: string | null; id?: string };
          const data = (args?.data ?? {}) as { sentToId?: string; title?: string; content?: string | null; taskId?: string | null };
          const userId = r?.sentToId || data.sentToId;
          if (userId) {
            const payload = {
              title: r?.title || data.title || "MVC Tasks",
              body: r?.content ?? data.content ?? "",
              taskId: r?.taskId ?? data.taskId ?? null,
              tag: r?.id,
            };
            await runAfterResponse(async () => {
              const { sendPushWithTimeout } = await import("./push");
              await sendPushWithTimeout(userId, payload, 8000);
            });
          }
        } catch (e) {
          console.error("[push] hook error", e);
        }
        return result;
      },
    },
  },
  // Keep the exact same TypeScript type as before so no other file needs to change
}) as unknown as typeof basePrisma;
