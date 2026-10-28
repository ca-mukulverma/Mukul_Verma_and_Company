import { NextRequest } from "next/server";
import { badRequest, notFound, requireComplianceAccess } from "@/lib/compliance-api";
import { fileResponse } from "@/lib/bill-files";
import { clientWorking } from "@/lib/gst-working";
import { workingExcel, workingFileName, workingPdf } from "@/lib/gst-working-export";

// GET /api/compliance/gst-working/export?clientId=…&fy=2026&format=xlsx|pdf
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const fy = Number(params.get("fy"));
  const format = params.get("format") === "pdf" ? "pdf" : "xlsx";
  if (!Number.isInteger(fy) || fy < 2017) return badRequest("Choose the financial year");
  const working = await clientWorking(params.get("clientId") ?? "", fy);
  if (!working) return notFound("Client not found");
  return format === "pdf"
    ? fileResponse(workingPdf(working), "pdf", workingFileName(working, "pdf"))
    : fileResponse(await workingExcel(working), "xlsx", workingFileName(working, "xlsx"));
}
