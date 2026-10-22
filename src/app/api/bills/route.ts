import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  billInclude,
  billToData,
  describeBill,
  getBillingAccess,
  getBillingManagerIds,
  notifyBillingUsers,
  otherPartySchema,
  serializeBill,
} from "@/lib/billing";
import { COMPANY_LABELS } from "@/lib/billing-constants";
import { billListWhere } from "@/lib/bill-list-query";

const PAGE_SIZE = 50;

const workEntrySchema = z.object({
  company: z.enum(["MVC", "BEDGE"]),
  // A saved client, or "Other" with the name typed in
  clientId: z.string().min(1).optional().nullable(),
  other: otherPartySchema.optional().nullable(),
  description: z.string().trim().min(3, "Describe the work done").max(2000),
  workDate: z.string().datetime(),
  remark: z.string().trim().max(1000).optional().nullable(),
  // Partners chosen on the form to be told about the work
  notifyPartnerIds: z.array(z.string().min(1)).max(50).optional(),
});

// GET /api/bills – a page of bills; the filters are described in lib/bill-list-query.ts
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "mine";
  const page = Math.max(parseInt(searchParams.get("page") || "1") || 1, 1);

  const filter = billListWhere(searchParams, access);
  if ("error" in filter) return NextResponse.json({ error: filter.error }, { status: filter.status });
  const { where } = filter;

  const [bills, total, sums] = await Promise.all([
    prisma.bill.findMany({
      where,
      include: billInclude,
      orderBy:
        view === "list"
          ? [{ billDate: "desc" }, { sequence: "desc" }]
          : { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.bill.count({ where }),
    // Fee totals of the approved bills in the Billing List, per type (for GST)
    view === "list"
      ? prisma.bill.groupBy({
          by: ["type"],
          where: { AND: [where, { status: "approved" }] },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    bills: bills.map((bill) => serializeBill(bill, access)),
    total,
    page,
    pages: Math.ceil(total / PAGE_SIZE),
    ...(sums && {
      totals: sums.map((row) => ({ type: row.type, amount: Number(row._sum.amount ?? 0) })),
    }),
  });
}

// POST /api/bills – log work done directly (not through a task). Anyone can do this.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = workEntrySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  }
  const data = parsed.data;

  if (!data.clientId && !data.other) {
    return NextResponse.json({ error: "Select a client or enter the name to bill" }, { status: 400 });
  }
  if (data.clientId && !data.other) {
    const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 400 });
  }

  const bill = await prisma.bill.create({
    data: {
      company: data.company,
      type: data.company === "BEDGE" ? "BEDGE" : null,
      description: data.description,
      workDate: new Date(data.workDate),
      remark: data.remark || null,
      ...billToData(data),
      createdById: user.id,
      events: { create: { action: "created", userId: user.id, remark: "Work logged directly" } },
    },
    include: billInclude,
  });

  // Admins, the company's billing managers and the partners chosen on the form
  after(async () => {
    const [managerIds, partners] = await Promise.all([
      getBillingManagerIds(bill.company),
      data.notifyPartnerIds?.length
        ? prisma.user.findMany({
            where: { id: { in: data.notifyPartnerIds }, role: "PARTNER", isActive: true },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);
    await notifyBillingUsers([...managerIds, ...partners.map((p) => p.id)].filter((id) => id !== user.id), {
      title: "Work logged for billing",
      content: `${user.name} logged ${COMPANY_LABELS[bill.company]} work: ${describeBill(bill)}`,
      sentById: user.id,
    });
  });

  return NextResponse.json(serializeBill(bill, access), { status: 201 });
}
