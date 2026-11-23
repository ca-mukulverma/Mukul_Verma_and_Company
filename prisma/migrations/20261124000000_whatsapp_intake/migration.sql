-- WhatsApp intake (docs/WHATSAPP_INTAKE.md): the firm's dedicated number in the
-- client groups. New tables only; files are kept in R2, not in the database.

-- CreateTable
CREATE TABLE "WaGroup" (
    "id" CHAR(36) NOT NULL,
    "jid" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "clientId" CHAR(36),
    "deskClientId" CHAR(36),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" CHAR(36) NOT NULL,
    "waId" VARCHAR(80) NOT NULL,
    "groupId" CHAR(36) NOT NULL,
    "clientId" CHAR(36),
    "senderPhone" VARCHAR(20) NOT NULL,
    "senderName" VARCHAR(80),
    "staffUserId" CHAR(36),
    "text" TEXT,
    "fileName" VARCHAR(200),
    "fileKey" VARCHAR(300),
    "fileSize" INTEGER,
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "taskId" CHAR(36),
    "answeredAt" TIMESTAMP(3),
    "answeredById" CHAR(36),
    "deskStatus" VARCHAR(20),
    "alertedAt" TIMESTAMP(3),
    "doneById" CHAR(36),
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaGroup_jid_key" ON "WaGroup"("jid");

-- CreateIndex
CREATE INDEX "WaGroup_clientId_idx" ON "WaGroup"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_waId_key" ON "WaMessage"("waId");

-- CreateIndex
CREATE INDEX "WaMessage_groupId_sentAt_idx" ON "WaMessage"("groupId", "sentAt");

-- CreateIndex
CREATE INDEX "WaMessage_status_sentAt_idx" ON "WaMessage"("status", "sentAt");

-- CreateIndex
CREATE INDEX "WaMessage_clientId_idx" ON "WaMessage"("clientId");

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WaGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
