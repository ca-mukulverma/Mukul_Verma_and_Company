import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { compare } from "bcryptjs";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dashboardCache } from "@/lib/cache";

const resetSchema = z.object({
  password: z.string().min(1).max(200),
});

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" ? user : null;
}

async function countBillingData() {
  const [bills, approvedBills, events, changeRequests, tallyExports, completedTasks] = await Promise.all([
    prisma.bill.count(),
    prisma.bill.count({ where: { billNumber: { not: null } } }),
    prisma.billEvent.count(),
    prisma.billChangeRequest.count(),
    prisma.tallyExport.count(),
    prisma.task.count({ where: { status: "completed" } }),
  ]);
  return { bills, approvedBills, events, changeRequests, tallyExports, completedTasks };
}

// GET /api/billing/reset – how much billing data a reset would remove (Admin)
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only Admin can clear billing data" }, { status: 403 });
  }
  return NextResponse.json({ counts: await countBillingData() });
}

// POST /api/billing/reset – Admin clears all bills for a fresh start, after
// confirming with their login password. Settings (number series, company
// profiles, Tally ledgers, bill emails) and user permissions are kept.
// Completed tasks that are still open get a fresh draft bill, so no work
// drops out of billing (docs/BILLING.md).
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Only Admin can clear billing data" }, { status: 403 });
  }

  const parsed = resetSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your login password" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: admin.id }, select: { password: true, isActive: true } });
  const passwordMatches = user?.isActive && user.password ? await compare(parsed.data.password, user.password) : false;
  if (!passwordMatches) {
    return NextResponse.json({ error: "Incorrect password. Billing data was not cleared." }, { status: 403 });
  }

  const counts = await countBillingData();
  const recreated = await prisma.$transaction(
    async (tx) => {
      // Bill history and change requests go with their bills
      await tx.billChangeRequest.deleteMany();
      await tx.billEvent.deleteMany();
      await tx.bill.updateMany({ data: { reissuedFromId: null } });
      await tx.bill.deleteMany();
      await tx.tallyExport.deleteMany();

      const tasks = await tx.task.findMany({
        where: { status: "completed" },
        select: { id: true, title: true, description: true, company: true, clientId: true },
      });
      for (const task of tasks) {
        await tx.bill.create({
          data: {
            company: task.company,
            type: task.company === "BEDGE" ? "BEDGE" : null,
            description: task.description ? `${task.title}\n${task.description}` : task.title,
            workDate: new Date(),
            taskId: task.id,
            clientId: task.clientId,
            createdById: admin.id,
            events: { create: { action: "created", userId: admin.id, remark: "Billing data cleared; task is completed" } },
          },
        });
      }

      await tx.activity.create({
        data: {
          type: "billing",
          action: "billing_data_cleared",
          target: "Billing",
          details: { ...counts, recreatedDraftBills: tasks.length },
          userId: admin.id,
        },
      });
      return tasks.length;
    },
    { timeout: 60000 }
  );

  await dashboardCache.invalidate("*").catch(() => undefined);

  return NextResponse.json({ cleared: counts, recreatedDraftBills: recreated });
}
