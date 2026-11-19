import { Company, Prisma, WorkCorrectionRequester } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { defaultBillType, getBillingManagerIds, isEditableStatus, notifyBillingUsers } from "@/lib/billing";
import { BILL_STATUS_LABELS } from "@/lib/billing-constants";
import { partyName } from "@/lib/compliance";

// Correcting logged work (Work done → Correct). Admin and the partners who see
// everyone's work can fix work a member of staff logged wrongly: who did it,
// the firm, client, work, date and remark. Every correction keeps what changed,
// why, and on whose request (a member of staff, the client, or nobody), and
// the bill's history gets a "Work corrected" line.
//
// Who did it can be corrected at any stage. The firm, client, work and date
// only until the bill is approved: after that the bill's number, PDF and Tally
// entry depend on them, so the billing manager asks for an edit of the bill.

const FIELD_LABELS = {
  doneBy: "Done by",
  company: "Firm",
  client: "Client",
  work: "Work",
  date: "Date",
  remark: "Remark",
} as const;
export type CorrectionField = keyof typeof FIELD_LABELS;

export type CorrectionChanges = Partial<Record<CorrectionField, { from: string; to: string }>>;

export const correctionSchema = z
  .object({
    createdById: z.string().min(1).optional(),
    company: z.enum(["MVC", "BEDGE"]).optional(),
    clientId: z.string().min(1).optional(),
    description: z.string().trim().min(3, "Describe the work in at least 3 characters").max(2000).optional(),
    // Calendar day in India
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD").optional(),
    remark: z.string().trim().max(1000).optional(),
    reason: z.string().trim().min(5, "Describe what is being changed and why").max(2000),
    requester: z.nativeEnum(WorkCorrectionRequester),
    requestedById: z.string().min(1).optional().nullable(),
  })
  .refine((v) => v.requester !== "staff" || !!v.requestedById, {
    message: "Choose the member of staff who asked for the change",
    path: ["requestedById"],
  });
export type CorrectionInput = z.infer<typeof correctionSchema>;

const IST_OFFSET = 5.5 * 3_600_000;
const istDay = (date: Date) => new Date(date.getTime() + IST_OFFSET).toISOString().slice(0, 10);
const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const companyLabel = (company: Company) => (company === "BEDGE" ? "B Edge" : "MVC");

// Only work logged directly: not a task's or compliance item's bill, nor a reissue
export const LOGGED_WORK_WHERE = {
  taskId: null,
  complianceItem: { is: null },
  reissuedFromId: null,
} satisfies Prisma.BillWhereInput;

const person = { select: { id: true, name: true } } as const;

const entrySelect = {
  id: true,
  company: true,
  status: true,
  description: true,
  workDate: true,
  remark: true,
  billNumber: true,
  billToName: true,
  clientId: true,
  client: { select: { id: true, contactPerson: true, companyName: true } },
  createdBy: person,
  corrections: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      changes: true,
      reason: true,
      requester: true,
      requestedBy: person,
      correctedBy: person,
      createdAt: true,
    },
  },
} satisfies Prisma.BillSelect;

type Entry = Prisma.BillGetPayload<{ select: typeof entrySelect }>;

// Firm, client, work and date can still change
const contentEditable = (status: Entry["status"]) => isEditableStatus(status) || status === "not_billable";

export function serializeEntry(entry: Entry) {
  return {
    id: entry.id,
    company: entry.company,
    status: entry.status,
    statusLabel: BILL_STATUS_LABELS[entry.status],
    billNumber: entry.billNumber,
    description: entry.description,
    workDate: istDay(entry.workDate),
    remark: entry.remark,
    client: entry.client,
    // "Other": a name typed in instead of a saved client
    billToName: entry.client ? null : entry.billToName,
    createdBy: entry.createdBy,
    contentEditable: contentEditable(entry.status),
    corrections: entry.corrections.map((c) => ({
      id: c.id,
      changes: c.changes as CorrectionChanges,
      reason: c.reason,
      requester: c.requester,
      requestedBy: c.requestedBy,
      correctedBy: c.correctedBy,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}
export type LoggedWorkEntry = ReturnType<typeof serializeEntry>;

export async function getLoggedWork(id: string) {
  return prisma.bill.findFirst({ where: { id, ...LOGGED_WORK_WHERE }, select: entrySelect });
}

type Result = { ok: true; entry: LoggedWorkEntry } | { ok: false; status: number; error: string };

export async function correctLoggedWork(id: string, input: CorrectionInput, corrector: { id: string; name: string }): Promise<Result> {
  const entry = await getLoggedWork(id);
  if (!entry) return { ok: false, status: 404, error: "Logged work not found" };

  const changes: CorrectionChanges = {};
  const data: Prisma.BillUncheckedUpdateManyInput = {};

  // Who did it
  if (input.createdById && input.createdById !== entry.createdBy.id) {
    const doer = await prisma.user.findUnique({ where: { id: input.createdById }, select: { id: true, name: true } });
    if (!doer) return { ok: false, status: 400, error: "That member of staff was not found" };
    data.createdById = doer.id;
    changes.doneBy = { from: entry.createdBy.name, to: doer.name };
  }

  // The person who asked for it
  let requestedBy: { id: string; name: string } | null = null;
  if (input.requester === "staff") {
    requestedBy = await prisma.user.findUnique({ where: { id: input.requestedById! }, select: { id: true, name: true } });
    if (!requestedBy) return { ok: false, status: 400, error: "The person who asked for the change was not found" };
  }

  // The remark is a note on the entry; it can be corrected at any stage
  if (input.remark !== undefined && (input.remark || null) !== (entry.remark || null)) {
    data.remark = input.remark || null;
    changes.remark = { from: entry.remark || "—", to: input.remark || "—" };
  }

  const company = input.company && input.company !== entry.company ? input.company : null;
  const clientChanged = !!input.clientId && input.clientId !== entry.clientId;
  const descriptionChanged = input.description !== undefined && input.description !== entry.description;
  const dateChanged = input.workDate !== undefined && input.workDate !== istDay(entry.workDate);

  if (company || clientChanged || descriptionChanged || dateChanged) {
    if (!contentEditable(entry.status)) {
      return {
        ok: false,
        status: 409,
        error: `This work is already ${entry.billNumber ? `billed (bill ${entry.billNumber})` : BILL_STATUS_LABELS[entry.status].toLowerCase()}. Only who did it and the remark can be corrected here; ask the billing manager to request an edit of the bill for the rest.`,
      };
    }
    if (company) {
      data.company = company;
      changes.company = { from: companyLabel(entry.company), to: companyLabel(company) };
      // The other firm's billing manager starts over with it, as when a task moves
      if (entry.status !== "not_billable") data.status = "draft";
      Object.assign(data, { amount: null, amountRequestedFromId: null, amountEnteredById: null, amountEnteredAt: null, amountRequestNote: null });
    }
    if (clientChanged) {
      const client = await prisma.client.findUnique({
        where: { id: input.clientId },
        select: { id: true, contactPerson: true, companyName: true },
      });
      if (!client) return { ok: false, status: 400, error: "Client not found" };
      Object.assign(data, { clientId: client.id, billToName: null, billToAddress: null, billToGstin: null });
      changes.client = {
        from: entry.client ? partyName(entry.client) : entry.billToName || "—",
        to: partyName(client),
      };
    }
    if (company || clientChanged) {
      // The bill type follows the firm, and an MVC bill the client's usual one
      const newCompany = company ?? entry.company;
      const newClientId = clientChanged ? input.clientId! : entry.clientId;
      data.type = await defaultBillType(newCompany, newClientId);
    }
    if (descriptionChanged) {
      data.description = input.description!;
      changes.work = { from: entry.description, to: input.description! };
    }
    if (dateChanged) {
      // Logged work is dated midday in India
      data.workDate = new Date(`${input.workDate}T12:00:00+05:30`);
      changes.date = { from: fmtDay(istDay(entry.workDate)), to: fmtDay(input.workDate!) };
    }
  }

  if (Object.keys(changes).length === 0) return { ok: false, status: 400, error: "Nothing was changed" };

  const summary = Object.entries(changes)
    .map(([field, c]) => `${FIELD_LABELS[field as CorrectionField]}: ${c.from} → ${c.to}`)
    .join("\n");
  const askedBy =
    input.requester === "staff" ? `On request of ${requestedBy!.name}` : input.requester === "client" ? "On the client's request" : "Found by the corrector";

  const saved = await prisma.$transaction(async (tx) => {
    // Only if nobody moved the bill on meanwhile
    const { count } = await tx.bill.updateMany({ where: { id, status: entry.status }, data });
    if (count === 0) return false;
    await tx.workCorrection.create({
      data: {
        billId: id,
        changes: changes as Prisma.InputJsonValue,
        reason: input.reason,
        requester: input.requester,
        requestedById: requestedBy?.id ?? null,
        correctedById: corrector.id,
      },
    });
    await tx.billEvent.create({
      data: { billId: id, action: "work_corrected", userId: corrector.id, remark: `${summary}\nWhy: ${input.reason}\n${askedBy}` },
    });
    return true;
  });
  if (!saved) return { ok: false, status: 409, error: "This work was changed by someone else. Refresh and try again." };

  // Tell the people whose work it is (before and after), and the new firm's
  // billing managers when it moved firm
  const work = (input.description ?? entry.description).slice(0, 80);
  const staffIds = [entry.createdBy.id, data.createdById as string | undefined].filter(
    (uid): uid is string => !!uid && uid !== corrector.id
  );
  const notices: Promise<void>[] = [];
  if (staffIds.length) {
    notices.push(
      notifyBillingUsers(
        staffIds,
        {
          title: "Your logged work was corrected",
          content: `${corrector.name} corrected “${work}”.\n${summary}\nWhy: ${input.reason}\n${askedBy}`,
          sentById: corrector.id,
        },
        "/dashboard/work-done"
      )
    );
  }
  if (company && entry.status !== "not_billable") {
    const managers = (await getBillingManagerIds(company)).filter((uid) => uid !== corrector.id);
    notices.push(
      notifyBillingUsers(managers, {
        title: `Work moved to ${companyLabel(company)}`,
        content: `${corrector.name} moved “${work}” to ${companyLabel(company)}. It is a draft bill again.`,
        sentById: corrector.id,
      })
    );
  }
  await Promise.all(notices);

  const fresh = await getLoggedWork(id);
  return { ok: true, entry: serializeEntry(fresh!) };
}
