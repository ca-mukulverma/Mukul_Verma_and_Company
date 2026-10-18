import { Bill, BillType, Company, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";
import { EDITABLE_BILL_STATUSES, formatBillNumber, financialYearOf } from "@/lib/billing-constants";

// What the signed-in user may do in billing. Read from the database on every
// request (not the session) so a permission removed by Admin applies at once.
export interface BillingAccess {
  userId: string;
  isAdmin: boolean;
  // Companies whose bills this user manages (sees amounts, sets type, approves)
  manages: Company[];
  // Partners and Admins can be asked to enter an amount
  canEnterAmounts: boolean;
}

export async function getBillingAccess(userId: string): Promise<BillingAccess | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, canApproveBilling: true, canManageBedgeBilling: true },
  });
  if (!user || !user.isActive) return null;

  const isAdmin = user.role === "ADMIN";
  const isPartner = user.role === "PARTNER";
  const manages: Company[] = [];
  if (isAdmin || (isPartner && user.canApproveBilling)) manages.push("MVC");
  if (isAdmin || (isPartner && user.canManageBedgeBilling)) manages.push("BEDGE");

  return { userId, isAdmin, manages, canEnterAmounts: isAdmin || isPartner };
}

export function managesCompany(access: BillingAccess, company: Company) {
  return access.manages.includes(company);
}

export function isEditableStatus(status: Bill["status"]) {
  return (EDITABLE_BILL_STATUSES as string[]).includes(status);
}

export const billInclude = {
  client: { select: { id: true, contactPerson: true, companyName: true, gstin: true } },
  task: { select: { id: true, title: true } },
  createdBy: { select: { id: true, name: true } },
  amountRequestedFrom: { select: { id: true, name: true } },
  amountEnteredBy: { select: { id: true, name: true } },
  reissuedFrom: { select: { id: true, billNumber: true } },
  reissuedAs: { select: { id: true, billNumber: true } },
  changeRequests: {
    where: { status: "pending" },
    select: {
      id: true,
      kind: true,
      reason: true,
      changes: true,
      createdAt: true,
      requestedBy: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.BillInclude;

type BillWithRelations = Prisma.BillGetPayload<{ include: typeof billInclude }>;

// The bill as sent to the browser. Amounts and bill numbers are removed for
// anyone who is not allowed to see them; hiding them in the UI is not enough.
export function serializeBill(bill: BillWithRelations, access: BillingAccess) {
  const isManager = managesCompany(access, bill.company);
  const canSeeAmount =
    isManager ||
    bill.amountRequestedFromId === access.userId ||
    bill.amountEnteredById === access.userId;

  return {
    id: bill.id,
    company: bill.company,
    type: bill.type,
    status: bill.status,
    description: bill.description,
    workDate: bill.workDate,
    remark: bill.remark,
    task: bill.task,
    client: bill.client,
    billToName: bill.billToName,
    billToAddress: bill.billToAddress,
    billToGstin: bill.billToGstin,
    createdBy: bill.createdBy,
    createdAt: bill.createdAt,
    amountRequestedFrom: bill.amountRequestedFrom,
    amountEnteredBy: canSeeAmount ? bill.amountEnteredBy : null,
    amountEnteredAt: canSeeAmount ? bill.amountEnteredAt : null,
    amount: canSeeAmount && bill.amount !== null ? Number(bill.amount) : null,
    billNumber: isManager ? bill.billNumber : null,
    billDate: isManager ? bill.billDate : null,
    reissuedFrom: isManager ? bill.reissuedFrom : null,
    reissuedAs: isManager ? bill.reissuedAs : null,
    pendingChange: isManager ? (bill.changeRequests[0] ?? null) : null,
    tallyExportedAt: isManager ? bill.tallyExportedAt : null,
    tallyNeedsUpdate: isManager ? bill.tallyNeedsUpdate : false,
    canManage: isManager,
  };
}

// Whether the user may open a bill at all
export function canViewBill(
  bill: Pick<Bill, "company" | "createdById" | "amountRequestedFromId" | "amountEnteredById">,
  access: BillingAccess
) {
  return (
    managesCompany(access, bill.company) ||
    bill.createdById === access.userId ||
    bill.amountRequestedFromId === access.userId ||
    bill.amountEnteredById === access.userId
  );
}

// Creates the draft bill for a task that has just been completed.
// Does nothing if the task already has a bill.
export async function ensureDraftBillForTask(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, description: true, company: true, clientId: true, bill: { select: { id: true } } },
  });
  if (!task || task.bill) return;

  try {
    await prisma.bill.create({
      data: {
        company: task.company,
        type: task.company === "BEDGE" ? "BEDGE" : null,
        description: task.description ? `${task.title}\n${task.description}` : task.title,
        workDate: new Date(),
        taskId: task.id,
        clientId: task.clientId,
        createdById: userId,
        events: { create: { action: "created", userId, remark: "Task completed" } },
      },
    });
  } catch (error) {
    // Two completions at the same moment: the other request created the bill
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}

// When a completed task is reopened, its bill is removed if nobody has
// worked on it yet
export async function removeUntouchedDraftBillForTask(taskId: string) {
  await prisma.bill.deleteMany({
    where: { taskId, status: "draft", amount: null, events: { every: { action: "created" } } },
  });
}

// Keeps the bill in step when a task is moved between MVC and B Edge.
// Returns false if the bill is already approved and can't follow the change.
export async function syncBillCompanyForTask(taskId: string, company: Company, userId: string) {
  const bill = await prisma.bill.findUnique({ where: { taskId } });
  if (!bill || bill.company === company) return true;
  if (!isEditableStatus(bill.status) && bill.status !== "not_billable") return false;

  await prisma.bill.update({
    where: { id: bill.id },
    data: {
      company,
      type: company === "BEDGE" ? "BEDGE" : null,
      // The other company's billing manager starts over with it
      status: bill.status === "not_billable" ? "not_billable" : "draft",
      amount: null,
      amountRequestedFromId: null,
      amountEnteredById: null,
      amountEnteredAt: null,
      events: { create: { action: "company_changed", userId, remark: `Moved to ${company === "BEDGE" ? "B Edge" : "MVC"}` } },
    },
  });
  return true;
}

// Admins and the billing managers of a company
export async function getBillingManagerIds(company: Company): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: "ADMIN" },
        { role: "PARTNER", ...(company === "MVC" ? { canApproveBilling: true } : { canManageBedgeBilling: true }) },
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

// In-app + push notification about a bill; clicking it opens the billing page.
// Never throws.
export async function notifyBillingUsers(
  userIds: string[],
  message: { title: string; content: string; sentById: string }
) {
  const uniqueIds = [...new Set(userIds)];
  const results = await Promise.allSettled(
    uniqueIds.map(async (sentToId) => {
      await prisma.notification.create({ data: { ...message, sentToId } });
      await sendPushToUser(sentToId, { title: message.title, body: message.content, url: "/dashboard/billing" });
    })
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to send billing notification:", result.reason);
    }
  }
}

// Who the bill is made out to: the saved client, or the name entered under "Other"
export function billPartyName(bill: {
  client?: { contactPerson: string; companyName: string | null } | null;
  billToName?: string | null;
}) {
  return bill.client ? bill.client.companyName || bill.client.contactPerson : bill.billToName || null;
}

// "Other": a name typed in by hand instead of a saved client
export const otherPartySchema = z.object({
  name: z.string().trim().min(2, "Enter the name to bill").max(150),
  address: z.string().trim().max(500).optional().nullable(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^\d{2}[A-Z0-9]{13}$/.test(v), "GSTIN should be 15 characters starting with the state code")
    .optional()
    .nullable(),
});

// Bill fields for a saved client or an "Other" name; choosing one clears the other
export function billToData(input: { clientId?: string | null; other?: z.infer<typeof otherPartySchema> | null }) {
  if (input.other) {
    return {
      clientId: null,
      billToName: input.other.name,
      billToAddress: input.other.address || null,
      billToGstin: input.other.gstin || null,
    };
  }
  return { clientId: input.clientId ?? null, billToName: null, billToAddress: null, billToGstin: null };
}

export function hasBillTo(bill: { clientId: string | null; billToName: string | null }) {
  return !!bill.clientId || !!bill.billToName;
}

export function describeBill(bill: {
  description: string;
  client?: { contactPerson: string; companyName: string | null } | null;
  billToName?: string | null;
}) {
  const firstLine = bill.description.split("\n")[0].slice(0, 80);
  const client = billPartyName(bill);
  return client ? `${firstLine} (${client})` : firstLine;
}

// Next bill number of each series, for the settings page
export async function getSeriesOverview() {
  const currentYear = financialYearOf();
  const rows = await prisma.billSeries.findMany();
  return (["GST", "NON_GST", "BEDGE"] as BillType[]).map((type) => {
    const row = rows.find((r) => r.type === type);
    // A new financial year starts again at 1
    const nextNumber = row && row.financialYear === currentYear ? row.nextNumber : 1;
    return {
      type,
      financialYear: currentYear,
      nextNumber,
      preview: formatBillNumber(type, currentYear, nextNumber),
    };
  });
}
