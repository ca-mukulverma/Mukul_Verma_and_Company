import { NextRequest, NextResponse } from "next/server";
import { badRequest, notFound, requireComplianceAccess } from "@/lib/compliance-api";
import { clientWorking } from "@/lib/gst-working";

// GET /api/compliance/gst-working?clientId=…&fy=2026 – a client's GST working
// (shown on the client's page in Compliance → Clients)
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId");
  if (!clientId) return badRequest("Choose a client");
  const fy = Number(params.get("fy"));
  if (!Number.isInteger(fy) || fy < 2017) return badRequest("Choose the financial year");
  const working = await clientWorking(clientId, fy);
  return working ? NextResponse.json(working) : notFound("Client not found");
}
