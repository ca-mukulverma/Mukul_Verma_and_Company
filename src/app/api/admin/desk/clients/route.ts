import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CODE_RE, forgetDeskKey, lastSeen, newDeskKey } from "@/lib/desk";
import { bad, onlyAdmin, requireDeskAdmin } from "@/lib/desk-admin";

export const dynamic = "force-dynamic";

// GET /api/admin/desk/clients – every Desk client with last report / last contact
export async function GET() {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const rows = await prisma.deskClient.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, code: true, name: true, clientId: true, keyHint: true, active: true, expectReports: true,
      lastReportDate: true, lastReportAt: true, appVersion: true, notes: true, createdAt: true,
      client: { select: { companyName: true, contactPerson: true } },
      events: { orderBy: { at: "desc" }, take: 5, select: { at: true, kind: true, detail: true } },
    },
  });
  const seen = await lastSeen(rows.map((r) => r.code));
  const clients = await prisma.client.findMany({
    where: { isGuest: false },
    select: { id: true, companyName: true, contactPerson: true },
    orderBy: { companyName: "asc" },
  });
  return NextResponse.json({ desks: rows.map((r) => ({ ...r, lastSeen: seen[r.code] ?? null })), clients });
}

// POST /api/admin/desk/clients – add a client; returns its key ONCE
export async function POST(request: NextRequest) {
  const admin = await requireDeskAdmin();
  if (!admin) return onlyAdmin();
  const b = await request.json().catch(() => ({}));
  const code = String(b.code ?? "").trim().toUpperCase();
  const name = String(b.name ?? "").trim();
  if (!CODE_RE.test(code)) return bad("Code: 2–30 capital letters / digits, e.g. GUDAKESA");
  if (!name) return bad("Enter the client's name");
  if (await prisma.deskClient.findUnique({ where: { code } })) return bad(`Code ${code} is already used`);
  const k = newDeskKey();
  const row = await prisma.deskClient.create({
    data: { code, name: name.slice(0, 100), clientId: b.clientId || null, keyHash: k.keyHash, keyHint: k.keyHint,
            notes: b.notes ? String(b.notes) : null },
  });
  await prisma.deskEvent.create({ data: { deskClientId: row.id, kind: "created", detail: `Added by ${admin.name}` } });
  return NextResponse.json({ desk: { id: row.id, code, name }, key: k.key }, { status: 201 });
}

// PATCH /api/admin/desk/clients – { id, active?, expectReports?, clientId?, name?, notes?, newKey? }
export async function PATCH(request: NextRequest) {
  const admin = await requireDeskAdmin();
  if (!admin) return onlyAdmin();
  const b = await request.json().catch(() => ({}));
  const cur = await prisma.deskClient.findUnique({ where: { id: String(b.id ?? "") } });
  if (!cur) return bad("Choose a client");
  const data: Record<string, unknown> = {};
  if (typeof b.active === "boolean") data.active = b.active;
  if (typeof b.expectReports === "boolean") data.expectReports = b.expectReports;
  if (b.clientId !== undefined) data.clientId = b.clientId || null;
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim().slice(0, 100);
  if (typeof b.notes === "string") data.notes = b.notes;
  let key: string | undefined;
  if (b.newKey === true) {
    const k = newDeskKey();
    key = k.key;
    data.keyHash = k.keyHash;
    data.keyHint = k.keyHint;
  }
  await prisma.deskClient.update({ where: { id: cur.id }, data });
  await forgetDeskKey(cur.keyHash); // switched off / new key takes effect at once
  const what = [
    b.newKey ? "new key made (old key stops working)" : "",
    typeof b.active === "boolean" ? (b.active ? "switched on" : "switched off") : "",
  ].filter(Boolean).join("; ") || "details changed";
  await prisma.deskEvent.create({ data: { deskClientId: cur.id, kind: "changed", detail: `${what} by ${admin.name}` } });
  return NextResponse.json({ ok: true, ...(key ? { key } : {}) });
}
