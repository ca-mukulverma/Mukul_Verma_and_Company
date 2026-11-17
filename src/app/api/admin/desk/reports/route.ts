import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asDate, istToday, previousWeekday } from "@/lib/desk";
import { onlyAdmin, requireDeskAdmin } from "@/lib/desk-admin";

export const dynamic = "force-dynamic";

// GET /api/admin/desk/reports?date=yyyy-mm-dd            – every client's report for a day (+ who is missing)
// GET /api/admin/desk/reports?client=<id>&days=30        – one client's recent reports (summary only)
// GET /api/admin/desk/reports?id=<reportId>              – one report in full
export async function GET(request: NextRequest) {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const q = new URL(request.url).searchParams;
  const id = q.get("id");
  if (id) {
    const report = await prisma.deskDailyReport.findUnique({
      where: { id },
      include: { deskClient: { select: { code: true, name: true } } },
    });
    return report ? NextResponse.json({ report }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const client = q.get("client");
  if (client) {
    const days = Math.min(Number(q.get("days") ?? 30) || 30, 366);
    const since = new Date(Date.now() - days * 86400000);
    const reports = await prisma.deskDailyReport.findMany({
      where: { deskClientId: client, reportDate: { gte: since } },
      orderBy: { reportDate: "desc" },
      select: { id: true, reportDate: true, receivedAt: true, appVersion: true, sentBy: true, summary: true },
    });
    return NextResponse.json({ reports });
  }
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "") ? (q.get("date") as string) : previousWeekday(istToday());
  const desks = await prisma.deskClient.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true, code: true, name: true, expectReports: true,
      reports: { where: { reportDate: asDate(ymd) }, select: { id: true, receivedAt: true, summary: true, appVersion: true } },
    },
  });
  const rows = desks.map((d) => ({ id: d.id, code: d.code, name: d.name, expectReports: d.expectReports,
                                   report: d.reports[0] ?? null }));
  const sum = (k: string) => rows.reduce((t, r) => t + (Number((r.report?.summary as Record<string, unknown>)?.[k]) || 0), 0);
  return NextResponse.json({
    date: ymd,
    rows,
    totals: {
      reported: rows.filter((r) => r.report).length,
      missing: rows.filter((r) => !r.report && r.expectReports).length,
      bills: sum("bills"), billsTotal: sum("billsTotal"), bankLines: sum("bankLines"),
      purchases: sum("purchases"), payrollPosted: sum("payrollPosted"), errors: sum("errors"), pending: sum("pending"),
    },
  });
}
