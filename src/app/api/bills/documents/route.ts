import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing";
import { loadBillDocuments } from "@/lib/bill-document";
import { fileResponse, renderBillsZip } from "@/lib/bill-files";
import { renderBillsPdf } from "@/lib/bill-pdf";

const requestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  // pdf / docx: a ZIP with one file per bill; combined: one PDF to print
  format: z.enum(["pdf", "docx", "combined"]),
});

// POST /api/bills/documents – download several numbered bills at once
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access || access.listCompanies.length === 0) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Select up to 200 bills" }, { status: 400 });
  const { ids, format } = parsed.data;

  const docs = await loadBillDocuments([...new Set(ids)], access);
  if (docs.length === 0) return NextResponse.json({ error: "No numbered bills selected" }, { status: 404 });

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "combined") {
    return fileResponse(renderBillsPdf(docs), "pdf", `Bills-${stamp}.pdf`);
  }
  return fileResponse(await renderBillsZip(docs, format), "zip", `Bills-${stamp}-${format.toUpperCase()}.zip`);
}
