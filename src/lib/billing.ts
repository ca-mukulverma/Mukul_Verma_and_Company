import { Bill, BillReturnKind, BillType, Company, Prisma } from "@prisma/client";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";
import {
  ADMIN_AMOUNT_EDIT_STATUSES,
  BILL_TYPES,
  billTypesOf,
  EDITABLE_BILL_STATUSES,
  formatBillNumber,
  financialYearOf,
} from "@/lib/billing-constants";

// What the signed-in user may do in billing. Read from the database on every
// request (not the session) so a permission removed by Admin applies at once.
export interface BillingAccess {
  userId: string;
  isAdmin: boolean;
  // Companies whose bills this user manages (sees amounts, sets type, approves)
  manages: Company[];
  // Admins, and the partners Admin has allowed, can be asked to enter an amount
  canEnterAmounts: boolean;
  // Bill types whose Billing List (numbered bills) the user sees, downloads and
  // emails: those of the companies they manage, plus the ones Admin chose for a
  // partner with Billing List (all of them if Admin chose none)
  listTypes: BillType[];
  // The companies of those bill types
  listCompanies: Company[];
}

export async function getBillingAccess(userId: string): Promise<BillingAccess | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      isActive: true,
      canApproveBilling: true,
      canManageBedgeBilling: true,
      canEnterBillAmounts: true,
      canViewBillingList: true,
      billingListTypes: true,
    },
  });
  if (!user || !user.isActive) return null;

  const isAdmin = user.role === "ADMIN";
  const isPartner = user.role === "PARTNER";
  const manages: Company[] = [];
  if (isAdmin || (isPartner && user.canApproveBilling)) manages.push("MVC");
  if (isAdmin || (isPartner && user.canManageBedgeBilling)) manages.push("BEDGE");

  const chosen = isPartner && user.canViewBillingList ? (user.billingListTypes.length ? user.billingListTypes : BILL_TYPES) : [];
  const allowed = new Set<BillType>([...billTypesOf(manages), ...chosen]);
  const listTypes = (BILL_TYPES as BillType[]).filter((t) => allowed.has(t));
  const listCompanies = (["MVC", "BEDGE"] as Company[]).filter((c) => listTypes.some((t) => companyOfType(t) === c));

  return {
    userId,
    isAdmin,
    manages,
    canEnterAmounts: isAdmin || (isPartner && user.canEnterBillAmounts),
    listTypes,
    listCompanies,
  };
}

export function managesCompany(access: BillingAccess, company: Company) {
  return access.manages.includes(company);
}

export const LISTED_BILL_STATUSES: Bill["status"][] = ["approved", "cancelled"];

const companyOfType = (type: BillType): Company => (type === "BEDGE" ? "BEDGE" : "MVC");

// The bill is in a Billing List the user may see
export function seesInBillingList(bill: Pick<Bill, "type" | "status">, access: BillingAccess) {
  return !!bill.type && access.listTypes.includes(bill.type) && LISTED_BILL_STATUSES.includes(bill.status);
}

// The bill was sent to this user, or they entered its amount. Only counts while
// they may enter amounts; without that they see bills like any other staff.
export function isAmountSetterFor(
  bill: Pick<Bill, "amountRequestedFromId" | "amountEnteredById">,
  access: BillingAccess
) {
  return (
    access.canEnterAmounts &&
    (bill.amountRequestedFromId === access.userId || bill.amountEnteredById === access.userId)
  );
}

// Who a bill may be sent to for the amount: active Admins and allowed Partners
export const amountSetterWhere = {
  isActive: true,
  OR: [{ role: "ADMIN" }, { role: "PARTNER", canEnterBillAmounts: true }],
} satisfies Prisma.UserWhereInput;

export function isEditableStatus(status: Bill["status"]) {
  return (EDITABLE_BILL_STATUSES as string[]).includes(status);
}

export const billInclude = {
  client: {
    select: { id: true, contactPerson: true, companyName: true, gstin: true, connector: { select: { id: true, name: true } } },
  },
  connector: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
  createdBy: { select: { id: true, name: true } },
  amountRequestedFrom: { select: { id: true, name: true } },
  amountEnteredBy: { select: { id: true, name: true } },
  returnedBy: { select: { id: true, name: true } },
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
  // Partners allowed to see the Billing List see numbered bills in full
  const canSeeNumber = isManager || seesInBillingList(bill, access);
  const canSeeAmount = canSeeNumber || isAmountSetterFor(bill, access);

  return {
    id: bill.id,
    company: bill.company,
    type: bill.type,
    status: bill.status,
    description: bill.description,
    workDate: bill.workDate,
    remark: bill.remark,
    // When it reached its current stage, for "waiting 4 days"
    statusChangedAt: bill.statusChangedAt,
    task: bill.task,
    client: bill.client,
    billToName: bill.billToName,
    billToAddress: bill.billToAddress,
    billToGstin: bill.billToGstin,
    // A numbered bill keeps the connector it had at approval
    connector: bill.billNumber ? bill.connector : (bill.client?.connector ?? null),
    showGstin: bill.showGstin,
    createdBy: bill.createdBy,
    createdAt: bill.createdAt,
    amountRequestedFrom: bill.amountRequestedFrom,
    amountRequestNote: bill.amountRequestNote,
    amountEnteredBy: canSeeAmount ? bill.amountEnteredBy : null,
    amountEnteredAt: canSeeAmount ? bill.amountEnteredAt : null,
    amount: canSeeAmount && bill.amount !== null ? Number(bill.amount) : null,
    // The last send-back or Admin return; the comment may be about the amount
    returned:
      canSeeAmount && bill.returnKind
        ? {
            kind: bill.returnKind,
            remark: bill.returnRemark,
            at: bill.returnedAt,
            by: bill.returnedBy,
            count: bill.returnCount,
          }
        : null,
    billNumber: canSeeNumber ? bill.billNumber : null,
    billDate: canSeeNumber ? bill.billDate : null,
    reissuedFrom: canSeeNumber ? bill.reissuedFrom : null,
    reissuedAs: canSeeNumber ? bill.reissuedAs : null,
    emailedAt: canSeeNumber ? bill.emailedAt : null,
    emailedTo: canSeeNumber ? bill.emailedTo : null,
    emailStatus: canSeeNumber ? bill.emailStatus : null,
    emailError: canSeeNumber ? bill.emailError : null,
    emailStatusAt: canSeeNumber ? bill.emailStatusAt : null,
    pendingChange: isManager ? (bill.changeRequests[0] ?? null) : null,
    tallyExportedAt: isManager ? bill.tallyExportedAt : null,
    tallyNeedsUpdate: isManager ? bill.tallyNeedsUpdate : false,
    canManage: isManager,
    // Admin may correct the amount at any stage after it is entered
    canEditAmount: access.isAdmin && bill.amount !== null && ADMIN_AMOUNT_EDIT_STATUSES.includes(bill.status),
  };
}

// The bill type a new bill most likely needs: B Edge bills are always B Edge;
// an MVC bill takes the type of the client's last bill (GST, or Non-GST in
// whose name), which the billing manager can still change
export async function defaultBillType(company: Company, clientId: string | null | undefined): Promise<BillType | null> {
  if (company === "BEDGE") return "BEDGE";
  if (!clientId) return null;
  const last = await prisma.bill.findFirst({
    where: { clientId, company: "MVC", type: { not: null }, status: { notIn: ["cancelled", "not_billable"] } },
    orderBy: { createdAt: "desc" },
    select: { type: true },
  });
  return last?.type ?? null;
}

// Kept on the bill when it is sent back or returned by Admin, so the comment
// is shown on it (see isReturnOpen); cleared at final approval
export function billReturnData(kind: BillReturnKind, remark: string, userId: string) {
  return {
    returnKind: kind,
    returnRemark: remark,
    returnedAt: new Date(),
    returnedById: userId,
    returnCount: { increment: 1 },
  } satisfies Prisma.BillUncheckedUpdateManyInput;
}

export const CLEARED_BILL_RETURN = {
  returnKind: null,
  returnRemark: null,
  returnedAt: null,
  returnedById: null,
} satisfies Prisma.BillUncheckedUpdateManyInput;

// Bills sent back or returned that are still where they were sent back to:
// the comment is waiting for the billing manager (isReturnOpen)
export const OPEN_RETURN_WHERE = {
  OR: [
    { returnKind: "sent_back", status: "draft" },
    { returnKind: "final_rejected", status: "amount_entered" },
  ],
} satisfies Prisma.BillWhereInput;

// Whether the user may open a bill at all
export function canViewBill(
  bill: Pick<Bill, "company" | "type" | "status" | "createdById" | "amountRequestedFromId" | "amountEnteredById">,
  access: BillingAccess
) {
  return (
    managesCompany(access, bill.company) ||
    seesInBillingList(bill, access) ||
    bill.createdById === access.userId ||
    isAmountSetterFor(bill, access)
  );
}

// How long "Undo" is offered after a task is marked completed (the toast in
// the app is shorter, so an undo always lands inside it)
const UNDO_WINDOW_MS = 10_000;

// Creates the draft bill for a task that has just been completed.
// Does nothing if the task already has a bill.
export async function ensureDraftBillForTask(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, description: true, company: true, clientId: true, bill: { select: { id: true } } },
  });
  if (!task || task.bill) return;
  const type = await defaultBillType(task.company, task.clientId);

  try {
    await prisma.bill.create({
      data: {
        company: task.company,
        type,
        description: task.description ? `${task.title}\n${task.description}` : task.title,
        workDate: new Date(),
        taskId: task.id,
        clientId: task.clientId,
        createdById: userId,
      },
    });
  } catch (error) {
    // Two completions at the same moment: the other request created the bill
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }

  // Admin and the company's billing managers: the bill is waiting for them.
  // Sent after the response so completing the task isn't slowed down, and
  // after the few seconds in which the completion can be undone; an undone
  // completion removes the bill, and then nobody is told.
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, UNDO_WINDOW_MS));
    const stillThere = await prisma.bill.findUnique({ where: { taskId: task.id }, select: { id: true } });
    if (!stillThere) return;
    const [managerIds, completedBy] = await Promise.all([
      getBillingManagerIds(task.company),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);
    await notifyBillingUsers(
      managerIds.filter((id) => id !== userId),
      {
        title: "Task completed: ready for billing",
        content: `${completedBy?.name ?? "Someone"} completed "${task.title}" (${task.company === "BEDGE" ? "B Edge" : "MVC"}). Its bill is waiting in the ${task.company === "BEDGE" ? "B Edge" : "MVC"} bills.`,
        sentById: userId,
      },
      `/dashboard/billing?tab=${task.company === "BEDGE" ? "bedge" : "mvc"}`
    );
  });
}

// When a completed task is reopened, its bill is removed if nobody has
// worked on it yet: it has no history, or only an old "created" entry
export async function removeUntouchedDraftBillForTask(taskId: string) {
  await prisma.bill.deleteMany({
    where: { taskId, status: "draft", amount: null, events: { every: { action: "created" } } },
  });
}

// The steps on the way to a numbered bill. A year after the bill date only
// what happened to the numbered bill itself stays in its history: final
// approval, amount changes, edit/cancel/reissue requests and emails.
const WORKFLOW_EVENT_ACTIONS = [
  "type_set",
  "amount_requested",
  "amount_entered",
  "sent_back",
  "not_billable",
  "reopened",
  "details_updated",
  "company_changed",
  "manager_approved",
  "final_rejected",
];
export const BILL_WORKFLOW_HISTORY_DAYS = 365;

// Called from the nightly cleanup job
export async function pruneOldBillHistory(olderThanDays: number = BILL_WORKFLOW_HISTORY_DAYS) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.billEvent.deleteMany({
    where: { action: { in: WORKFLOW_EVENT_ACTIONS }, bill: { billDate: { lt: cutoff } } },
  });
  return count;
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
// The push goes out even if saving the in-app copy fails, so a phone is never
// left without the alert. `url` opens the tab the bill is waiting in.
export async function notifyBillingUsers(
  userIds: string[],
  message: { title: string; content: string; sentById: string },
  url = "/dashboard/billing"
) {
  const uniqueIds = [...new Set(userIds)];
  // The notification title column holds 75 characters
  const title = message.title.slice(0, 75);
  const results = await Promise.allSettled(
    uniqueIds.map(async (sentToId) => {
      const [saved] = await Promise.allSettled([
        prisma.notification.create({ data: { ...message, title, sentToId } }),
        sendPushToUser(sentToId, { title, body: message.content, url }),
      ]);
      if (saved.status === "rejected") throw saved.reason;
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

// The history line for "sent for the amount", with the billing manager's remark
export function amountRequestedRemark(targetName: string, note: string | null) {
  return note ? `Sent to ${targetName}\n${note}` : `Sent to ${targetName}`;
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
  return (BILL_TYPES as BillType[]).map((type) => {
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
