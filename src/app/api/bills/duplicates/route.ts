import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BILL_STATUS_LABELS } from "@/lib/billing-constants";
import { isLikelyRepeat, workWords } from "@/lib/bill-similarity";

// Work logged this long ago or less counts as a possible repeat
const LOOKBACK_DAYS = 60;

const schema = z.object({
  company: z.enum(["MVC", "BEDGE"]),
  items: z
    .array(
      z.object({
        clientId: z.string().min(1).optional().nullable(),
        otherName: z.string().trim().max(150).optional().nullable(),
        description: z.string().max(2000),
      })
    )
    .max(20),
});

// POST /api/bills/duplicates – for each piece of work about to be logged, the
// party's recent bills for the same work and period (a completed task, or someone else
// logging it), so it isn't billed twice. Only the work, date and stage are
// shown, never amounts: anyone can log work.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const { company, items } = parsed.data;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const matches = await Promise.all(
    items.map(async (item) => {
      const words = workWords(item.description);
      const party: Prisma.BillWhereInput | null = item.clientId
        ? { clientId: item.clientId }
        : item.otherName && item.otherName.length >= 2
          ? { clientId: null, billToName: { equals: item.otherName, mode: "insensitive" } }
          : null;
      if (!party || words.size === 0) return [];

      const recent = await prisma.bill.findMany({
        where: { ...party, company, createdAt: { gte: since }, status: { notIn: ["cancelled", "not_billable"] } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, description: true, workDate: true, status: true, createdBy: { select: { name: true } } },
      });
      return recent
        .filter((b) => isLikelyRepeat(item.description, b.description))
        .slice(0, 3)
        .map((b) => ({
          id: b.id,
          work: b.description.split("\n")[0].slice(0, 120),
          workDate: b.workDate,
          stage: BILL_STATUS_LABELS[b.status],
          loggedBy: b.createdBy.name,
        }));
    })
  );

  return NextResponse.json({ matches });
}
