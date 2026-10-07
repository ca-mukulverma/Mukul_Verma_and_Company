-- CreateIndex
CREATE INDEX IF NOT EXISTS "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_createdAt_idx" ON "Task"("createdAt");

-- DropIndex
DROP INDEX IF EXISTS "Notification_sentToId_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_sentToId_createdAt_idx" ON "Notification"("sentToId", "createdAt" DESC);
