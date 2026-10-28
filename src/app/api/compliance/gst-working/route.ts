import { NextRequest, NextResponse } from "next/server";
import { badRequest, notFound, requireComplianceAccess } from "@/lib/compliance-api";
import { parseMonthKey } from "@/lib/compliance-periods";
import { clientWorking, gstCompleteness, gstExceptions } from "@/lib/gst-working";

// GET /api/compliance/gst-working?clientId=…&fy=2026 – a client's GST working
// GET /api/compliance/gst-working?month=2026-09       – every client's period
//                                                      ending in the month, with what needs attention
// GET /api/compliance/gst-working?files=2026          – files uploaded per client and period
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId");
  if (clientId) {
    const fy = Number(params.get("fy"));
    if (!Number.isInteger(fy) || fy < 2017) return badRequest("Choose the financial year");
    const working = await clientWorking(clientId, fy);
    return working ? NextResponse.json(working) : notFound("Client not found");
  }
  const files = params.get("files");
  if (files) {
    const fy = Number(files);
    if (!Number.isInteger(fy) || fy < 2017) return badRequest("Choose the financial year");
    return NextResponse.json({ clients: await gstCompleteness(fy) });
  }
  const month = parseMonthKey(params.get("month"));
  if (!month) return badRequest("Choose a month");
  return NextResponse.json({ rows: await gstExceptions(month) });
}
