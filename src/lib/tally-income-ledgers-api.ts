import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { BillingAccess, getBillingAccess } from "@/lib/billing";
import { cleanLedgerName, MAX_INCOME_LEDGER_LENGTH } from "@/lib/tally-income-ledgers";

// Shared by the /api/billing/tally/income-ledgers routes

// Billing managers and Admin
export async function incomeLedgerAccess(): Promise<BillingAccess | null> {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return null;
  const access = await getBillingAccess(user.id);
  return access && (access.isAdmin || access.manages.length > 0) ? access : null;
}

export function forbidden() {
  return NextResponse.json({ error: "Only the billing manager or Admin can change Tally income ledgers" }, { status: 403 });
}

export const ledgerInput = z.object({
  name: z.string().transform(cleanLedgerName).pipe(z.string().min(1, "Enter the ledger name").max(MAX_INCOME_LEDGER_LENGTH)),
  groupName: z
    .string()
    .transform(cleanLedgerName)
    .pipe(z.string().max(MAX_INCOME_LEDGER_LENGTH))
    .optional()
    .nullable(),
});

export function duplicateName(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
