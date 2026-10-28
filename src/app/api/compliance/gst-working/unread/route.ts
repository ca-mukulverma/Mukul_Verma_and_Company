import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, requireComplianceAccess } from "@/lib/compliance-api";

// GET /api/compliance/gst-working/unread?clientId=… – GST return files
// uploaded before figures were read from them, so the browser can read them now
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!clientId) return badRequest("Choose the client");
  const docs = await prisma.complianceDocument.findMany({
    where: {
      clientId,
      gst: { equals: Prisma.DbNull },
      kind: { in: ["RETURN_PDF", "RETURN_JSON", "GSTR1A_PDF", "GSTR1A_JSON", "GSTR2B_JSON"] },
      item: { workType: { kind: { in: ["GSTR1", "GSTR3B"] } } },
    },
    select: { id: true, fileName: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return NextResponse.json({ docs });
}
