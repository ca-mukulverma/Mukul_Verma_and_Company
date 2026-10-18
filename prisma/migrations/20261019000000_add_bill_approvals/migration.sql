-- CreateEnum
CREATE TYPE "BillChangeKind" AS ENUM ('edit', 'cancel', 'reissue');

-- CreateEnum
CREATE TYPE "BillChangeStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "reissuedFromId" CHAR(36);

-- AlterTable
ALTER TABLE "BillEvent" ADD COLUMN     "details" JSONB;

-- CreateTable
CREATE TABLE "BillChangeRequest" (
    "id" CHAR(36) NOT NULL,
    "billId" CHAR(36) NOT NULL,
    "kind" "BillChangeKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB,
    "status" "BillChangeStatus" NOT NULL DEFAULT 'pending',
    "requestedById" CHAR(36) NOT NULL,
    "decidedById" CHAR(36),
    "decidedAt" TIMESTAMP(3),
    "decisionRemark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillChangeRequest_status_createdAt_idx" ON "BillChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BillChangeRequest_billId_idx" ON "BillChangeRequest"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_reissuedFromId_key" ON "Bill"("reissuedFromId");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_reissuedFromId_fkey" FOREIGN KEY ("reissuedFromId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillChangeRequest" ADD CONSTRAINT "BillChangeRequest_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillChangeRequest" ADD CONSTRAINT "BillChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillChangeRequest" ADD CONSTRAINT "BillChangeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tasks already waiting under the old "pending billing" approval become draft bills
INSERT INTO "Bill" ("id", "company", "type", "status", "description", "workDate", "taskId", "clientId", "createdById", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    t."company",
    CASE WHEN t."company" = 'BEDGE' THEN 'BEDGE'::"BillType" ELSE NULL END,
    'draft',
    t."title" || COALESCE(E'\n' || NULLIF(t."description", ''), ''),
    COALESCE(t."lastStatusUpdatedAt", t."updatedAt"),
    t."id",
    t."clientId",
    COALESCE(t."lastStatusUpdatedById", t."assignedById"),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Task" t
WHERE t."status" = 'completed'
  AND t."billingStatus" = 'pending_billing'
  AND NOT EXISTS (SELECT 1 FROM "Bill" b WHERE b."taskId" = t."id");

INSERT INTO "BillEvent" ("id", "billId", "action", "remark", "userId", "createdAt")
SELECT gen_random_uuid()::text, b."id", 'created', 'Carried over from the old billing approval', b."createdById", CURRENT_TIMESTAMP
FROM "Bill" b
WHERE NOT EXISTS (SELECT 1 FROM "BillEvent" e WHERE e."billId" = b."id");
