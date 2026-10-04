-- Phone/browser push notification devices. Additive only: no existing table is changed.
CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" CHAR(36) NOT NULL,
    "userId" CHAR(36) NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(100) NOT NULL,
    "userAgent" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");
