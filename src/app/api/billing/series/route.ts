import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSeriesOverview } from "@/lib/billing";
import { BILL_TYPES, BillTypeValue, financialYearOf } from "@/lib/billing-constants";

const updateSchema = z.object({
  type: z.enum(BILL_TYPES as [BillTypeValue, ...BillTypeValue[]]),
  nextNumber: z.number().int().min(1).max(99999999),
});

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" ? user : null;
}

// GET /api/billing/series – next number of each bill series (Admin)
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only Admin can manage bill series" }, { status: 403 });
  }
  return NextResponse.json({ series: await getSeriesOverview() });
}

// PUT /api/billing/series – set the next number of a series (Admin), e.g. on go-live day
export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only Admin can manage bill series" }, { status: 403 });
  }

  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a whole number of 1 or more" }, { status: 400 });
  }
  const { type, nextNumber } = parsed.data;
  const financialYear = financialYearOf();

  // Don't let the series go back over numbers already issued this year
  const highest = await prisma.bill.aggregate({
    where: { type, financialYear },
    _max: { sequence: true },
  });
  if (highest._max.sequence !== null && nextNumber <= highest._max.sequence) {
    return NextResponse.json(
      { error: `Bill number ${highest._max.sequence} has already been issued in this series` },
      { status: 400 }
    );
  }

  await prisma.billSeries.upsert({
    where: { type },
    update: { financialYear, nextNumber },
    create: { type, financialYear, nextNumber },
  });

  return NextResponse.json({ series: await getSeriesOverview() });
}
