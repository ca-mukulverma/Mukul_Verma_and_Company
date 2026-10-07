-- CreateIndex
CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");

-- DropIndex
DROP INDEX "Notification_sentToId_idx";

-- CreateIndex
CREATE INDEX "Notification_sentToId_createdAt_idx" ON "Notification"("sentToId", "createdAt" DESC);
