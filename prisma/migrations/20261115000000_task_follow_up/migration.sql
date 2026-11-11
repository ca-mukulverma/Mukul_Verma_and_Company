-- Task follow-up (docs/TASKS.md): deletion requests instead of "Cancelled",
-- comments that ask for a reply, Claude's daily summary on Today, partners
-- who follow up tasks from the cards, and who last changed a client login.

-- CreateEnum
CREATE TYPE "TaskDeletionStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canFollowUpTasks" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Credential" ADD COLUMN     "updatedById" CHAR(36);

-- CreateTable
CREATE TABLE "TaskDeletionRequest" (
    "id" CHAR(36) NOT NULL,
    "taskId" CHAR(36),
    "taskTitle" VARCHAR(150) NOT NULL,
    "clientName" VARCHAR(150),
    "reason" TEXT,
    "status" "TaskDeletionStatus" NOT NULL DEFAULT 'pending',
    "requestedById" CHAR(36) NOT NULL,
    "decidedById" CHAR(36),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "TaskDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskReplyRequest" (
    "id" CHAR(36) NOT NULL,
    "taskId" CHAR(36) NOT NULL,
    "commentId" CHAR(36) NOT NULL,
    "userId" CHAR(36) NOT NULL,
    "requestedById" CHAR(36) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TaskReplyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDigest" (
    "id" CHAR(36) NOT NULL,
    "userId" CHAR(36) NOT NULL,
    "body" TEXT NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'claude',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskDeletionRequest_status_createdAt_idx" ON "TaskDeletionRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TaskDeletionRequest_taskId_idx" ON "TaskDeletionRequest"("taskId");

-- CreateIndex
CREATE INDEX "TaskReplyRequest_userId_resolvedAt_idx" ON "TaskReplyRequest"("userId", "resolvedAt");

-- CreateIndex
CREATE INDEX "TaskReplyRequest_taskId_resolvedAt_idx" ON "TaskReplyRequest"("taskId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskReplyRequest_commentId_userId_key" ON "TaskReplyRequest"("commentId", "userId");

-- CreateIndex
CREATE INDEX "TaskDigest_userId_createdAt_idx" ON "TaskDigest"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskDeletionRequest" ADD CONSTRAINT "TaskDeletionRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDeletionRequest" ADD CONSTRAINT "TaskDeletionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDeletionRequest" ADD CONSTRAINT "TaskDeletionRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReplyRequest" ADD CONSTRAINT "TaskReplyRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReplyRequest" ADD CONSTRAINT "TaskReplyRequest_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TaskComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReplyRequest" ADD CONSTRAINT "TaskReplyRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReplyRequest" ADD CONSTRAINT "TaskReplyRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDigest" ADD CONSTRAINT "TaskDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One open deletion request per task
CREATE UNIQUE INDEX "TaskDeletionRequest_one_pending_per_task"
  ON "TaskDeletionRequest"("taskId") WHERE "status" = 'pending';

-- "Cancelled" is no longer offered. Tasks already cancelled go to Admin as
-- deletion requests, asked by whoever cancelled them (else the creator).
INSERT INTO "TaskDeletionRequest" ("id", "taskId", "taskTitle", "clientName", "reason", "requestedById", "createdAt")
SELECT gen_random_uuid()::text,
       t."id",
       LEFT(t."title", 150),
       LEFT(COALESCE(c."companyName", c."contactPerson"), 150),
       'Was marked Cancelled before deletion requests replaced it',
       COALESCE(t."lastStatusUpdatedById", t."assignedById"),
       CURRENT_TIMESTAMP
FROM "Task" t
LEFT JOIN "Client" c ON c."id" = t."clientId"
WHERE t."status" = 'cancelled';
