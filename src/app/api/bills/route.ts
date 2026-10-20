import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { BillStatus, BillType, Company, Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { billInclude, billToData, getBillingAccess, otherPartySchema, serializeBill } from "@/lib/billing";

const PAGE_SIZE = 50;

const workEntrySchema = z.object({
  company: z.enum(["MVC", "BEDGE"]),
  // A saved client, or "Other" with the name typed in
  clientId: z.string().min(1).optional().nullable(),
  other: otherPartySchema.optional().nullable(),
  description: z.string().trim().min(3, "Describe the work done").max(2000),
  workDate: z.string().datetime(),
  remark: z.string().trim().max(1000).optional().nullable(),
});

// GET /api/bills?view=manage|list|amounts|mine&company=MVC|BEDGE&status=...&search=...&page=1
//   manage  – bills of the companies the user manages
//   list    – the Billing List: numbered bills of those companies (both for a
//             partner Admin has allowed to see it), filtered by &type=<BillType>
//             &from=YYYY-MM-DD&to=YYYY-MM-DD (bill date)&emailed=yes|no
//   amounts – bills sent to the user to enter the amount
//   mine    – work the user logged or completed
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "mine";
  const company = searchParams.get("company");
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim();
  const page = Math.max(parseInt(searchParams.get("page") || "1") || 1, 1);

  const where: Prisma.BillWhereInput = {};

  if (view === "manage" || view === "list") {
    // Partners allowed to see the Billing List see it for both companies
    const allowed = view === "list" ? access.listCompanies : access.manages;
    const companies = company ? [company as Company] : allowed;
    if (companies.length === 0 || companies.some((c) => !allowed.includes(c))) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    where.company = { in: companies };

    if (view === "list") {
      const type = searchParams.get("type");
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      if (type && type !== "all") {
        if (!(type in BillType)) return NextResponse.json({ error: "Invalid type" }, { status: 400 });
        where.type = type as BillType;
      }
      if (from || to) {
        where.billDate = {
          // Dates are Indian calendar days
          ...(from && { gte: new Date(`${from}T00:00:00+05:30`) }),
          ...(to && { lte: new Date(`${to}T23:59:59.999+05:30`) }),
        };
      }
      if (!status || status === "all") where.status = { in: ["approved", "cancelled"] };
      const emailed = searchParams.get("emailed");
      if (emailed === "yes") where.emailedAt = { not: null };
      if (emailed === "no") where.emailedAt = null;
    }
  } else if (view === "amounts") {
    if (!access.canEnterAmounts) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    where.amountRequestedFromId = user.id;
    if (!status) where.status = "awaiting_amount";
  } else {
    where.createdById = user.id;
  }

  if (status && status !== "all") {
    if (view === "list" && status !== "approved" && status !== "cancelled") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (!(status in BillStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    where.status = status as BillStatus;
  }

  if (search) {
    where.OR = [
      { description: { contains: search, mode: "insensitive" } },
      { client: { contactPerson: { contains: search, mode: "insensitive" } } },
      { client: { companyName: { contains: search, mode: "insensitive" } } },
      { billToName: { contains: search, mode: "insensitive" } },
    ];
  }

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

  return NextResponse.json(serializeBill(bill, access), { status: 201 });
}
