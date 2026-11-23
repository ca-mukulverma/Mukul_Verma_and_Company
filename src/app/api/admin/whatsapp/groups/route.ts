import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bad, onlyAdmin, requireDeskAdmin } from "@/lib/desk-admin";
import { forgetStaffPhones, last10, listenerLastSeen } from "@/lib/wa-intake";

export const dynamic = "force-dynamic";

// GET /api/admin/whatsapp/groups – groups the listener has seen, with the
// client / Desk each is linked to, the listener's last contact, and staff
// without a phone (their replies cannot be recognised).
export async function GET() {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const [groups, clients, desks, users] = await Promise.all([
    prisma.waGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { messages: true } } } }),
    prisma.client.findMany({ where: { isGuest: false }, select: { id: true, companyName: true, contactPerson: true }, orderBy: { companyName: "asc" } }),
    prisma.deskClient.findMany({ where: { active: true }, select: { id: true, code: true, name: true } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true } }),
  ]);
  return NextResponse.json({
    groups, clients, desks, listenerLastSeen: await listenerLastSeen(),
    staffWithoutPhone: users.filter((u) => last10(u.phone).length !== 10).map((u) => u.name),
    keySet: !!process.env.WA_LISTENER_KEY,
  });
}

// PATCH /api/admin/whatsapp/groups – { id, clientId?, deskClientId?, active? }
export async function PATCH(request: NextRequest) {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const b = await request.json().catch(() => ({}));
  const g = await prisma.waGroup.findUnique({ where: { id: String(b.id ?? "") } });
  if (!g) return bad("Choose a group");
  const data: Record<string, unknown> = {};
  if (b.clientId !== undefined) data.clientId = b.clientId || null;
  if (b.deskClientId !== undefined) data.deskClientId = b.deskClientId || null;
  if (typeof b.active === "boolean") data.active = b.active;
  const row = await prisma.waGroup.update({ where: { id: g.id }, data });
  if (data.clientId !== undefined) {
    await prisma.waMessage.updateMany({ where: { groupId: g.id, clientId: null }, data: { clientId: row.clientId } });
  }
  await forgetStaffPhones();
  return NextResponse.json({ group: row });
}
