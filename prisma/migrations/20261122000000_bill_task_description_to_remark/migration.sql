-- Bills made from a task used to print the task's description under the work
-- (e.g. internal notes about the period). For bills not yet numbered, keep only
-- the task title as the work and move the description into the remark, which is
-- shown to whoever enters the amount and is not printed on the bill.
UPDATE "Bill" AS b
SET "description" = t."title",
    "remark" = CASE
      WHEN b."remark" IS NULL OR btrim(b."remark") = '' THEN btrim(t."description")
      ELSE b."remark" || E'\n' || btrim(t."description")
    END
FROM "Task" AS t
WHERE b."taskId" = t."id"
  AND b."billNumber" IS NULL
  AND t."description" IS NOT NULL
  AND btrim(t."description") <> ''
  AND b."description" = t."title" || E'\n' || t."description";
