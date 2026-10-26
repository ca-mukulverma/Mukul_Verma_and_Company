import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWorkOn, DOC_KIND_LABELS, logEvent } from "@/lib/compliance";
import { loadSheetItem } from "@/lib/compliance-sheet";
import { badRequest, forbidden, notFound, requireComplianceAccess } from "@/lib/compliance-api";
import { deleteObject, downloadUrl, r2Configured } from "@/lib/r2";

// GET /api/compliance/documents/[id] – opens a short-lived download link
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const doc = await prisma.complianceDocument.findUnique({ where: { id } });
  if (!doc) return notFound("File not found");
  if (!r2Configured()) return badRequest("Document storage (Cloudflare R2) is not set up yet");
  return NextResponse.redirect(await downloadUrl(doc.storageKey, doc.fileName));
}

// DELETE /api/compliance/documents/[id]
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const doc = await prisma.complianceDocument.findUnique({
    where: { id },
    include: { item: { select: { id: true, status: true, workTypeId: true } } },
  });
  if (!doc) return notFound("File not found");
  if (doc.item) {
    if (!canWorkOn(access, doc.item.workTypeId)) return forbidden();
    if (doc.item.status === "completed") return badRequest("This period is completed. Reopen it before removing its files");
  } else if (!access.isManager && doc.uploadedById !== access.userId) {
    return forbidden("Only Admins, Partners or the person who added the file can remove it");
  }

  await prisma.complianceDocument.delete({ where: { id } });
  if (doc.item) await logEvent(prisma, doc.item.id, "document_removed", access.userId, `${DOC_KIND_LABELS[doc.kind]}: ${doc.fileName}`);
  // The stored file is shared by documents with the same content
  const stillUsed = await prisma.complianceDocument.count({ where: { storageKey: doc.storageKey } });
  if (stillUsed === 0 && r2Configured()) {
    await deleteObject(doc.storageKey).catch((e) => console.error("Failed to delete stored file:", e));
  }
  return NextResponse.json({ item: doc.item ? await loadSheetItem(doc.item.id, access) : null });
}
