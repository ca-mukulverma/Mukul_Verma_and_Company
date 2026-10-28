-- AlterEnum
ALTER TYPE "ComplianceDocKind" ADD VALUE 'GSTR2B_JSON';

-- AlterTable
ALTER TABLE "ComplianceDocument" ADD COLUMN     "gst" JSONB,
ADD COLUMN     "gstMonth" DATE;

-- CreateTable
CREATE TABLE "GstWorkingCheck" (
    "id" CHAR(36) NOT NULL,
    "clientId" CHAR(36) NOT NULL,
    "periodStart" DATE NOT NULL,
    "checkedById" CHAR(36),
    "remark" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GstWorkingCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceSetting" (
    "key" VARCHAR(40) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "GstWorkingCheck_clientId_periodStart_key" ON "GstWorkingCheck"("clientId", "periodStart");

-- CreateIndex
CREATE INDEX "ComplianceDocument_clientId_gstMonth_idx" ON "ComplianceDocument"("clientId", "gstMonth");

-- AddForeignKey
ALTER TABLE "GstWorkingCheck" ADD CONSTRAINT "GstWorkingCheck_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstWorkingCheck" ADD CONSTRAINT "GstWorkingCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

