import { NextRequest, NextResponse } from "next/server";
import { badRequest, notFound, requireComplianceAccess } from "@/lib/compliance-api";
import { clientPortalFiles } from "@/lib/gst-portal-files";

// GET /api/compliance/gst-portal?clientId=…&fy=2026 – a client's GST return
// files per period: saved, missing, not due yet (the GST portal box on the
// client's page; docs/GST_PORTAL_EXTENSION_PLAN.md)
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const params = request.nextUrl.searchParams;
  const clientId = params.get("clientId");
  if (!clientId) return badRequest("Choose a client");
  const fy = Number(params.get("fy"));
  if (!Number.isInteger(fy) || fy < 2017) return badRequest("Choose the financial year");
  const files = await clientPortalFiles(clientId, fy);
  return files ? NextResponse.json(files) : notFound("Client not found");
}
