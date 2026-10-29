import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess, LISTED_BILL_STATUSES } from "@/lib/billing";

const PER_GROUP = 6;

// The header search (Ctrl+K): clients by name, PAN, GSTIN, email or phone;
// tasks by title; numbered bills by number; staff by name. Each group follows
// the same visibility as its own page.
export async function GET(request: NextRequest) {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ clients: [], tasks: [], bills: [], users: [] });
  const contains = { contains: q, mode: "insensitive" as const };
  const isManagerRole = user.role === "ADMIN" || user.role === "PARTNER";

  // Same rule as the task list: Admin all, Partner theirs and assigned, others assigned
  const taskWhere: Prisma.TaskWhereInput =
    user.role === "ADMIN"
      ? {}
      : user.role === "PARTNER"
        ? { OR: [{ assignedById: user.id }, { assignees: { some: { userId: user.id } } }] }
        : { assignees: { some: { userId: user.id } } };

  const access = await getBillingAccess(user.id);
  const billTypes = access?.listTypes ?? [];

  const [clients, tasks, bills, users] = await Promise.all([
    prisma.client.findMany({
      where: {
        OR: [
          { contactPerson: contains },
          { companyName: contains },
          { pan: contains },
          { gstin: contains },
          { email: contains },
          { phone: contains },
        ],
      },
      select: { id: true, contactPerson: true, companyName: true, gstin: true, pan: true, isGuest: true },
      orderBy: { contactPerson: "asc" },
      take: PER_GROUP,
    }),
    prisma.task.findMany({
      where: { AND: [taskWhere, { title: contains }] },
      select: {
        id: true,
        title: true,
        status: true,
        company: true,
        client: { select: { contactPerson: true, companyName: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: PER_GROUP,
    }),
    billTypes.length
      ? prisma.bill.findMany({
          where: { billNumber: contains, type: { in: billTypes }, status: { in: LISTED_BILL_STATUSES } },
          select: {
            id: true,
            billNumber: true,
            company: true,
            billToName: true,
            client: { select: { contactPerson: true, companyName: true } },
          },
          orderBy: { billDate: "desc" },
          take: PER_GROUP,
        })
      : Promise.resolve([]),
    isManagerRole
      ? prisma.user.findMany({
          where: { name: contains },
          select: { id: true, name: true, role: true, isActive: true },
          orderBy: { name: "asc" },
          take: PER_GROUP,
        })
      : Promise.resolve([]),
  ]);

  const party = (c: { contactPerson: string; companyName: string | null } | null) =>
    c ? c.companyName || c.contactPerson : null;

  return NextResponse.json({
    clients: clients.map((c) => ({
      id: c.id,
      name: c.companyName || c.contactPerson,
      detail: [c.companyName ? c.contactPerson : null, c.gstin, c.pan, c.isGuest ? "Guest" : null].filter(Boolean).join(" · "),
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      detail: [party(t.client), t.status.replace("_", " "), t.company === "BEDGE" ? "B Edge" : "MVC"].filter(Boolean).join(" · "),
    })),
    bills: bills.map((b) => ({
      id: b.id,
      number: b.billNumber,
      company: b.company,
      detail: party(b.client) || b.billToName || "",
    })),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      detail: `${u.role.replace("_", " ").toLowerCase()}${u.isActive ? "" : " · blocked"}`,
    })),
  });
}
