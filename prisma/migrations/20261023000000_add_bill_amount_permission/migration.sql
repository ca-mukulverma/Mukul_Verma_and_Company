-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canEnterBillAmounts" BOOLEAN NOT NULL DEFAULT false;

-- No partner may enter amounts until Admin allows it, so bills already sent to
-- a partner go back to the billing managers as drafts
INSERT INTO "BillEvent" ("id", "billId", "action", "remark", "userId")
SELECT gen_random_uuid()::text, b."id", 'sent_back', 'Sent back: partners now need Admin''s permission to enter amounts', b."amountRequestedFromId"
FROM "Bill" b JOIN "User" u ON u."id" = b."amountRequestedFromId"
WHERE b."status" = 'awaiting_amount' AND u."role" = 'PARTNER';

UPDATE "Bill" b SET "status" = 'draft', "amountRequestedFromId" = NULL
FROM "User" u
WHERE u."id" = b."amountRequestedFromId" AND b."status" = 'awaiting_amount' AND u."role" = 'PARTNER';
