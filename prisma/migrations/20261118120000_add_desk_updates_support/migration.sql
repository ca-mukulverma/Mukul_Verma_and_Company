-- MVC Control Centre: app updates (DeskRelease) and support files (DeskSupportFile)
-- for the desktop software at clients (docs/CONTROL_CENTRE.md). New tables only.

-- CreateTable
CREATE TABLE "DeskRelease" (
    "id" SERIAL NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "notes" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "sha256" CHAR(64) NOT NULL,
    "assetId" VARCHAR(30) NOT NULL,
    "assetName" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "clientCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "publishedBy" VARCHAR(50) NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeskRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeskSupportFile" (
    "id" CHAR(36) NOT NULL,
    "deskClientId" CHAR(36) NOT NULL,
    "fileName" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "note" TEXT,
    "storageKey" VARCHAR(200) NOT NULL,
    "appVersion" VARCHAR(20),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeskSupportFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeskRelease_version_idx" ON "DeskRelease"("version");

-- CreateIndex
CREATE INDEX "DeskSupportFile_receivedAt_idx" ON "DeskSupportFile"("receivedAt" DESC);

-- AddForeignKey
ALTER TABLE "DeskSupportFile" ADD CONSTRAINT "DeskSupportFile_deskClientId_fkey" FOREIGN KEY ("deskClientId") REFERENCES "DeskClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
