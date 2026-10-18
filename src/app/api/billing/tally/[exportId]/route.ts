import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";
import { fileResponse } from "@/lib/bill-files";
import { tallyFileName, tallyTypesFor } from "@/lib/tally";

// GET /api/billing/tally/:exportId – the same XML file again, e.g. to repeat a failed import
export async function GET(_request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getBillingAccess(user.id);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tallyExport = await prisma.tallyExport.findUnique({ where: { id: (await params).exportId } });
  if (!tallyExport || !tallyTypesFor(access).includes(tallyExport.type)) {
    return NextResponse.json({ error: "Export not found" }, { status: 404 });
  }
  return fileResponse(Buffer.from(tallyExport.xml, "utf8"), "xml", tallyFileName(tallyExport.type, tallyExport.createdAt));
}
