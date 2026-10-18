import { BillType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-logger";
import { BillingAccess, getBillingManagerIds, managesCompany, notifyBillingUsers } from "@/lib/billing";
import { financialYearOf, formatBillNumber } from "@/lib/billing-constants";

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name: string };

// Takes the next number of a series inside the caller's transaction, so a
// failed approval gives the number back. A new financial year starts at 1.
export async function assignBillNumber(tx: Tx, type: BillType, date: Date) {
  const financialYear = financialYearOf(date);
  const rows = await tx.$queryRaw<{ sequence: number }[]>`
    UPDATE "BillSeries"
    SET "nextNumber" = CASE WHEN "financialYear" = ${financialYear} THEN "nextNumber" + 1 ELSE 2 END,
        "financialYear" = ${financialYear},
        "updatedAt" = NOW()
    WHERE "type" = ${type}::"BillType"
    RETURNING ("nextNumber" - 1) AS "sequence"`;

  let sequence = rows[0]?.sequence;
  if (sequence === undefined) {
    // Series row missing (should not happen after the migration): start at 1
    await tx.billSeries.create({ data: { type, financialYear, nextNumber: 2 } });
    sequence = 1;
  }
  return { financialYear, sequence, billNumber: formatBillNumber(type, financialYear, sequence) };
}

export interface BatchResult {
  done: string[];
  // Bills that could not be processed, with the reason
  skipped: { id: string; reason: string }[];
}

// Billing manager approval: amount entered → waiting for Admin's final approval
export async function managerApprove(ids: string[], actor: Actor, access: BillingAccess): Promise<BatchResult> {
  const result: BatchResult = { done: [], skipped: [] };
  const bills = await prisma.bill.findMany({ where: { id: { in: ids } } });

  for (const id of ids) {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !managesCompany(access, bill.company)) {
      result.skipped.push({ id, reason: "Not found" });
      continue;
    }
    if (!bill.type || !bill.clientId || bill.amount === null) {
      result.skipped.push({ id, reason: "Type, client and amount are needed first" });
      continue;
    }
    const ok = await prisma.$transaction(async (tx) => {
      const { count } = await tx.bill.updateMany({
        where: { id, status: "amount_entered" },
        data: { status: "manager_approved" },
      });
      if (count === 0) return false;
      await tx.billEvent.create({ data: { billId: id, action: "manager_approved", userId: actor.id } });
      return true;
    });
    if (ok) result.done.push(id);
    else result.skipped.push({ id, reason: "Not waiting for billing manager approval" });
  }

  if (result.done.length > 0) {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, id: { not: actor.id } },
      select: { id: true },
    });
    await notifyBillingUsers(admins.map((a) => a.id), {
      title: "Bills awaiting final approval",
      content: `${actor.name} approved ${countLabel(result.done.length)}. ${result.done.length === 1 ? "It is" : "They are"} waiting for your final approval. Bills are dated on the day you approve them.`,
      sentById: actor.id,
    });
  }
  return result;
}

// Admin final approval: gives each bill its number and today's date. Bills are
// numbered in order of work date so the series follows the work.
export async function finalApprove(ids: string[], actor: Actor): Promise<BatchResult> {
  const result: BatchResult = { done: [], skipped: [] };
  const bills = await prisma.bill.findMany({
    where: { id: { in: ids } },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
  });
  for (const id of ids) {
    if (!bills.some((b) => b.id === id)) result.skipped.push({ id, reason: "Not found" });
  }

  const approvedByCompany = new Map<string, string[]>();
  for (const bill of bills) {
    try {
      const approved = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const { count } = await tx.bill.updateMany({
          where: { id: bill.id, status: "manager_approved" },
          data: { status: "approved", billDate: now },
        });
        if (count === 0 || !bill.type) return null;

        const number = await assignBillNumber(tx, bill.type, now);
        await tx.bill.update({
          where: { id: bill.id },
          data: { financialYear: number.financialYear, sequence: number.sequence, billNumber: number.billNumber },
        });
        await tx.billEvent.create({
          data: { billId: bill.id, action: "approved", userId: actor.id, remark: `Bill no. ${number.billNumber}` },
        });
        const closedTask = bill.taskId ? await closeBilledTask(tx, bill.taskId, actor, now) : null;
        return { billNumber: number.billNumber, closedTask };
      });

      if (approved) {
        const { billNumber, closedTask } = approved;
        if (closedTask) {
          await logActivity("task", "billing_approved", closedTask.title, actor.id, {
            taskId: closedTask.id,
            clientId: closedTask.clientId,
          });
        }
        result.done.push(bill.id);
        approvedByCompany.set(bill.company, [...(approvedByCompany.get(bill.company) || []), billNumber]);
      } else {
        result.skipped.push({ id: bill.id, reason: "Not waiting for final approval" });
      }
    } catch (error) {
      console.error(`Failed to approve bill ${bill.id}:`, error);
      result.skipped.push({ id: bill.id, reason: "Could not be approved" });
    }
  }

  for (const [company, numbers] of approvedByCompany) {
    const managerIds = await getBillingManagerIds(company as "MVC" | "BEDGE");
    await notifyBillingUsers(managerIds.filter((id) => id !== actor.id), {
      title: "Bills approved",
      content: `${actor.name} gave final approval to ${countLabel(numbers.length)}: ${numbers.join(", ")}`,
      sentById: actor.id,
    });
  }
  return result;
}

// Admin sends a bill back to the billing manager instead of approving it
export async function finalReject(id: string, remark: string, actor: Actor) {
  const bill = await prisma.bill.findUnique({ where: { id }, select: { company: true, description: true } });
  if (!bill) return false;

  const ok = await prisma.$transaction(async (tx) => {
    const { count } = await tx.bill.updateMany({
      where: { id, status: "manager_approved" },
      data: { status: "amount_entered" },
    });
    if (count === 0) return false;
    await tx.billEvent.create({ data: { billId: id, action: "final_rejected", userId: actor.id, remark } });
    return true;
  });

  if (ok) {
    const managerIds = await getBillingManagerIds(bill.company);
    await notifyBillingUsers(managerIds.filter((uid) => uid !== actor.id), {
      title: "Bill returned by Admin",
      content: `${actor.name} returned "${bill.description.split("\n")[0].slice(0, 80)}": "${remark}"`,
      sentById: actor.id,
    });
  }
  return ok;
}

// What the old task billing approval did: keep the task in the client's
// history, then remove the task. The bill keeps the work description.
async function closeBilledTask(tx: Tx, taskId: string, actor: Actor, now: Date) {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    include: {
      assignedBy: { select: { id: true, name: true } },
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  });
  if (!task) return null;

  if (task.clientId) {
    await tx.clientHistory.create({
      data: {
        clientId: task.clientId,
        content: `Task "${task.title}" was completed and billing approved.`,
        type: "task_completed",
        createdById: actor.id,
        taskId: task.id,
        taskTitle: task.title,
        taskDescription: task.description || "",
        taskStatus: "completed",
        taskCompletedDate: task.lastStatusUpdatedAt || now,
        taskBilledDate: now,
        billingDetails: {
          billedBy: actor.id,
          billedByName: actor.name,
          billedAt: now.toISOString(),
          priority: task.priority,
          dueDate: task.dueDate ? task.dueDate.toISOString() : null,
          assignedBy: { id: task.assignedBy.id, name: task.assignedBy.name },
          assignees: task.assignees.map((a) => ({ id: a.user.id, name: a.user.name })),
        },
      },
    });
  }

  await tx.task.delete({ where: { id: taskId } });
  return { id: task.id, title: task.title, clientId: task.clientId };
}

export function countLabel(n: number) {
  return n === 1 ? "1 bill" : `${n} bills`;
}

// New values a billing manager can ask for. Edit keeps the bill number;
// a reissue may also change the client or, for MVC, GST/Non-GST.
export interface BillChanges {
  amount?: number;
  description?: string;
  workDate?: string;
  clientId?: string;
  type?: "GST" | "NON_GST";
}

// Admin approves or rejects an edit/cancel/reissue request.
// Returns an error message, or null when it worked.
export async function decideChangeRequest(
  requestId: string,
  approve: boolean,
  remark: string | null,
  actor: Actor
): Promise<string | null> {
  const request = await prisma.billChangeRequest.findUnique({
    where: { id: requestId },
    include: { bill: true },
  });
  if (!request || request.status !== "pending") return "This request has already been decided";
  const bill = request.bill;
  const changes = (request.changes || {}) as BillChanges;

  let newBillNumber: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.billChangeRequest.updateMany({
        where: { id: requestId, status: "pending" },
        data: { status: approve ? "approved" : "rejected", decidedById: actor.id, decidedAt: new Date(), decisionRemark: remark },
      });
      if (count === 0) throw new DecisionError("This request has already been decided");

      if (!approve) {
        await tx.billEvent.create({
          data: { billId: bill.id, action: "change_rejected", userId: actor.id, remark: `${request.kind} rejected${remark ? `: ${remark}` : ""}` },
        });
        return;
      }

      const current = await tx.bill.findUniqueOrThrow({ where: { id: bill.id } });
      if (current.status !== "approved") throw new DecisionError("Only approved bills can be changed");

      if (request.kind === "edit") {
        const before = {
          amount: current.amount !== null ? Number(current.amount) : null,
          description: current.description,
          workDate: current.workDate.toISOString(),
        };
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            ...(changes.amount !== undefined && { amount: changes.amount }),
            ...(changes.description !== undefined && { description: changes.description }),
            ...(changes.workDate !== undefined && { workDate: new Date(changes.workDate) }),
          },
        });
        await tx.billEvent.create({
          data: {
            billId: bill.id,
            action: "edited",
            userId: actor.id,
            remark: request.reason,
            details: { before, after: { ...changes } } as Prisma.InputJsonValue,
          },
        });
        return;
      }

      // cancel and reissue both cancel the current bill; its number stays used
      await tx.bill.update({ where: { id: bill.id }, data: { status: "cancelled" } });

      if (request.kind === "cancel") {
        await tx.billEvent.create({ data: { billId: bill.id, action: "cancelled", userId: actor.id, remark: request.reason } });
        return;
      }

      const type: BillType = current.company === "BEDGE" ? "BEDGE" : (changes.type ?? current.type ?? "NON_GST");
      const now = new Date();
      const number = await assignBillNumber(tx, type, now);
      await tx.bill.create({
        data: {
          company: current.company,
          type,
          status: "approved",
          description: changes.description ?? current.description,
          workDate: changes.workDate ? new Date(changes.workDate) : current.workDate,
          remark: current.remark,
          clientId: changes.clientId ?? current.clientId,
          createdById: current.createdById,
          amount: changes.amount ?? current.amount,
          amountEnteredById: changes.amount !== undefined ? actor.id : current.amountEnteredById,
          amountEnteredAt: changes.amount !== undefined ? now : current.amountEnteredAt,
          financialYear: number.financialYear,
          sequence: number.sequence,
          billNumber: number.billNumber,
          billDate: now,
          reissuedFromId: current.id,
          events: {
            create: { action: "reissued", userId: actor.id, remark: `Replaces bill no. ${current.billNumber}: ${request.reason}` },
          },
        },
      });
      await tx.billEvent.create({
        data: { billId: bill.id, action: "cancelled", userId: actor.id, remark: `Reissued as bill no. ${number.billNumber}: ${request.reason}` },
      });
      newBillNumber = number.billNumber;
    });
  } catch (error) {
    if (error instanceof DecisionError) return error.message;
    throw error;
  }

  const label = request.kind === "edit" ? "Edit" : request.kind === "cancel" ? "Cancellation" : "Reissue";
  const managerIds = await getBillingManagerIds(bill.company);
  await notifyBillingUsers([...managerIds, request.requestedById].filter((id) => id !== actor.id), {
    title: approve ? `Bill ${request.kind} approved` : `Bill ${request.kind} rejected`,
    content: approve
      ? `${actor.name} approved the ${label.toLowerCase()} of bill no. ${bill.billNumber}${newBillNumber ? `. New bill no. ${newBillNumber}` : ""}.`
      : `${actor.name} rejected the ${label.toLowerCase()} of bill no. ${bill.billNumber}${remark ? `: "${remark}"` : ""}.`,
    sentById: actor.id,
  });
  return null;
}

class DecisionError extends Error {}
