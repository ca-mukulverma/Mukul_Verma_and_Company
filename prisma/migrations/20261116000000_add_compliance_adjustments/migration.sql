-- Adjustments made in a return, written by staff when filing (or later) and
-- shown on the client's page (docs/COMPLIANCE.md). Kept apart from
-- ComplianceNote, which Claude's nightly review login may write to.

-- CreateTable
CREATE TABLE "ComplianceAdjustment" (
    "id" CHAR(36) NOT NULL,
    "itemId" CHAR(36) NOT NULL,
    "body" TEXT NOT NULL,
    "followUp" BOOLEAN NOT NULL DEFAULT false,
    "createdById" CHAR(36),
    "updatedById" CHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceAdjustment_itemId_createdAt_idx" ON "ComplianceAdjustment"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "ComplianceAdjustment" ADD CONSTRAINT "ComplianceAdjustment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ComplianceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAdjustment" ADD CONSTRAINT "ComplianceAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAdjustment" ADD CONSTRAINT "ComplianceAdjustment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
