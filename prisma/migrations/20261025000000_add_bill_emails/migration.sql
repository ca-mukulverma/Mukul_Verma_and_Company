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

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "emailedAt" TIMESTAMP(3),
ADD COLUMN     "emailedTo" VARCHAR(400);

-- CreateTable
CREATE TABLE "BillingEmailSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "allowReplies" BOOLEAN NOT NULL DEFAULT false,
    "replyTo" VARCHAR(75),
    "copyTo" VARCHAR(75),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEmailSetting_pkey" PRIMARY KEY ("id")
);

-- Replies are off until Admin turns them on
INSERT INTO "BillingEmailSetting" ("id", "allowReplies", "updatedAt") VALUES (1, false, CURRENT_TIMESTAMP);
