import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Company, Prisma } from "@prisma/client";
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

// The firms whose ledgers this person sees and changes: Admin both, a billing
// manager their own (MVC billing manager: MVC; B Edge billing manager: B Edge)
export function ledgerFirms(access: BillingAccess): Company[] {
  return access.isAdmin ? ["MVC", "BEDGE"] : (["MVC", "BEDGE"] as Company[]).filter((c) => access.manages.includes(c));
}

export const firmSchema = z.enum(["MVC", "BEDGE"]);

export function forbidden() {
  return NextResponse.json({ error: "Only the billing manager or Admin can change Tally income ledgers" }, { status: 403 });
}

export const ledgerInput = z.object({
  entity: firmSchema.optional(),
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
