-- Corrections of logged work by Admin / partners who see everyone's work:
-- what changed, why, and on whose request

CREATE TYPE "WorkCorrectionRequester" AS ENUM ('staff', 'client', 'self');

CREATE TABLE "WorkCorrection" (
    "id" CHAR(36) NOT NULL,
    "billId" CHAR(36) NOT NULL,
    "changes" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "requester" "WorkCorrectionRequester" NOT NULL,
    "requestedById" CHAR(36),
    "correctedById" CHAR(36) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkCorrection_billId_createdAt_idx" ON "WorkCorrection"("billId", "createdAt");

ALTER TABLE "WorkCorrection" ADD CONSTRAINT "WorkCorrection_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkCorrection" ADD CONSTRAINT "WorkCorrection_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkCorrection" ADD CONSTRAINT "WorkCorrection_correctedById_fkey"
  FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
