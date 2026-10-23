-- "Created" is no longer stored as bill history: the history shows it from the
-- bill's own creator and date. Entries that say the same are removed.
DELETE FROM "BillEvent" e
USING "Bill" b
WHERE e."billId" = b."id"
  AND e."action" = 'created'
  AND e."userId" = b."createdById";

-- No query looks bills up by their email's message id (bounces are matched
-- through the "emailed" history entries), so the index is not needed
DROP INDEX "Bill_emailMessageId_idx";
