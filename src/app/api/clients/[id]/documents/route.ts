import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, requireComplianceAccess } from "@/lib/compliance-api";
import { clientDocLabel } from "@/lib/client-documents";
import { r2Configured } from "@/lib/r2";

// GET /api/clients/[id]/documents – the client's own documents (registrations
// and yearly papers), not the files of compliance periods. Files are added,
// opened and removed through /api/compliance/documents.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) return notFound("Client not found");

  const docs = await prisma.complianceDocument.findMany({
    where: { clientId: id, itemId: null },
    include: { uploadedBy: { select: { name: true } } },
    orderBy: [{ financialYear: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({
    storageReady: r2Configured(),
    documents: docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      financialYear: d.financialYear,
      label: d.docType ? clientDocLabel(d) : d.fileName,
      fileName: d.fileName,
      size: d.size,
      uploadedBy: d.uploadedBy?.name ?? null,
      createdAt: d.createdAt,
      // Admins and Partners, or whoever added it
      canDelete: access.isManager || d.uploadedById === access.userId,
    })),
  });
}
