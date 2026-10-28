import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWorkOn, DOC_KIND_LABELS, logEvent } from "@/lib/compliance";
import { loadSheetItem } from "@/lib/compliance-sheet";
import { badRequest, forbidden, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { checkUploadAllowed, gstReadSchema } from "@/lib/compliance-schemas";
import { parseMonthKey } from "@/lib/compliance-periods";
import { z } from "zod";
import { deleteObject, downloadUrl, r2Configured } from "@/lib/r2";
import { fileFromUpload, placementOf, syncItemFigures } from "@/lib/gst-working";
import { GstRead } from "@/lib/gst-read/types";

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
    include: { item: { select: { id: true, status: true, workTypeId: true, historical: true } } },
  });
  if (!doc) return notFound("File not found");
  if (doc.item) {
    if (!canWorkOn(access, doc.item.workTypeId)) return forbidden();
    if (doc.item.status === "completed" && !doc.item.historical) {
      return badRequest("This period is completed. Reopen it before removing its files");
    }
  } else if (!access.isManager && doc.uploadedById !== access.userId) {
    return forbidden("Only Admins, Partners or the person who added the file can remove it");
  }

  await prisma.complianceDocument.delete({ where: { id } });
  if (doc.item) await logEvent(prisma, doc.item.id, "document_removed", access.userId, `${DOC_KIND_LABELS[doc.kind]}: ${doc.fileName}`);
  if (doc.item && doc.gst) await syncItemFigures(doc.item.id);
  // The stored file is shared by documents with the same content
  const stillUsed = await prisma.complianceDocument.count({ where: { storageKey: doc.storageKey } });
  if (stillUsed === 0 && r2Configured()) {
    await deleteObject(doc.storageKey).catch((e) => console.error("Failed to delete stored file:", e));
  }
  return NextResponse.json({ item: doc.item ? await loadSheetItem(doc.item.id, access) : null });
}

// PATCH /api/compliance/documents/[id] – figures read from a GST return
// uploaded before the app read them (GST working → Read earlier files)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const body = parseBody(z.object({ gst: gstReadSchema }), await request.json());
  if (body.error) return body.error;
  const doc = await prisma.complianceDocument.findUnique({ where: { id } });
  if (!doc || !doc.itemId) return notFound("File not found");
  const gst = body.data.gst as unknown as GstRead;
  const denied = await checkUploadAllowed(
    access,
    { clientId: doc.clientId, itemId: doc.itemId, kind: doc.kind, fileName: doc.fileName, contentType: doc.contentType, size: doc.size, sha256: doc.sha256, gzipped: doc.gzipped, gst: body.data.gst },
    (workTypeId) => canWorkOn(access, workTypeId)
  );
  if (denied) return denied;
  await prisma.complianceDocument.update({
    where: { id },
    data: { gst: gst as object, gstMonth: parseMonthKey(gst.month), kind: placementOf(gst).kind },
  });
  await syncItemFigures(doc.itemId);
  const filed = await fileFromUpload(doc.itemId, gst, access);
  return NextResponse.json({ ok: true, filed });
}
