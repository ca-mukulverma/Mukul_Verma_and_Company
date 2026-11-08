-- Work Done list: who completed each task, and which partners see everyone's work

ALTER TABLE "User" ADD COLUMN "canViewWorkDone" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Task" ADD COLUMN "completedById" CHAR(36);
ALTER TABLE "Task" ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "Task" ADD CONSTRAINT "Task_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tasks already completed: the last person who changed the status (else the
-- person who created the task), at that time (else the last update)
UPDATE "Task"
SET "completedById" = COALESCE("lastStatusUpdatedById", "assignedById"),
    "completedAt" = COALESCE("lastStatusUpdatedAt", "updatedAt")
WHERE "status" = 'completed';

-- Kept by the database, so every way of completing a task records it (the
-- status page, the task form, a task created as completed, imports):
-- completed -> the person who changed the status, now; reopened -> cleared
CREATE OR REPLACE FUNCTION task_completed_by() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'completed' THEN
    IF TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'completed' THEN
      NEW."completedById" := COALESCE(NEW."lastStatusUpdatedById", NEW."assignedById");
      NEW."completedAt" := CURRENT_TIMESTAMP;
    END IF;
  ELSE
    NEW."completedById" := NULL;
    NEW."completedAt" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Task_completed_by"
BEFORE INSERT OR UPDATE OF "status" ON "Task"
FOR EACH ROW EXECUTE FUNCTION task_completed_by();

-- The list filters each kind of work by its date
CREATE INDEX "Task_completedAt_idx" ON "Task"("completedAt");
CREATE INDEX "Bill_workDate_idx" ON "Bill"("workDate");
CREATE INDEX "ComplianceItem_filedAt_idx" ON "ComplianceItem"("filedAt");
CREATE INDEX "ComplianceItem_completedAt_idx" ON "ComplianceItem"("completedAt");
