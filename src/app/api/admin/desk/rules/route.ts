import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { asDate, CODE_RE, RULE_KEY_RE, rulesChanged } from "@/lib/desk";
import { bad, onlyAdmin, requireDeskAdmin } from "@/lib/desk-admin";

export const dynamic = "force-dynamic";

// GET /api/admin/desk/rules – everything published (newest first), and the
// rates each client changed in its own office (from the latest reports)
export async function GET() {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const rules = await prisma.deskRule.findMany({ orderBy: [{ publishedAt: "desc" }], take: 500 });
  const desks = await prisma.deskClient.findMany({ where: { active: true }, select: { id: true, code: true, name: true } });
  const latest = await prisma.deskDailyReport.findMany({
    where: { deskClientId: { in: desks.map((d) => d.id) } },
    orderBy: { reportDate: "desc" },
    distinct: ["deskClientId"],
    select: { deskClientId: true, reportDate: true, payload: true },
  });
  const officeChanges = latest.flatMap((r) => {
    const d = desks.find((x) => x.id === r.deskClientId);
    const local = ((r.payload as Record<string, unknown>)?.localRules as Record<string, unknown>[]) ?? [];
    return local.map((l) => ({ client: d?.name, code: d?.code, asOf: r.reportDate, ...l }));
  });
  return NextResponse.json({ rules, officeChanges, codes: desks.map((d) => d.code) });
}

// POST /api/admin/desk/rules – publish { key, value, effectiveFrom, label?, unit?, notes?, clientCodes? }
export async function POST(request: NextRequest) {
  const admin = await requireDeskAdmin();
  if (!admin) return onlyAdmin();
  const b = await request.json().catch(() => ({}));
  const key = String(b.key ?? "").trim().toUpperCase();
  if (!RULE_KEY_RE.test(key)) return bad("Rule code like PF.WAGE_CEILING (capitals, digits, dots)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.effectiveFrom ?? ""))) return bad("Choose the date it applies from");
  let value: unknown = b.value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return bad("Value: a number like 12, text in quotes, or slabs like [[400000, 0], [800000, 5]]");
    }
  }
  if (value === undefined || value === null) return bad("Enter the value");
  const codes: string[] = Array.isArray(b.clientCodes) ? b.clientCodes.map((c: unknown) => String(c).toUpperCase()) : [];
  if (codes.some((c) => !CODE_RE.test(c))) return bad("Unknown client code");
  const rule = await prisma.deskRule.create({
    data: {
      key, value: value as Prisma.InputJsonValue, effectiveFrom: asDate(b.effectiveFrom),
      label: b.label ? String(b.label).slice(0, 120) : null, unit: b.unit ? String(b.unit).slice(0, 40) : null,
      notes: b.notes ? String(b.notes) : null, clientCodes: codes, publishedBy: admin.name.slice(0, 50),
    },
  });
  await rulesChanged();
  return NextResponse.json({ rule }, { status: 201 });
}

// PATCH /api/admin/desk/rules – { id, withdrawn: true|false }
export async function PATCH(request: NextRequest) {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id) || typeof b.withdrawn !== "boolean") return bad("Choose a rule");
  await prisma.deskRule.update({ where: { id }, data: { withdrawn: b.withdrawn } });
  await rulesChanged();
  return NextResponse.json({ ok: true });
}
