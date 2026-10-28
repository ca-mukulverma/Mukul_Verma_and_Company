-- A party's GST registrations in other states, each its own client record
ALTER TABLE "Client" ADD COLUMN "parentClientId" CHAR(36);

CREATE INDEX "Client_parentClientId_idx" ON "Client"("parentClientId");

ALTER TABLE "Client" ADD CONSTRAINT "Client_parentClientId_fkey" FOREIGN KEY ("parentClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
