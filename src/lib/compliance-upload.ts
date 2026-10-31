import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ComplianceAccess, completeIfReady, DOC_KIND_LABELS, logEvent, partyName } from "@/lib/compliance";
import { objectSize } from "@/lib/r2";
import { storageKey, uploadSchema } from "@/lib/compliance-schemas";
import { clientDocType } from "@/lib/client-documents";
import { fileFromUpload, placementOf, syncItemFigures } from "@/lib/gst-working";
import { GstRead } from "@/lib/gst-read/types";
import { parseMonthKey } from "@/lib/compliance-periods";
import { standardFileName, uniqueFileName } from "@/lib/document-names";

// Records a file that is already in R2 as a ComplianceDocument, exactly as a
// staff upload does: standard name, history event, completion, the period's
// GST figures, and a filed return's PDF marking the period filed. Used by
// POST /api/compliance/documents.
// The caller has already run checkUploadAllowed.
// null: the object isn't in R2 (the upload didn't finish).
export async function recordComplianceUpload(
  access: ComplianceAccess,
  data: z.infer<typeof uploadSchema>
): Promise<{ created: boolean; filed: string | null } | null> {
  const key = storageKey(data.clientId, data.sha256, data.gzipped);
  const size = await objectSize(key);
  if (size === null) return null;

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
    // Saved under the standard name, not the name on the uploader's computer
    const [client, item, sameItemNames] = await Promise.all([
      prisma.client.findUnique({ where: { id: data.clientId }, select: { contactPerson: true, companyName: true } }),
      data.itemId
        ? prisma.complianceItem.findUnique({
            where: { id: data.itemId },
            select: { frequency: true, periodStart: true, workType: { select: { name: true } } },
          })
        : null,
      prisma.complianceDocument.findMany({
        where: { clientId: data.clientId, itemId: data.itemId ?? null, docType, financialYear },
        select: { fileName: true },
      }),
    ]);
    const fileName = uniqueFileName(
      standardFileName({
        party: client ? partyName(client) : "",
        originalName: data.fileName,
        kind,
        item: item && { workName: item.workType.name, frequency: item.frequency, periodStart: item.periodStart },
        docTypeLabel: clientDocType(docType)?.label,
        financialYear,
      }),
      sameItemNames.map((d) => d.fileName)
    );
    await prisma.complianceDocument.create({
      data: {
        clientId: data.clientId,
        itemId: data.itemId ?? null,
        kind,
        fileName,
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
      await logEvent(prisma, data.itemId, "document_added", access.userId, `${DOC_KIND_LABELS[kind]}: ${fileName}`);
      await completeIfReady(data.itemId, access.userId);
    }
  }

  // The period's figures come from its returns; a filed return's PDF marks it filed
  let filed: string | null = null;
  if (data.itemId && gst) {
    await syncItemFigures(data.itemId);
    filed = await fileFromUpload(data.itemId, gst, access);
  }
  return { created: !existing, filed };
}
