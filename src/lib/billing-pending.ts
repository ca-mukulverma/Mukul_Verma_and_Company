import { prisma } from "@/lib/prisma";
import { BillingAccess, getBillingAccess, notifyBillingUsers } from "@/lib/billing";
import { COMPANY_LABELS } from "@/lib/billing-constants";
import { pendingTallyWhere, tallyTypesFor } from "@/lib/tally";

// Each person's pending billing work, for the 11:58 AM reminder, the red alert
// on the dashboard and the escalation to Admin (see docs/BILLING.md). Work
// waiting longer than ESCALATE_DAYS (calendar days, Sundays included) is
// overdue: it shows in red and Admin is told about it.

export const ESCALATE_DAYS = 3;

export interface PendingGroup {
  key: string;
  label: string;
  count: number;
  // How many have waited longer than ESCALATE_DAYS, and the longest wait
  overdue: number;
  oldestDays: number;
  link: string;
}

const DAY = 86_400_000;

function group(key: string, label: string, link: string, since: Date[], now: Date): PendingGroup | null {
  if (since.length === 0) return null;
  const days = since.map((d) => Math.floor((now.getTime() - d.getTime()) / DAY));
  return {
    key,
    label,
    link,
    count: since.length,
    overdue: days.filter((d) => d >= ESCALATE_DAYS).length,
    oldestDays: Math.max(...days),
  };
}

const companyTab = (company: string) => `/dashboard/billing?tab=${company === "MVC" ? "mvc" : "bedge"}`;

// The billing work waiting for one person
export async function pendingBillingWork(access: BillingAccess, now = new Date()): Promise<PendingGroup[]> {
  const groups: (PendingGroup | null)[] = [];
  const stageTimes = (rows: { statusChangedAt: Date }[]) => rows.map((r) => r.statusChangedAt);

  if (access.canEnterAmounts) {
    const bills = await prisma.bill.findMany({
      where: { amountRequestedFromId: access.userId, status: "awaiting_amount" },
      select: { statusChangedAt: true },
    });
    groups.push(group("amounts", "Bills waiting for your amount", "/dashboard/billing?tab=amounts", stageTimes(bills), now));
  }

  for (const company of access.manages) {
    const [drafts, entered] = await Promise.all([
      prisma.bill.findMany({ where: { company, status: "draft" }, select: { statusChangedAt: true } }),
      prisma.bill.findMany({ where: { company, status: "amount_entered" }, select: { statusChangedAt: true } }),
    ]);
    const name = COMPANY_LABELS[company];
    groups.push(group(`draft-${company}`, `${name}: new work to bill (type, amount)`, companyTab(company), stageTimes(drafts), now));
    groups.push(group(`entered-${company}`, `${name}: amounts entered, waiting for your approval`, companyTab(company), stageTimes(entered), now));
  }

  if (access.isAdmin) {
    const [finals, requests] = await Promise.all([
      prisma.bill.findMany({ where: { status: "manager_approved" }, select: { statusChangedAt: true } }),
      prisma.billChangeRequest.findMany({ where: { status: "pending" }, select: { createdAt: true } }),
    ]);
    groups.push(group("final", "Bills waiting for your final approval", "/dashboard/billing?tab=final", stageTimes(finals), now));
    groups.push(group("requests", "Edit / cancel / reissue requests to decide", "/dashboard/billing?tab=requests", requests.map((r) => r.createdAt), now));
  }

  if (access.manages.length > 0) {
    const types = tallyTypesFor(access);
    const [tally, failedEmails, ledgers] = await Promise.all([
      prisma.bill.findMany({
        where: { OR: types.map((type) => pendingTallyWhere(type)) },
        select: { billDate: true, updatedAt: true },
      }),
      prisma.bill.findMany({
        where: { company: { in: access.manages }, status: "approved", emailStatus: "failed" },
        select: { emailStatusAt: true, updatedAt: true },
      }),
      prisma.client.findMany({ where: { tallyLedgerPending: true, connectorId: null }, select: { createdAt: true } }),
    ]);
    groups.push(group("tally", "Bills to send to Tally", "/dashboard/billing?tab=tally", tally.map((b) => b.billDate ?? b.updatedAt), now));
    groups.push(group("emails", "Bill emails that failed", "/dashboard/billing?tab=list", failedEmails.map((b) => b.emailStatusAt ?? b.updatedAt), now));
    groups.push(group("ledgers", "New clients without a Tally ledger", "/dashboard/clients", ledgers.map((c) => c.createdAt), now));
  }

  return groups.filter((g): g is PendingGroup => g !== null);
}

// Everyone who can have billing work: Admins and Partners
async function billingUsers() {
  return prisma.user.findMany({
    where: { isActive: true, role: { in: ["ADMIN", "PARTNER"] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}

export interface PersonPending {
  userId: string;
  name: string;
  groups: PendingGroup[];
}

// Pending work of every billing user (for Admin's view of what is overdue)
export async function everyonesPendingWork(now = new Date()): Promise<PersonPending[]> {
  const people: PersonPending[] = [];
  for (const user of await billingUsers()) {
    const access = await getBillingAccess(user.id);
    if (!access) continue;
    const groups = await pendingBillingWork(access, now);
    if (groups.length) people.push({ userId: user.id, name: user.name, groups });
  }
  return people;
}

function line(g: PendingGroup) {
  return `${g.label}: ${g.count}${g.overdue ? ` (${g.overdue} over ${ESCALATE_DAYS} days)` : ""}`;
}

// The daily reminder: each person gets their own pending work; Admins also
// get everyone's work that has waited more than ESCALATE_DAYS
export async function sendDailyBillingReminders(now = new Date()) {
  const people = await everyonesPendingWork(now);
  const admins = (await billingUsers()).filter((u) => u.role === "ADMIN");
  const sender = admins[0]?.id ?? people[0]?.userId;
  if (!sender) return { reminded: 0, escalated: 0 };

  const dayOfMonth = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric" }).format(now));
  for (const person of people) {
    const total = person.groups.reduce((sum, g) => sum + g.count, 0);
    const monthEnd =
      dayOfMonth >= 25 && person.groups.some((g) => g.key === "final")
        ? " Bills are dated on the day of final approval, so approve them before the month ends."
        : "";
    await notifyBillingUsers([person.userId], {
      title: `Billing: ${total} item${total === 1 ? "" : "s"} pending with you`,
      content: `${person.groups.map(line).join(". ")}.${monthEnd}`,
      sentById: sender,
    });
  }

  // Overdue work of others goes to every Admin
  const overdue = people
    .map((p) => ({ ...p, groups: p.groups.filter((g) => g.overdue > 0) }))
    .filter((p) => p.groups.length > 0);
  for (const admin of admins) {
    const others = overdue.filter((p) => p.userId !== admin.id);
    if (others.length === 0) continue;
    await notifyBillingUsers([admin.id], {
      title: `Billing overdue: ${others.length} ${others.length === 1 ? "person" : "people"}`,
      content: others
        .map((p) => `${p.name} – ${p.groups.map((g) => `${g.label.toLowerCase()}: ${g.overdue} (oldest ${g.oldestDays} days)`).join("; ")}`)
        .join(". "),
      sentById: admin.id,
    });
  }
  return { reminded: people.length, escalated: overdue.length };
}
