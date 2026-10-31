import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/compliance-api";
import { recordComplianceUpload } from "@/lib/compliance-upload";
import { helperFileSchema, helperUpload, loadHelperJob, readJson } from "@/lib/gst-helper";
import { appendLog, FORMAT_LABELS, portalMonthLabel, RETURN_LABELS } from "@/lib/gst-portal";

type Params = { params: Promise<{ id: string }> };

// POST /api/gst-helper/jobs/:id/document – records a file the helper
// uploaded, exactly as a staff upload (a filed return's PDF marks the period
// filed).
export async function POST(request: NextRequest, { params }: Params) {
  const { job, error } = await loadHelperJob(request, (await params).id);
  if (error) return error;
  const parsed = helperFileSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Invalid file");
  const file = parsed.data;

  const { upload, error: denied } = await helperUpload(job, file);
  if (denied) return denied;
  const recorded = await recordComplianceUpload(upload.access, upload.data);
  if (!recorded) return badRequest("The upload did not finish. Try again");

  const label = `${RETURN_LABELS[file.returnType]} ${portalMonthLabel(file.month)} ${FORMAT_LABELS[file.format]}`;
  const notes = [
    !recorded.created && "already saved",
    !upload.periodFound && `kept with the client (no ${file.returnType === "GSTR1" ? "GSTR-1" : "GSTR-3B"} period for this month)`,
    recorded.filed && recorded.filed.charAt(0).toLowerCase() + recorded.filed.slice(1),
  ].filter(Boolean);
  const line = `Saved ${label}${notes.length ? ` – ${notes.join("; ")}` : ""}`;

  const current = await prisma.gstPortalJob.findUniqueOrThrow({ where: { id: job.id }, select: { log: true } });
  await prisma.gstPortalJob.update({
    where: { id: job.id },
    data: { filesSaved: { increment: 1 }, heartbeatAt: new Date(), progress: line.slice(0, 200), log: appendLog(current.log, [line]) as object[] },
  });
  return NextResponse.json({ created: recorded.created, filed: recorded.filed, itemId: upload.data.itemId ?? null });
}
