import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing";
import { billFileName, loadBillDocuments } from "@/lib/bill-document";
import { fileResponse, renderBill } from "@/lib/bill-files";

// GET /api/bills/:id/document?format=pdf|docx – download one numbered bill
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const format = request.nextUrl.searchParams.get("format") === "docx" ? "docx" : "pdf";
  const [doc] = await loadBillDocuments([(await params).id], access);
  if (!doc) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

  return fileResponse(await renderBill(doc, format), format, billFileName(doc, format));
}
