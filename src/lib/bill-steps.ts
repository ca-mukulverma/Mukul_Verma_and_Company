import { BillStatus, BillType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BillingAccess, amountSetterWhere, hasBillTo, managesCompany, notifyBillingUsers } from "@/lib/billing";
import { BILL_TYPE_LABELS, EDITABLE_BILL_STATUSES } from "@/lib/billing-constants";
import { BatchResult, countLabel } from "@/lib/bill-approvals";

type Actor = { id: string; name: string };

// The billing manager sets GST / Non-GST on several MVC bills at once
export async function setBillTypes(ids: string[], type: BillType, actor: Actor, access: BillingAccess): Promise<BatchResult> {
  const result: BatchResult = { done: [], skipped: [] };
  const bills = await prisma.bill.findMany({ where: { id: { in: ids } }, select: { id: true, company: true } });

  const ready: string[] = [];
  for (const id of ids) {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !managesCompany(access, bill.company)) result.skipped.push({ id, reason: "Not found" });
    else if (bill.company !== "MVC") result.skipped.push({ id, reason: "B Edge bills are always B Edge" });
    else ready.push(id);
  }
  if (ready.length === 0) return result;

  const changed = await prisma.$transaction(async (tx) => {
    const rows = await tx.bill.updateManyAndReturn({
      where: { id: { in: ready }, status: { in: EDITABLE_BILL_STATUSES as BillStatus[] } },
      data: { type },
      select: { id: true },
    });
    await tx.billEvent.createMany({
      data: rows.map((row) => ({ billId: row.id, action: "type_set", userId: actor.id, remark: BILL_TYPE_LABELS[type] })),
    });
    return new Set(rows.map((row) => row.id));
  });
  for (const id of ready) {
    if (changed.has(id)) result.done.push(id);
    else result.skipped.push({ id, reason: "Already approved" });
  }
  return result;
}

// The billing manager sends several bills to one partner or Admin for the
// amount; they get one notification for all of them
export async function requestAmounts(ids: string[], targetId: string, actor: Actor, access: BillingAccess) {
  const result: BatchResult = { done: [], skipped: [] };
  const target = await prisma.user.findFirst({ where: { id: targetId, ...amountSetterWhere }, select: { id: true, name: true } });
  if (!target) {
    return { error: "Amounts can only be sent to an Admin or a Partner allowed to enter amounts" } as const;
  }

  const bills = await prisma.bill.findMany({
    where: { id: { in: ids } },
    select: { id: true, company: true, type: true, clientId: true, billToName: true },
  });
  const ready: string[] = [];
  for (const id of ids) {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !managesCompany(access, bill.company)) result.skipped.push({ id, reason: "Not found" });
    else if (!bill.type) result.skipped.push({ id, reason: "Choose GST or Non-GST first" });
    else if (!hasBillTo(bill)) result.skipped.push({ id, reason: "Select the client first" });
    else ready.push(id);
  }

  if (ready.length > 0) {
    const sent = await prisma.$transaction(async (tx) => {
      const rows = await tx.bill.updateManyAndReturn({
        where: { id: { in: ready }, status: { in: ["draft", "awaiting_amount"] } },
        data: { status: "awaiting_amount", amountRequestedFromId: target.id },
        select: { id: true },
      });
      await tx.billEvent.createMany({
        data: rows.map((row) => ({ billId: row.id, action: "amount_requested", userId: actor.id, remark: `Sent to ${target.name}` })),
      });
      return new Set(rows.map((row) => row.id));
    });
    for (const id of ready) {
      if (sent.has(id)) result.done.push(id);
      else result.skipped.push({ id, reason: "No longer waiting for the amount" });
    }
  }

  if (result.done.length > 0 && target.id !== actor.id) {
    await notifyBillingUsers(
      [target.id],
      {
        title: "Bills awaiting your amount",
        content: `${actor.name} asked you to enter the amount for ${countLabel(result.done.length)}.`,
        sentById: actor.id,
      },
      "/dashboard/billing?tab=amounts"
    );
  }
  return result;
}
