import { NextRequest, NextResponse } from "next/server";
import { canWorkOn } from "@/lib/compliance";
import { badRequest, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { checkUploadAllowed, storageKey, uploadSchema } from "@/lib/compliance-schemas";
import { objectSize, r2Configured, uploadUrl } from "@/lib/r2";

// POST /api/compliance/documents/upload-url – where the browser uploads the
// file. If the same file is already stored, no upload is needed.
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  if (!r2Configured()) return badRequest("Document storage (Cloudflare R2) is not set up yet. See docs/COMPLIANCE.md");

  const body = parseBody(uploadSchema, await request.json());
  if (body.error) return body.error;
  const data = body.data;
  const denied = await checkUploadAllowed(access, data, (workTypeId) => canWorkOn(access, workTypeId));
  if (denied) return denied;

  const key = storageKey(data.clientId, data.sha256, data.gzipped);
  if ((await objectSize(key)) !== null) return NextResponse.json({ key, alreadyStored: true });
  return NextResponse.json({ key, alreadyStored: false, url: await uploadUrl(key, data.contentType, data.gzipped) });
}
