import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listIncomeLedgers } from "@/lib/tally-income-ledgers";
import { duplicateName, forbidden, incomeLedgerAccess, ledgerInput } from "@/lib/tally-income-ledgers-api";

// GET /api/billing/tally/income-ledgers – the income ledgers (services) and
// the billable compliance work types with their default ledger
export async function GET() {
  const access = await incomeLedgerAccess();
  if (!access) return forbidden();
  const [ledgers, workTypes] = await Promise.all([
    listIncomeLedgers(),
    prisma.complianceWorkType.findMany({
      where: { billable: true, active: true },
      select: { id: true, name: true, company: true, incomeLedgerId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  return NextResponse.json(
    {
      ledgers,
      workTypes: workTypes.map((w) => ({ ...w, canEdit: access.isAdmin || access.manages.includes(w.company) })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// POST /api/billing/tally/income-ledgers – add one ledger (it must exist in Tally)
export async function POST(request: NextRequest) {
  const access = await incomeLedgerAccess();
  if (!access) return forbidden();
  const parsed = ledgerInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid ledger" }, { status: 400 });
  try {
    const ledger = await prisma.tallyIncomeLedger.create({
      data: { name: parsed.data.name, groupName: parsed.data.groupName || null },
    });
    return NextResponse.json(ledger);
  } catch (error) {
    if (duplicateName(error)) return NextResponse.json({ error: "This ledger is already in the list" }, { status: 409 });
    throw error;
  }
}
