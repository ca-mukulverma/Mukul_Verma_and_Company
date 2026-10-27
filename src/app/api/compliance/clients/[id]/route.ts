import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partyName } from "@/lib/compliance";
import { dateKey, monthKey, periodLabel, utcDate } from "@/lib/compliance-periods";
import { notFound, requireComplianceAccess } from "@/lib/compliance-api";

// GET /api/compliance/clients/[id]?fy=2026 – everything about one client:
// recurring work, monthly obligations, the year's items and all files
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const fyParam = Number(new URL(request.url).searchParams.get("fy"));
  const today = new Date();
  const fy = Number.isInteger(fyParam) && fyParam > 2000 ? fyParam : today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;

  const client = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true,
      contactPerson: true,
      companyName: true,
      gstin: true,
      tan: true,
      phone: true,
      email: true,
      complianceSubscriptions: { include: { workType: { select: { name: true, sortOrder: true, kind: true } } } },
      obligations: { orderBy: [{ kind: "asc" }, { createdAt: "asc" }] },
      complianceDocuments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          kind: true,
          fileName: true,
          size: true,
          createdAt: true,
          item: { select: { id: true, frequency: true, periodStart: true, workType: { select: { name: true } } } },
        },
      },
      complianceItems: {
        where: { periodStart: { gte: utcDate(fy, 4), lt: utcDate(fy + 1, 4) } },
        select: {
          id: true,
          workTypeId: true,
          frequency: true,
          periodStart: true,
          status: true,
          dueDate: true,
          filedAt: true,
          historical: true,
        },
      },
    },
  });
  if (!client) return notFound("Client not found");

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return NextResponse.json({
    fy,
    client: { id: client.id, name: partyName(client), gstin: client.gstin, tan: client.tan, phone: client.phone, email: client.email },
    subscriptions: client.complianceSubscriptions
      .sort((a, b) => a.workType.sortOrder - b.workType.sortOrder)
      .map((s) => ({
        id: s.id,
        workTypeId: s.workTypeId,
        workTypeName: s.workType.name,
        kind: s.workType.kind,
        frequency: s.frequency,
        previousFrequency: s.previousFrequency,
        frequencyFrom: s.frequencyFrom ? monthKey(s.frequencyFrom) : null,
        startPeriod: monthKey(s.startPeriod),
        endPeriod: s.endPeriod ? monthKey(s.endPeriod) : null,
        active: s.active,
        ...(access.isManager && { feeNil: num(s.feeNil), feeNonNil: num(s.feeNonNil) }),
      })),
    obligations: client.obligations.map((o) => ({
      id: o.id,
      kind: o.kind,
      category: o.category,
      payee: o.payee,
      fixedAmount: num(o.fixedAmount),
      ratePercent: Number(o.ratePercent),
      fromMonth: monthKey(o.fromMonth),
      toMonth: o.toMonth ? monthKey(o.toMonth) : null,
      active: o.active,
    })),
    documents: client.complianceDocuments.map((d) => ({
      id: d.id,
      kind: d.kind,
      fileName: d.fileName,
      size: d.size,
      createdAt: d.createdAt.toISOString(),
      itemId: d.item?.id ?? null,
      work: d.item ? `${d.item.workType.name} ${periodLabel(d.item.frequency, d.item.periodStart)}` : null,
    })),
    items: client.complianceItems.map((i) => ({
      id: i.id,
      workTypeId: i.workTypeId,
      period: periodLabel(i.frequency, i.periodStart),
      periodStart: dateKey(i.periodStart),
      frequency: i.frequency,
      status: i.status,
      dueDate: dateKey(i.dueDate),
      filedAt: i.filedAt ? dateKey(i.filedAt) : null,
      historical: i.historical,
    })),
  });
}
