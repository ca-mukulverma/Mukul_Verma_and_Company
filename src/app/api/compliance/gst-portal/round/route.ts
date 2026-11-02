import { NextRequest, NextResponse } from "next/server";
import { badRequest, requireComplianceAccess } from "@/lib/compliance-api";
import { parseMonthKey } from "@/lib/compliance-periods";
import { defaultRoundMonth, roundPortalFiles } from "@/lib/gst-portal-files";

// GET /api/compliance/gst-portal/round?month=2026-10 – every client with GST
// work in the month and its saved / missing return files (Compliance → GST
// downloads; docs/GST_PORTAL_EXTENSION_PLAN.md)
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const month = request.nextUrl.searchParams.get("month") || defaultRoundMonth();
  if (!parseMonthKey(month)) return badRequest("Choose a month");
  return NextResponse.json(await roundPortalFiles(month));
}
