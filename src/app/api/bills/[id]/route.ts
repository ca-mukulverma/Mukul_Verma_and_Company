import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { BillStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  BillingAccess,
  amountSetterWhere,
  billInclude,
  billToData,
  canViewBill,
  describeBill,
  hasBillTo,
  otherPartySchema,
  getBillingAccess,
  getBillingManagerIds,
  isAmountSetterFor,
  managesCompany,
  notifyBillingUsers,
  seesInBillingList,
  serializeBill,
} from "@/lib/billing";
import {
  ADMIN_AMOUNT_EDIT_STATUSES,
  BILL_TYPE_LABELS,
  EDITABLE_BILL_STATUSES,
  MVC_BILL_TYPES,
  formatRupees,
} from "@/lib/billing-constants";
import { finalApprove, finalReject, managerApprove } from "@/lib/bill-approvals";

type Params = { params: Promise<{ id: string }> };

const detailsSchema = z.object({
  clientId: z.string().min(1).optional(),
  other: otherPartySchema.optional(),
  description: z.string().trim().min(3).max(2000).optional(),
  workDate: z.string().datetime().optional(),
  remark: z.string().trim().max(1000).optional().nullable(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_type"), type: z.enum(MVC_BILL_TYPES) }),
  z.object({ action: z.literal("request_amount"), userId: z.string().min(1) }),
  // A billing manager may choose who an MVC bill is issued by in the same step
  z.object({ action: z.literal("enter_amount"), amount: z.number().positive().max(1e10), type: z.enum(MVC_BILL_TYPES).optional() }),
  z.object({ action: z.literal("send_back"), remark: z.string().trim().min(3, "Add a remark").max(1000) }),
  z.object({ action: z.literal("not_billable"), remark: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("manager_approve") }),
  z.object({ action: z.literal("final_approve") }),
  z.object({ action: z.literal("final_reject"), remark: z.string().trim().min(3, "Add a remark").max(1000) }),
  // Admin corrects the amount after it was entered, including on approved bills
  z.object({ action: z.literal("edit_amount"), amount: z.number().positive().max(1e10), remark: z.string().trim().max(1000).optional() }),
]);

async function loadContext(id: string) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const access = await getBillingAccess(user.id);
  if (!access) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const bill = await prisma.bill.findUnique({ where: { id }, include: billInclude });
  if (!bill || !canViewBill(bill, access)) {
    return { error: NextResponse.json({ error: "Bill not found" }, { status: 404 }) };
  }
  return { user, access, bill };
}

// Moves the bill on only if it is still in one of the expected statuses, so two
// people acting on the same bill at once can't both succeed.
async function updateIfStatus(
  id: string,
  statuses: BillStatus[],
  data: Prisma.BillUncheckedUpdateManyInput,
  event: { action: string; userId: string; remark?: string | null }
) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.bill.updateMany({ where: { id, status: { in: statuses } }, data });
    if (count === 0) return false;
    await tx.billEvent.create({ data: { billId: id, ...event } });
    return true;
  });
}

const conflict = () =>
  NextResponse.json({ error: "This bill was changed by someone else. Refresh and try again." }, { status: 409 });
const forbidden = () => NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

async function respondWithBill(id: string, access: BillingAccess) {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id }, include: billInclude });
  return NextResponse.json(serializeBill(bill, access));
}

// GET /api/bills/:id – the bill and its history
export async function GET(_request: NextRequest, { params }: Params) {
  const ctx = await loadContext((await params).id);
  if ("error" in ctx) return ctx.error;
  const { access, bill } = ctx;

  // The history contains remarks about amounts, so only people who deal with
  // the amount see it
  const canSeeHistory =
    managesCompany(access, bill.company) || seesInBillingList(bill, access) || isAmountSetterFor(bill, access);
  const events = canSeeHistory
    ? await prisma.billEvent.findMany({
        where: { billId: bill.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, action: true, remark: true, createdAt: true, user: { select: { id: true, name: true } } },
      })
    : [];

  return NextResponse.json({ ...serializeBill(bill, access), events });
}

// PATCH /api/bills/:id – billing manager corrects client, description, date or remark
export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await loadContext((await params).id);
  if ("error" in ctx) return ctx.error;
  const { user, access, bill } = ctx;

  if (!managesCompany(access, bill.company)) return forbidden();

  const parsed = detailsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  }
  const { clientId, other, description, workDate, remark } = parsed.data;

  if (clientId && !other) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 400 });
  }

  const updated = await updateIfStatus(
    bill.id,
    EDITABLE_BILL_STATUSES as BillStatus[],
    {
      ...((clientId !== undefined || other !== undefined) && billToData({ clientId, other })),
      ...(description !== undefined && { description }),
      ...(workDate !== undefined && { workDate: new Date(workDate) }),
      ...(remark !== undefined && { remark: remark || null }),
    },
    { action: "details_updated", userId: user.id }
  );
  if (!updated) return conflict();

  return respondWithBill(bill.id, access);
}

// POST /api/bills/:id – a step in the bill workflow (see docs/BILLING.md)
export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await loadContext((await params).id);
  if ("error" in ctx) return ctx.error;
  const { user, access, bill } = ctx;

  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  }
  const input = parsed.data;
  const isManager = managesCompany(access, bill.company);
  const isRequestedUser = access.canEnterAmounts && bill.amountRequestedFromId === user.id;
  const billLabel = describeBill(bill);

  switch (input.action) {
    case "set_type": {
      if (!isManager) return forbidden();
      if (bill.company !== "MVC") {
        return NextResponse.json({ error: "B Edge bills are always B Edge (non-GST)" }, { status: 400 });
      }
      const ok = await updateIfStatus(
        bill.id,
        EDITABLE_BILL_STATUSES as BillStatus[],
        { type: input.type },
        { action: "type_set", userId: user.id, remark: BILL_TYPE_LABELS[input.type] }
      );
      if (!ok) return conflict();
      break;
    }

    case "request_amount": {
      if (!isManager) return forbidden();
      if (!bill.type) return NextResponse.json({ error: "Choose GST or Non-GST first" }, { status: 400 });
      if (!hasBillTo(bill)) return NextResponse.json({ error: "Select the client or enter the name to bill first" }, { status: 400 });

      const target = await prisma.user.findFirst({
        where: { id: input.userId, ...amountSetterWhere },
        select: { id: true, name: true },
      });
      if (!target) {
        return NextResponse.json(
          { error: "Amounts can only be sent to an Admin or a Partner allowed to enter amounts" },
          { status: 400 }
        );
      }

      const ok = await updateIfStatus(
        bill.id,
        ["draft", "awaiting_amount"],
        { status: "awaiting_amount", amountRequestedFromId: target.id },
        { action: "amount_requested", userId: user.id, remark: `Sent to ${target.name}` }
      );
      if (!ok) return conflict();

      if (target.id !== user.id) {
        after(() =>
          notifyBillingUsers([target.id], {
            title: "Bill awaiting your amount",
            content: `${user.name} asked you to enter the amount for: ${billLabel}`,
            sentById: user.id,
          })
        );
      }
      break;
    }

    case "enter_amount": {
      const allowedStatuses: BillStatus[] = isManager
        ? ["draft", "awaiting_amount", "amount_entered"]
        : isRequestedUser
          ? ["awaiting_amount"]
          : [];
      if (allowedStatuses.length === 0) return forbidden();
      const changesType = input.type !== undefined && input.type !== bill.type;
      if (changesType && (!isManager || bill.company !== "MVC")) return forbidden();
      const type = input.type ?? bill.type;
      if (!type) return NextResponse.json({ error: "Choose GST or Non-GST first" }, { status: 400 });
      if (!hasBillTo(bill)) return NextResponse.json({ error: "Select the client or enter the name to bill first" }, { status: 400 });

      const amount = Math.round(input.amount * 100) / 100;
      const ok = await updateIfStatus(
        bill.id,
        allowedStatuses,
        { status: "amount_entered", type, amount, amountEnteredById: user.id, amountEnteredAt: new Date() },
        {
          action: "amount_entered",
          userId: user.id,
          remark: changesType ? `${formatRupees(amount)} (${BILL_TYPE_LABELS[type]})` : formatRupees(amount),
        }
      );
      if (!ok) return conflict();

      // Admin, the billing managers and the partner the bill was sent to
      after(async () => {
        const managerIds = await getBillingManagerIds(bill.company);
        const recipients = managerIds.filter((id) => id !== user.id);
        if (bill.amountRequestedFromId) recipients.push(bill.amountRequestedFromId);
        await notifyBillingUsers(recipients, {
          title: "Bill amount entered",
          content: `${user.name} entered the amount for: ${billLabel}. It is waiting for billing manager approval.`,
          sentById: user.id,
        });
      });
      break;
    }

    case "send_back": {
      if (!isRequestedUser) return forbidden();
      const ok = await updateIfStatus(
        bill.id,
        ["awaiting_amount"],
        { status: "draft", amountRequestedFromId: null },
        { action: "sent_back", userId: user.id, remark: input.remark }
      );
      if (!ok) return conflict();

      // Admin and the billing managers
      after(async () => {
        const managerIds = await getBillingManagerIds(bill.company);
        await notifyBillingUsers(managerIds.filter((id) => id !== user.id), {
          title: "Bill sent back",
          content: `${user.name} sent back ${billLabel}: "${input.remark}"`,
          sentById: user.id,
        });
      });
      break;
    }

    case "not_billable": {
      if (!isManager) return forbidden();
      const ok = await updateIfStatus(
        bill.id,
        EDITABLE_BILL_STATUSES as BillStatus[],
        { status: "not_billable", amountRequestedFromId: null },
        { action: "not_billable", userId: user.id, remark: input.remark || null }
      );
      if (!ok) return conflict();
      break;
    }

    case "manager_approve": {
      if (!isManager) return forbidden();
      const result = await managerApprove([bill.id], user, access);
      if (result.done.length === 0) {
        return NextResponse.json({ error: result.skipped[0]?.reason || "Could not approve" }, { status: 409 });
      }
      break;
    }

    case "final_approve": {
      if (!access.isAdmin) return forbidden();
      const result = await finalApprove([bill.id], user);
      if (result.done.length === 0) {
        return NextResponse.json({ error: result.skipped[0]?.reason || "Could not approve" }, { status: 409 });
      }
      break;
    }

    case "final_reject": {
      if (!access.isAdmin) return forbidden();
      if (!(await finalReject(bill.id, input.remark, user))) return conflict();
      break;
    }

    case "edit_amount": {
      if (!access.isAdmin) return forbidden();
      if (bill.amount === null) return NextResponse.json({ error: "No amount has been entered yet" }, { status: 400 });
      const amount = Math.round(input.amount * 100) / 100;
      const before = Number(bill.amount);
      if (amount === before) return NextResponse.json({ error: "The amount is unchanged" }, { status: 400 });

      // Already in Tally: the next export alters the voucher
      const tallyUpdateDue = bill.status === "approved" && bill.tallyExportedAt !== null;
      const ok = await prisma.$transaction(async (tx) => {
        const { count } = await tx.bill.updateMany({
          where: {
            id: bill.id,
            status: { in: ADMIN_AMOUNT_EDIT_STATUSES as BillStatus[] },
            // Unchanged since it was read, so a concurrent edit isn't overwritten
            amount: bill.amount,
          },
          // Who entered the amount first is kept, so they still see the bill;
          // the history records the change
          data: { amount, ...(tallyUpdateDue && { tallyNeedsUpdate: true }) },
        });
        if (count === 0) return false;
        await tx.billEvent.create({
          data: {
            billId: bill.id,
            action: "amount_edited",
            userId: user.id,
            remark: [
              `${formatRupees(before)} → ${formatRupees(amount)}`,
              input.remark,
              tallyUpdateDue ? "Already in Tally: Tally update due" : null,
            ]
              .filter(Boolean)
              .join("\n"),
            details: { before: { amount: before }, after: { amount } },
          },
        });
        return true;
      });
      if (!ok) return conflict();

      // The billing managers, and whoever had entered the amount before
      after(async () => {
        const managerIds = await getBillingManagerIds(bill.company);
        const recipients = managerIds.filter((id) => id !== user.id);
        if (bill.amountEnteredById && bill.amountEnteredById !== user.id) recipients.push(bill.amountEnteredById);
        const number = bill.billNumber ? `bill ${bill.billNumber}` : "the bill";
        await notifyBillingUsers(recipients, {
          title: tallyUpdateDue ? "Bill amount changed: update Tally" : "Bill amount changed",
          content:
            `${user.name} changed the amount of ${number} (${billLabel}) from ${formatRupees(before)} to ${formatRupees(amount)}.` +
            (tallyUpdateDue ? " It was already exported to Tally: export it again from the Tally tab to update the voucher." : ""),
          sentById: user.id,
        });
      });
      break;
    }

    case "reopen": {
      if (!isManager) return forbidden();
      const ok = await updateIfStatus(
        bill.id,
        ["not_billable"],
        { status: bill.amount !== null ? "amount_entered" : "draft" },
        { action: "reopened", userId: user.id }
      );
      if (!ok) return conflict();
      break;
    }
  }

  return respondWithBill(bill.id, access);
}
