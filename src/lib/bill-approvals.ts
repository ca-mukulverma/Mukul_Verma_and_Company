import { BillType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivities } from "@/lib/activity-logger";
import { BillingAccess, getBillingManagerIds, hasBillTo, managesCompany, notifyBillingUsers } from "@/lib/billing";
import { MvcBillTypeValue, financialYearOf, formatBillNumber } from "@/lib/billing-constants";
import { clientLedger, ledgerClientSelect, ledgersAtApproval } from "@/lib/connectors";

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name: string };

// Takes the next `count` numbers of a series inside the caller's transaction,
// so a failed approval gives them back. A new financial year starts at 1.
async function assignBillNumbers(tx: Tx, type: BillType, date: Date, count: number) {
  const financialYear = financialYearOf(date);
  const rows = await tx.$queryRaw<{ sequence: number }[]>`
    UPDATE "BillSeries"
    SET "nextNumber" = CASE WHEN "financialYear" = ${financialYear} THEN "nextNumber" ELSE 1 END + ${count}::int,
        "financialYear" = ${financialYear},
        "updatedAt" = NOW()
    WHERE "type" = ${type}::"BillType"
    RETURNING ("nextNumber" - ${count}::int) AS "sequence"`;

  let first = rows[0]?.sequence;
  if (first === undefined) {
    // Series row missing (should not happen after the migration): start at 1
    await tx.billSeries.create({ data: { type, financialYear, nextNumber: count + 1 } });
    first = 1;
  }
  return Array.from({ length: count }, (_, i) => ({
    financialYear,
    sequence: first + i,
    billNumber: formatBillNumber(type, financialYear, first + i),
  }));
}

// Takes the next number of a series inside the caller's transaction
export async function assignBillNumber(tx: Tx, type: BillType, date: Date) {
  const [number] = await assignBillNumbers(tx, type, date, 1);
  return number;
}

export interface BatchResult {
  done: string[];
  // Bills that could not be processed, with the reason
  skipped: { id: string; reason: string }[];
}

// Billing manager approval: amount entered → waiting for Admin's final approval.
// All bills are approved together: one update and one insert, however many.
export async function managerApprove(ids: string[], actor: Actor, access: BillingAccess): Promise<BatchResult> {
  const result: BatchResult = { done: [], skipped: [] };
  const bills = await prisma.bill.findMany({ where: { id: { in: ids } } });

  const ready: string[] = [];
  for (const id of ids) {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !managesCompany(access, bill.company)) {
      result.skipped.push({ id, reason: "Not found" });
    } else if (!bill.type || !hasBillTo(bill) || bill.amount === null) {
      result.skipped.push({ id, reason: "Type, client and amount are needed first" });
    } else {
      ready.push(id);
    }
  }

  if (ready.length > 0) {
    // Only bills still waiting are approved; the others moved on meanwhile
    const approved = await prisma.$transaction(async (tx) => {
      const rows = await tx.bill.updateManyAndReturn({
        where: { id: { in: ready }, status: "amount_entered" },
        data: { status: "manager_approved" },
        select: { id: true },
      });
      await tx.billEvent.createMany({
        data: rows.map((row) => ({ billId: row.id, action: "manager_approved", userId: actor.id })),
      });
      return new Set(rows.map((row) => row.id));
    });
    for (const id of ready) {
      if (approved.has(id)) result.done.push(id);
      else result.skipped.push({ id, reason: "Not waiting for billing manager approval" });
    }
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
// numbered in order of work date so the series follows the work. All bills
// are approved in one transaction with a fixed number of queries, however
// many there are; if it fails, none is approved and no number is used.
export async function finalApprove(ids: string[], actor: Actor): Promise<BatchResult> {
  const result: BatchResult = { done: [], skipped: [] };
  const bills = await prisma.bill.findMany({
    where: { id: { in: ids } },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, type: true, company: true, taskId: true },
  });
  for (const id of ids) {
    if (!bills.some((b) => b.id === id)) result.skipped.push({ id, reason: "Not found" });
  }
  // The billing manager always sets the type before approving
  const candidates = bills.filter((bill) => {
    if (!bill.type) result.skipped.push({ id: bill.id, reason: "Not waiting for final approval" });
    return !!bill.type;
  });
  if (candidates.length === 0) return result;
  // The ledger and connector each bill goes to, fixed now
  const ledgers = await ledgersAtApproval(candidates.map((b) => b.id));

  let approved: { bills: { id: string; company: string; billNumber: string }[]; closedTasks: ClosedTask[] };
  try {
    approved = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        // Only bills still waiting are approved; the others moved on meanwhile
        const claimed = await tx.bill.updateManyAndReturn({
          where: { id: { in: candidates.map((b) => b.id) }, status: "manager_approved" },
          data: { status: "approved", billDate: now },
          select: { id: true },
        });
        const claimedIds = new Set(claimed.map((row) => row.id));
        const toNumber = candidates.filter((bill) => claimedIds.has(bill.id));
        if (toNumber.length === 0) return { bills: [], closedTasks: [] };

        // One block of numbers per series, handed out in work-date order
        const numbered: { id: string; company: string; taskId: string | null; financialYear: string; sequence: number; billNumber: string }[] = [];
        for (const type of [...new Set(toNumber.map((bill) => bill.type as BillType))]) {
          const ofType = toNumber.filter((bill) => bill.type === type);
          const numbers = await assignBillNumbers(tx, type, now, ofType.length);
          ofType.forEach((bill, i) => numbered.push({ id: bill.id, company: bill.company, taskId: bill.taskId, ...numbers[i] }));
        }

        await tx.$executeRaw`
          UPDATE "Bill" AS b
          SET "financialYear" = v."financialYear", "sequence" = v."sequence", "billNumber" = v."billNumber",
              "tallyLedgerName" = v."tallyLedgerName", "connectorId" = v."connectorId"
          FROM (VALUES ${Prisma.join(
            numbered.map((n) => {
              const ledger = ledgers.get(n.id);
              return Prisma.sql`(${n.id}, ${n.financialYear}, ${n.sequence}::int, ${n.billNumber}, ${ledger?.tallyLedgerName ?? null}::varchar, ${ledger?.connectorId ?? null}::char(36))`;
            })
          )}) AS v("id", "financialYear", "sequence", "billNumber", "tallyLedgerName", "connectorId")
          WHERE b."id" = v."id"`;
        await tx.billEvent.createMany({
          data: numbered.map((n) => ({ billId: n.id, action: "approved", userId: actor.id, remark: `Bill no. ${n.billNumber}` })),
        });
        const taskIds = numbered.flatMap((n) => (n.taskId ? [n.taskId] : []));
        const closedTasks = await closeBilledTasks(tx, taskIds, actor, now);
        return { bills: numbered, closedTasks };
      },
      { timeout: 30000 }
    );
  } catch (error) {
    console.error("Failed to approve bills:", error);
    for (const bill of candidates) result.skipped.push({ id: bill.id, reason: "Could not be approved" });
    return result;
  }

  // In work-date order, as numbered
  const numbers = new Map(approved.bills.map((bill) => [bill.id, bill.billNumber]));
  const approvedByCompany = new Map<string, string[]>();
  for (const bill of candidates) {
    const billNumber = numbers.get(bill.id);
    if (!billNumber) {
      result.skipped.push({ id: bill.id, reason: "Not waiting for final approval" });
      continue;
    }
    result.done.push(bill.id);
    approvedByCompany.set(bill.company, [...(approvedByCompany.get(bill.company) || []), billNumber]);
  }
  if (approved.closedTasks.length > 0) {
    await logActivities(
      approved.closedTasks.map((task) => ({
        type: "task",
        action: "billing_approved",
        target: task.title,
        userId: actor.id,
        details: { taskId: task.id, clientId: task.clientId },
      }))
    );
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

type ClosedTask = { id: string; title: string; clientId: string | null };

// What the old task billing approval did: keep each task in the client's
// history, then remove the tasks. The bills keep the work description.
async function closeBilledTasks(tx: Tx, taskIds: string[], actor: Actor, now: Date): Promise<ClosedTask[]> {
  if (taskIds.length === 0) return [];
  const tasks = await tx.task.findMany({
    where: { id: { in: taskIds } },
    include: {
      assignedBy: { select: { id: true, name: true } },
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  });
  if (tasks.length === 0) return [];

  await tx.clientHistory.createMany({
    data: tasks.flatMap((task) =>
      task.clientId
        ? [
            {
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
          ]
        : []
    ),
  });

  await tx.task.deleteMany({ where: { id: { in: tasks.map((task) => task.id) } } });
  return tasks.map((task) => ({ id: task.id, title: task.title, clientId: task.clientId }));
}

export function countLabel(n: number) {
  return n === 1 ? "1 bill" : `${n} bills`;
}

// New values a billing manager can ask for. Edit keeps the bill number;
// a reissue may also change the client or, for MVC, who the bill is issued by.
export interface BillChanges {
  amount?: number;
  description?: string;
  workDate?: string;
  clientId?: string;
  type?: MvcBillTypeValue;
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
            // Already in Tally: the next export alters the voucher
            tallyNeedsUpdate: current.tallyExportedAt !== null,
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

      // cancel and reissue both cancel the current bill; its number stays used.
      // Already in Tally: the next export cancels the voucher.
      await tx.bill.update({
        where: { id: bill.id },
        data: { status: "cancelled", tallyNeedsUpdate: current.tallyExportedAt !== null },
      });

      if (request.kind === "cancel") {
        await tx.billEvent.create({ data: { billId: bill.id, action: "cancelled", userId: actor.id, remark: request.reason } });
        return;
      }

      const type: BillType = current.company === "BEDGE" ? "BEDGE" : (changes.type ?? current.type ?? "NON_GST");
      const now = new Date();
      const number = await assignBillNumber(tx, type, now);
      // A new client: its ledger and connector now; same client: as before
      const newClient = changes.clientId
        ? await tx.client.findUnique({ where: { id: changes.clientId }, select: ledgerClientSelect })
        : null;
      const ledger = newClient
        ? { tallyLedgerName: clientLedger(newClient), connectorId: newClient.connector?.id ?? null, showGstin: false }
        : { tallyLedgerName: current.tallyLedgerName, connectorId: current.connectorId, showGstin: current.showGstin };
      await tx.bill.create({
        data: {
          company: current.company,
          type,
          status: "approved",
          description: changes.description ?? current.description,
          workDate: changes.workDate ? new Date(changes.workDate) : current.workDate,
          remark: current.remark,
          // A new client replaces an "Other" name; otherwise the bill-to is kept
          ...(changes.clientId
            ? { clientId: changes.clientId }
            : {
                clientId: current.clientId,
                billToName: current.billToName,
                billToAddress: current.billToAddress,
                billToGstin: current.billToGstin,
              }),
          createdById: current.createdById,
          amount: changes.amount ?? current.amount,
          amountEnteredById: changes.amount !== undefined ? actor.id : current.amountEnteredById,
          amountEnteredAt: changes.amount !== undefined ? now : current.amountEnteredAt,
          financialYear: number.financialYear,
          sequence: number.sequence,
          billNumber: number.billNumber,
          billDate: now,
          reissuedFromId: current.id,
          ...ledger,
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
