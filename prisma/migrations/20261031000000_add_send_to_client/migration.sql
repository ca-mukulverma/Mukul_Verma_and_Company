-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "cin" VARCHAR(21),
ADD COLUMN     "iec" VARCHAR(10),
ADD COLUMN     "pan" VARCHAR(10),
ADD COLUMN     "tan" VARCHAR(10),
ADD COLUMN     "udyamNumber" VARCHAR(19);

-- AlterTable
ALTER TABLE "ComplianceDocument" ADD COLUMN     "docType" VARCHAR(40),
ADD COLUMN     "financialYear" INTEGER;

-- CreateTable
CREATE TABLE "ClientRequestType" (
    "id" CHAR(36) NOT NULL,
    "key" VARCHAR(40),
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300),
    "category" VARCHAR(30) NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRequestType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDispatch" (
    "id" CHAR(36) NOT NULL,
    "clientId" CHAR(36) NOT NULL,
    "requestName" VARCHAR(100) NOT NULL,
    "company" "Company" NOT NULL,
    "sentTo" VARCHAR(400) NOT NULL,
    "thirdParty" BOOLEAN NOT NULL DEFAULT false,
    "files" JSONB NOT NULL,
    "includedLogins" BOOLEAN NOT NULL DEFAULT false,
    "sentById" CHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceDocument_clientId_docType_idx" ON "ComplianceDocument"("clientId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRequestType_key_key" ON "ClientRequestType"("key");

-- CreateIndex
CREATE INDEX "ClientRequestType_active_sortOrder_idx" ON "ClientRequestType"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "ClientDispatch_clientId_createdAt_idx" ON "ClientDispatch"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientDispatch_createdAt_idx" ON "ClientDispatch"("createdAt");

-- AddForeignKey
ALTER TABLE "ClientDispatch" ADD CONSTRAINT "ClientDispatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDispatch" ADD CONSTRAINT "ClientDispatch_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
