import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { BillStatus, Company, Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { billInclude, getBillingAccess, serializeBill } from "@/lib/billing";

const PAGE_SIZE = 50;

const workEntrySchema = z.object({
  company: z.enum(["MVC", "BEDGE"]),
  clientId: z.string().min(1, "Select a client"),
  description: z.string().trim().min(3, "Describe the work done").max(2000),
  workDate: z.string().datetime(),
  remark: z.string().trim().max(1000).optional().nullable(),
});

// GET /api/bills?view=manage|amounts|mine&company=MVC|BEDGE&status=...&search=...&page=1
//   manage  – bills of the companies the user manages
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

  if (view === "manage") {
    const companies = company ? [company as Company] : access.manages;
    if (companies.length === 0 || companies.some((c) => !access.manages.includes(c))) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    where.company = { in: companies };
  } else if (view === "amounts") {
    where.amountRequestedFromId = user.id;
    if (!status) where.status = "awaiting_amount";
  } else {
    where.createdById = user.id;
  }

  if (status && status !== "all") {
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
    ];
  }

  const [bills, total] = await Promise.all([
    prisma.bill.findMany({
      where,
      include: billInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.bill.count({ where }),
  ]);

  return NextResponse.json({
    bills: bills.map((bill) => serializeBill(bill, access)),
    total,
    page,
    pages: Math.ceil(total / PAGE_SIZE),
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

  const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 400 });

  const bill = await prisma.bill.create({
    data: {
      company: data.company,
      type: data.company === "BEDGE" ? "BEDGE" : null,
      description: data.description,
      workDate: new Date(data.workDate),
      remark: data.remark || null,
      clientId: data.clientId,
      createdById: user.id,
      events: { create: { action: "created", userId: user.id, remark: "Work logged directly" } },
    },
    include: billInclude,
  });

  return NextResponse.json(serializeBill(bill, access), { status: 201 });
}
