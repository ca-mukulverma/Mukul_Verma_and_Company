import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireComplianceAccess, badRequest, notFound } from "@/lib/compliance-api";
import { gstSheet, tdsSheet, workSheet } from "@/lib/compliance-sheet";
import { parseMonthKey, periodContaining } from "@/lib/compliance-periods";

// GET /api/compliance/sheet
//   ?view=gst&month=2026-10
//   ?view=tds&month=2026-10            (the quarter containing the month)
//   ?view=work&workTypeId=…&month=2026-04 (the work type's period containing the month)
export async function GET(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;

  const params = new URL(request.url).searchParams;
  const month = parseMonthKey(params.get("month"));
  if (!month) return badRequest("Choose a month");

  switch (params.get("view")) {
    case "gst":
      return NextResponse.json(await gstSheet(month, access));
    case "tds":
      return NextResponse.json(await tdsSheet(periodContaining("QUARTERLY", month).start, access));
    case "work": {
      const workTypeId = params.get("workTypeId");
      if (!workTypeId) return badRequest("Choose a work");
      const workType = await prisma.complianceWorkType.findUnique({ where: { id: workTypeId }, select: { frequency: true } });
      if (!workType) return notFound("Work not found");
      const sheet = await workSheet(workTypeId, periodContaining(workType.frequency, month).start, access);
      return sheet ? NextResponse.json(sheet) : notFound("Work not found");
    }
    default:
      return badRequest("Unknown sheet");
  }
}
