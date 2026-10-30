import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess, managesCompany } from "@/lib/billing";
import { SIMILAR_WORK, workSimilarity, workWords } from "@/lib/bill-similarity";

const MAX_HINTS = 4;

// GET /api/bills/:id/fee-hints – the party's earlier fees, most similar work
// first, to help whoever enters this bill's amount: the billing managers and
// the person the bill was sent to for the amount
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bill = await prisma.bill.findUnique({
    where: { id: (await params).id },
    select: { id: true, company: true, clientId: true, billToName: true, description: true, amountRequestedFromId: true },
  });
  const allowed =
    bill &&
    (managesCompany(access, bill.company) || (access.canEnterAmounts && bill.amountRequestedFromId === user.id));
  if (!bill || !allowed) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

  const party: Prisma.BillWhereInput | null = bill.clientId
    ? { clientId: bill.clientId }
    : bill.billToName
      ? { clientId: null, billToName: { equals: bill.billToName, mode: "insensitive" } }
      : null;
  if (!party) return NextResponse.json({ hints: [] });

  const earlier = await prisma.bill.findMany({
    where: {
      ...party,
      id: { not: bill.id },
      company: bill.company,
      amount: { not: null },
      status: { in: ["amount_entered", "manager_approved", "approved"] },
    },
    orderBy: { amountEnteredAt: "desc" },
    take: 30,
    select: { id: true, description: true, amount: true, type: true, billDate: true, amountEnteredAt: true, createdAt: true },
  });

  const words = workWords(bill.description);
  const hints = earlier
    .map((b, index) => ({ b, index, score: workSimilarity(words, workWords(b.description)) }))
    // Similar work first, then the most recent
    .sort((x, y) => Number(y.score >= SIMILAR_WORK) - Number(x.score >= SIMILAR_WORK) || x.index - y.index)
    .slice(0, MAX_HINTS)
    .map(({ b, score }) => ({
      id: b.id,
      work: b.description.split("\n")[0].slice(0, 120),
      amount: Number(b.amount),
      type: b.type,
      date: b.billDate ?? b.amountEnteredAt ?? b.createdAt,
      similar: score >= SIMILAR_WORK,
    }));

  return NextResponse.json({ hints });
}
