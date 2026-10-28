import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWorkOn, completeIfReady, DOC_KIND_LABELS, logEvent } from "@/lib/compliance";
import { loadSheetItem } from "@/lib/compliance-sheet";
import { badRequest, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { objectSize } from "@/lib/r2";
import { checkUploadAllowed, storageKey, uploadSchema } from "@/lib/compliance-schemas";
import { clientDocType } from "@/lib/client-documents";
import { fileFromUpload, placementOf, syncItemFigures } from "@/lib/gst-working";
import { GstRead } from "@/lib/gst-read/types";
import { parseMonthKey } from "@/lib/compliance-periods";

// POST /api/compliance/documents – records a file after the browser uploaded
// it. Returns the updated item (an attached return may complete it).
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;

  const body = parseBody(uploadSchema, await request.json());
  if (body.error) return body.error;
  const data = body.data;
  const denied = await checkUploadAllowed(access, data, (workTypeId) => canWorkOn(access, workTypeId));
  if (denied) return denied;

  const key = storageKey(data.clientId, data.sha256, data.gzipped);
  const size = await objectSize(key);
  if (size === null) return badRequest("The upload did not finish. Try again");

  // A GST return is kept as its own kind, with the figures read from it
  const gst = (data.gst ?? null) as GstRead | null;
  const kind = gst ? placementOf(gst).kind : data.kind;
  const docType = data.docType ?? null;
  const financialYear = docType && clientDocType(docType)?.yearly ? data.financialYear ?? null : null;
  const existing = await prisma.complianceDocument.findFirst({
    where: { clientId: data.clientId, itemId: data.itemId ?? null, sha256: data.sha256, kind, docType, financialYear },
    select: { id: true, gst: true },
  });
  if (existing && gst && !existing.gst) {
    await prisma.complianceDocument.update({ where: { id: existing.id }, data: { gst: gst as object, gstMonth: parseMonthKey(gst.month) } });
  }
  if (!existing) {
    await prisma.complianceDocument.create({
      data: {
        clientId: data.clientId,
        itemId: data.itemId ?? null,
        kind,
        fileName: data.fileName,
        contentType: data.contentType,
        storageKey: key,
        sha256: data.sha256,
        size,
        gzipped: data.gzipped,
        docType,
        financialYear,
        ...(gst && { gst: gst as object, gstMonth: parseMonthKey(gst.month) }),
        uploadedById: access.userId,
      },
    });
    if (data.itemId) {
      await logEvent(prisma, data.itemId, "document_added", access.userId, `${DOC_KIND_LABELS[kind]}: ${data.fileName}`);
      await completeIfReady(data.itemId, access.userId);
    }
  }

  // The period's figures come from its returns; a filed return's PDF marks it filed
  let filed: string | null = null;
  if (data.itemId && gst) {
    await syncItemFigures(data.itemId);
    filed = await fileFromUpload(data.itemId, gst, access);
  }
  return NextResponse.json({ item: data.itemId ? await loadSheetItem(data.itemId, access) : null, filed });
}
