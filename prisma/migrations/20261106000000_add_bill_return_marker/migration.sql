-- The last send-back or Admin return of a bill, with its comment, kept on the
-- bill so it can be shown on it (docs/BILLING.md)
CREATE TYPE "BillReturnKind" AS ENUM ('sent_back', 'final_rejected');

ALTER TABLE "Bill"
    ADD COLUMN "returnKind" "BillReturnKind",
    ADD COLUMN "returnRemark" TEXT,
    ADD COLUMN "returnedAt" TIMESTAMP(3),
    ADD COLUMN "returnedById" CHAR(36),
    ADD COLUMN "returnCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Bill" ADD CONSTRAINT "Bill_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bills not yet numbered take their last send-back or return from the history
WITH returns AS (
    SELECT "billId", "action", "remark", "createdAt", "userId",
           ROW_NUMBER() OVER (PARTITION BY "billId" ORDER BY "createdAt" DESC) AS rn,
           COUNT(*) OVER (PARTITION BY "billId") AS total
    FROM "BillEvent"
    WHERE "action" IN ('sent_back', 'final_rejected')
)
UPDATE "Bill" AS b
SET "returnKind" = r."action"::"BillReturnKind",
    "returnRemark" = r."remark",
    "returnedAt" = r."createdAt",
    "returnedById" = r."userId",
    "returnCount" = r.total
FROM returns AS r
WHERE r."billId" = b."id" AND r.rn = 1
  AND b."status" IN ('draft', 'awaiting_amount', 'amount_entered', 'manager_approved', 'not_billable');
