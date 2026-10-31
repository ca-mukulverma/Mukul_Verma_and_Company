import { NextRequest, NextResponse } from "next/server";
import { canWorkOn } from "@/lib/compliance";
import { loadSheetItem } from "@/lib/compliance-sheet";
import { badRequest, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { checkUploadAllowed, uploadSchema } from "@/lib/compliance-schemas";
import { recordComplianceUpload } from "@/lib/compliance-upload";

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

  const recorded = await recordComplianceUpload(access, data);
  if (!recorded) return badRequest("The upload did not finish. Try again");
  return NextResponse.json({ item: data.itemId ? await loadSheetItem(data.itemId, access) : null, filed: recorded.filed });
}
