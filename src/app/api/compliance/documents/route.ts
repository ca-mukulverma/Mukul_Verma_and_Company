import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWorkOn, completeIfReady, DOC_KIND_LABELS, logEvent } from "@/lib/compliance";
import { loadSheetItem } from "@/lib/compliance-sheet";
import { badRequest, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { objectSize } from "@/lib/r2";
import { checkUploadAllowed, storageKey, uploadSchema } from "@/lib/compliance-schemas";

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

  const existing = await prisma.complianceDocument.findFirst({
    where: { clientId: data.clientId, itemId: data.itemId ?? null, sha256: data.sha256, kind: data.kind },
    select: { id: true },
  });
  if (!existing) {
    await prisma.complianceDocument.create({
      data: {
        clientId: data.clientId,
        itemId: data.itemId ?? null,
        kind: data.kind,
        fileName: data.fileName,
        contentType: data.contentType,
        storageKey: key,
        sha256: data.sha256,
        size,
        gzipped: data.gzipped,
        uploadedById: access.userId,
      },
    });
    if (data.itemId) {
      await logEvent(prisma, data.itemId, "document_added", access.userId, `${DOC_KIND_LABELS[data.kind]}: ${data.fileName}`);
      await completeIfReady(data.itemId, access.userId);
    }
  }

  return NextResponse.json({ item: data.itemId ? await loadSheetItem(data.itemId, access) : null });
}
