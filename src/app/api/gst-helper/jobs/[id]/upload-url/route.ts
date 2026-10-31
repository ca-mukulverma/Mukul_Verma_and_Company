import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/compliance-api";
import { storageKey } from "@/lib/compliance-schemas";
import { objectSize, r2Configured, uploadUrl } from "@/lib/r2";
import { helperFileSchema, helperUpload, loadHelperJob, readJson } from "@/lib/gst-helper";

type Params = { params: Promise<{ id: string }> };

// POST /api/gst-helper/jobs/:id/upload-url – where the helper uploads a
// downloaded file (same checks as a staff upload). If the same file is
// already stored, no upload is needed.
export async function POST(request: NextRequest, { params }: Params) {
  const { job, error } = await loadHelperJob(request, (await params).id);
  if (error) return error;
  if (!r2Configured()) return badRequest("Document storage (Cloudflare R2) is not set up yet. See docs/COMPLIANCE.md");
  const parsed = helperFileSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Invalid file");

  const { upload, error: denied } = await helperUpload(job, parsed.data);
  if (denied) return denied;
  await prisma.gstPortalJob.update({ where: { id: job.id }, data: { heartbeatAt: new Date() } });

  const { data } = upload;
  const key = storageKey(data.clientId, data.sha256, data.gzipped);
  if ((await objectSize(key)) !== null) return NextResponse.json({ key, alreadyStored: true });
  return NextResponse.json({ key, alreadyStored: false, url: await uploadUrl(key, data.contentType, data.gzipped) });
}
