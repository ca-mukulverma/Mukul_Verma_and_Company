import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  billInclude,
  billToData,
  defaultBillType,
  describeBill,
  getBillingAccess,
  getBillingManagerIds,
  notifyBillingUsers,
  otherPartySchema,
  serializeBill,
} from "@/lib/billing";
import { COMPANY_LABELS, WAITING_BILL_STATUSES } from "@/lib/billing-constants";
import { billListWhere } from "@/lib/bill-list-query";
import { MAX_WORK_ROWS } from "@/lib/billing-constants";

const PAGE_SIZE = 50;

// One piece of work: the party, what was done and when
const workItemSchema = z.object({
  // Each piece of work may be for a different company (the batch's otherwise)
  company: z.enum(["MVC", "BEDGE"]).optional(),
  // A saved client, or "Other" with the name typed in
  clientId: z.string().min(1).optional().nullable(),
  other: otherPartySchema.optional().nullable(),
  description: z.string().trim().min(3, "Describe the work done").max(2000),
  workDate: z.string().datetime(),
});

const entryFields = {
  company: z.enum(["MVC", "BEDGE"]).optional(),
  remark: z.string().trim().max(1000).optional().nullable(),
  // Partners chosen on the form to be told about the work
  notifyPartnerIds: z.array(z.string().min(1)).max(50).optional(),
};
// One entry, or several (items) logged together with the same remark and
// partners; the company is given for the batch or for each item
const workEntrySchema = workItemSchema.extend(entryFields);
const workBatchSchema = z.object({ ...entryFields, items: z.array(workItemSchema).min(1, "Add the work done").max(MAX_WORK_ROWS) });

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
  // Work queues (bills waiting at one stage) show the longest-waiting first,
  // so nothing sinks to the bottom and goes overdue; other lists newest first
  const status = searchParams.get("status");
  const isQueue = (view === "manage" || view === "amounts") && (status === "returned" || WAITING_BILL_STATUSES.includes(status as never));

  const [bills, total, sums] = await Promise.all([
    prisma.bill.findMany({
      where,
      include: billInclude,
      orderBy:
        view === "list"
          ? [{ billDate: "desc" }, { sequence: "desc" }]
          : isQueue
            ? [{ statusChangedAt: "asc" }, { createdAt: "asc" }]
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

  const body = await request.json();
  const parsed =
    body && typeof body === "object" && "items" in body ? workBatchSchema.safeParse(body) : workEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  }
  const data = parsed.data;
  const items = ("items" in data ? data.items : [data]).map((item) => ({ ...item, company: item.company ?? data.company }));
  if (items.some((item) => !item.company)) {
    return NextResponse.json({ error: "Choose the company" }, { status: 400 });
  }

  if (items.some((item) => !item.clientId && !item.other)) {
    return NextResponse.json({ error: "Select a client or enter the name to bill" }, { status: 400 });
  }
  const clientIds = [...new Set(items.flatMap((item) => (item.clientId && !item.other ? [item.clientId] : [])))];
  if (clientIds.length > 0) {
    const found = await prisma.client.count({ where: { id: { in: clientIds } } });
    if (found !== clientIds.length) return NextResponse.json({ error: "Client not found" }, { status: 400 });
  }

  const types = await Promise.all(items.map((item) => defaultBillType(item.company!, item.other ? null : item.clientId)));
  const bills = await prisma.$transaction(
    items.map((item, i) =>
      prisma.bill.create({
        data: {
          company: item.company!,
          type: types[i],
          description: item.description,
          workDate: new Date(item.workDate),
          remark: data.remark || null,
          ...billToData(item),
          createdById: user.id,
        },
        include: billInclude,
      })
    )
  );

  // Admins, each company's billing managers and the partners chosen on the
  // form: one notification per company for everything logged together
  after(async () => {
    const partners = data.notifyPartnerIds?.length
      ? await prisma.user.findMany({
          where: { id: { in: data.notifyPartnerIds }, role: "PARTNER", isActive: true },
          select: { id: true },
        })
      : [];
    const companies = [...new Set(bills.map((b) => b.company))];
    for (const company of companies) {
      const logged = bills.filter((b) => b.company === company);
      const managerIds = await getBillingManagerIds(company);
      await notifyBillingUsers([...new Set([...managerIds, ...partners.map((p) => p.id)])].filter((id) => id !== user.id), {
        title: "Work logged for billing",
        content:
          logged.length === 1
            ? `${user.name} logged ${COMPANY_LABELS[company]} work: ${describeBill(logged[0])}`
            : `${user.name} logged ${logged.length} items of ${COMPANY_LABELS[company]} work: ${logged.map((b) => describeBill(b)).join("; ")}`.slice(0, 1000),
        sentById: user.id,
      });
    }
  });

  return NextResponse.json("items" in data ? { bills: bills.map((b) => serializeBill(b, access)) } : serializeBill(bills[0], access), {
    status: 201,
  });
}
