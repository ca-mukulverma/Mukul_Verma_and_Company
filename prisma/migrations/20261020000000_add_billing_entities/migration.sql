-- CreateTable
CREATE TABLE "BillingEntity" (
    "type" "BillType" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(30),
    "email" VARCHAR(75),
    "pan" VARCHAR(10),
    "gstin" VARCHAR(15),
    "stateCode" VARCHAR(2),
    "sacCode" VARCHAR(10),
    "bankName" VARCHAR(100),
    "bankAccount" VARCHAR(30),
    "bankIfsc" VARCHAR(11),
    "bankBranch" VARCHAR(100),
    "signatory" VARCHAR(100),
    "footerNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEntity_pkey" PRIMARY KEY ("type")
);


-- The three billing entities; addresses, GSTIN, bank details etc. are filled in later by Admin
INSERT INTO "BillingEntity" ("type", "name", "updatedAt") VALUES
    ('GST', 'MVC & Company', CURRENT_TIMESTAMP),
    ('NON_GST', 'CA Mukul Verma', CURRENT_TIMESTAMP),
    ('BEDGE', 'B Edge', CURRENT_TIMESTAMP);
