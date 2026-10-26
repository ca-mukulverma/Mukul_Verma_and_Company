import { NextRequest, NextResponse } from "next/server";
import { requireComplianceAccess, badRequest } from "@/lib/compliance-api";
import { clientReco, gstMismatches } from "@/lib/compliance-reco";
import { parseMonthKey } from "@/lib/compliance-periods";

// GET /api/compliance/reco?clientId=…&fy=2026 – one client's year
// GET /api/compliance/reco?month=2026-10     – all clients' GST mismatches
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId");
  if (clientId) {
    const fy = Number(params.get("fy"));
    if (!Number.isInteger(fy) || fy < 2000) return badRequest("Choose the financial year");
    return NextResponse.json(await clientReco(clientId, fy));
  }
  const month = parseMonthKey(params.get("month"));
  if (!month) return badRequest("Choose a month");
  return NextResponse.json({ rows: await gstMismatches(month) });
}
