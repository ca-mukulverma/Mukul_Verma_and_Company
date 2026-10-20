-- Profiles and number series of the two new Non-GST issuers. Admin fills in
-- the details and, if bills were already made by hand, the next number.
INSERT INTO "BillingEntity" ("type", "name", "updatedAt") VALUES
    ('NON_GST_HV', 'CA Harsh Verma', CURRENT_TIMESTAMP),
    ('NON_GST_VLA', 'Verma Law Associates', CURRENT_TIMESTAMP)
ON CONFLICT ("type") DO NOTHING;

INSERT INTO "BillSeries" ("type", "financialYear", "nextNumber", "updatedAt") VALUES
    ('NON_GST_HV', '2026-27', 1, CURRENT_TIMESTAMP),
    ('NON_GST_VLA', '2026-27', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("type") DO NOTHING;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canViewBillingList" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "BillEmailStatus" AS ENUM ('sent', 'delayed', 'failed');

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "emailedAt" TIMESTAMP(3),
ADD COLUMN     "emailedTo" VARCHAR(400),
ADD COLUMN     "emailStatus" "BillEmailStatus",
ADD COLUMN     "emailError" TEXT,
ADD COLUMN     "emailStatusAt" TIMESTAMP(3),
ADD COLUMN     "emailMessageId" VARCHAR(200);

-- CreateIndex
CREATE INDEX "Bill_emailMessageId_idx" ON "Bill"("emailMessageId");

-- CreateTable
CREATE TABLE "BillingEmailSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "allowReplies" BOOLEAN NOT NULL DEFAULT false,
    "replyTo" VARCHAR(75),
    "copyTo" VARCHAR(75),
    "bounceCheckedAt" TIMESTAMP(3),
    "bounceCheckpoint" VARCHAR(60),
    "bounceCheckError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEmailSetting_pkey" PRIMARY KEY ("id")
);

-- Replies are off until Admin turns them on
INSERT INTO "BillingEmailSetting" ("id", "allowReplies", "updatedAt") VALUES (1, false, CURRENT_TIMESTAMP);
