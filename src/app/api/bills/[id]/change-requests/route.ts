import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { describeBill, getBillingAccess, managesCompany, notifyBillingUsers } from "@/lib/billing";

const changesSchema = z
  .object({
    amount: z.number().positive().max(1e10).optional(),
    description: z.string().trim().min(3).max(2000).optional(),
    workDate: z.string().datetime().optional(),
    clientId: z.string().min(1).optional(),
    type: z.enum(["GST", "NON_GST"]).optional(),
  })
  .strict();

const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cancel"), reason: z.string().trim().min(3, "Give a reason").max(1000) }),
  z.object({
    kind: z.literal("edit"),
    reason: z.string().trim().min(3, "Give a reason").max(1000),
    changes: changesSchema.omit({ clientId: true, type: true }),
  }),
  z.object({
    kind: z.literal("reissue"),
    reason: z.string().trim().min(3, "Give a reason").max(1000),
    changes: changesSchema,
  }),
]);

const KIND_LABELS = { edit: "edit", cancel: "cancellation", reissue: "reissue" } as const;

// POST /api/bills/:id/change-requests – billing manager asks Admin to edit,
// cancel or reissue an approved bill
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bill = await prisma.bill.findUnique({
    where: { id: (await params).id },
    include: { client: { select: { contactPerson: true, companyName: true } } },
  });
  if (!bill || !managesCompany(access, bill.company)) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }
  if (bill.status !== "approved") {
    return NextResponse.json({ error: "Only approved bills can be edited, cancelled or reissued" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  }
  const input = parsed.data;
  const changes = input.kind === "cancel" ? null : input.changes;

  if (input.kind === "edit" && Object.keys(input.changes).length === 0) {
    return NextResponse.json({ error: "Change at least one value" }, { status: 400 });
  }
  if (input.kind === "reissue" && input.changes.type && bill.company !== "MVC") {
    return NextResponse.json({ error: "B Edge bills are always B Edge" }, { status: 400 });
  }
  const newClientId = input.kind === "reissue" ? input.changes.clientId : undefined;
  if (newClientId) {
    const client = await prisma.client.findUnique({ where: { id: newClientId }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 400 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const pending = await tx.billChangeRequest.count({ where: { billId: bill.id, status: "pending" } });
    if (pending > 0) return null;
    const changeRequest = await tx.billChangeRequest.create({
      data: {
        billId: bill.id,
        kind: input.kind,
        reason: input.reason,
        changes: changes ? (changes as Prisma.InputJsonValue) : Prisma.JsonNull,
        requestedById: user.id,
      },
    });
    await tx.billEvent.create({
      data: { billId: bill.id, action: `${input.kind}_requested`, userId: user.id, remark: input.reason },
    });
    return changeRequest;
  });
  if (!created) {
    return NextResponse.json({ error: "A request for this bill is already waiting for Admin" }, { status: 409 });
  }

  after(async () => {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, id: { not: user.id } },
      select: { id: true },
    });
    await notifyBillingUsers(admins.map((a) => a.id), {
      title: `Bill ${KIND_LABELS[input.kind]} requested`,
      content: `${user.name} asked for the ${KIND_LABELS[input.kind]} of bill no. ${bill.billNumber} (${describeBill(bill)}): "${input.reason}"`,
      sentById: user.id,
    });
  });

  return NextResponse.json(created, { status: 201 });
}
