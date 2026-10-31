import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn, ComplianceAccess, getComplianceAccess } from "@/lib/compliance";
import { badRequest, monthString } from "@/lib/compliance-api";
import { checkUploadAllowed, gstReadSchema, MAX_DOCUMENT_BYTES, uploadSchema } from "@/lib/compliance-schemas";
import { parseMonthKey } from "@/lib/compliance-periods";
import { placementOf } from "@/lib/gst-working";
import { GstRead } from "@/lib/gst-read/types";
import { GST_PORTAL_FORMATS, GST_PORTAL_RETURNS, HELPER_STATUSES } from "@/lib/gst-portal";

// Shared bits of the /api/gst-helper routes, called by the helper program on
// the office PC (helper/, docs/GST_PORTAL_DOWNLOADS.md). The helper has no
// staff session: it sends GST_HELPER_KEY, and files are saved as the staff
// member who queued the job, with that person's permissions.

const MIN_KEY_LENGTH = 32;

const digest = (value: string) => createHash("sha256").update(value).digest();

// null when the request carries the right key
export function helperKeyError(request: NextRequest): NextResponse | null {
  const key = process.env.GST_HELPER_KEY;
  if (!key || key.length < MIN_KEY_LENGTH) {
    return NextResponse.json({ error: "The GST helper is not set up on the server (GST_HELPER_KEY)" }, { status: 503 });
  }
  const given = request.headers.get("x-gst-helper-key") ?? "";
  if (!timingSafeEqual(digest(given), digest(key))) {
    return NextResponse.json({ error: "Wrong helper key" }, { status: 401 });
  }
  return null;
}

const jobSelect = {
  id: true,
  clientId: true,
  status: true,
  log: true,
  requestedById: true,
} as const;

export type HelperJob = { id: string; clientId: string; status: string; log: unknown; requestedById: string | null };

// The job, if the helper is working on it. A cancelled or finished job is
// refused with 409 ({ cancelled: true } when staff cancelled it), so the
// helper stops.
export async function loadHelperJob(
  request: NextRequest,
  id: string
): Promise<{ job: HelperJob; error?: never } | { job?: never; error: NextResponse }> {
  const keyError = helperKeyError(request);
  if (keyError) return { error: keyError };
  const job = await prisma.gstPortalJob.findUnique({ where: { id }, select: jobSelect });
  if (!job) return { error: NextResponse.json({ error: "Job not found" }, { status: 404 }) };
  if (job.status === "CANCELLED") {
    return { error: NextResponse.json({ error: "Cancelled by staff", cancelled: true }, { status: 409 }) };
  }
  if (!(HELPER_STATUSES as readonly string[]).includes(job.status)) {
    const state = job.status === "QUEUED" ? "is queued again, not running" : "has finished";
    return { error: NextResponse.json({ error: `The job ${state}` }, { status: 409 }) };
  }
  return { job };
}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// A file the helper downloaded from the portal
export const helperFileSchema = z.object({
  returnType: z.enum(GST_PORTAL_RETURNS),
  month: monthString,
  format: z.enum(GST_PORTAL_FORMATS),
  fileName: z.string().trim().min(1).max(150),
  contentType: z.string().min(1).max(100),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES, "The file is larger than 15 MB"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  gzipped: z.boolean(),
  // Figures read from the file by the helper (lib/gst-read), if it is a return it reads
  gst: gstReadSchema.optional().nullable(),
});
export type HelperFile = z.infer<typeof helperFileSchema>;

function kindOf(file: HelperFile): z.infer<typeof uploadSchema>["kind"] {
  if (file.format === "EXCEL") return "OTHER";
  if (file.returnType === "GSTR2B") return file.format === "JSON" ? "GSTR2B_JSON" : "OTHER";
  return file.format === "PDF" ? "RETURN_PDF" : "RETURN_JSON";
}

export interface HelperUpload {
  access: ComplianceAccess;
  data: z.infer<typeof uploadSchema>;
  // The period the file went to; null: kept with the client
  periodFound: boolean;
}

// Turns the helper's file into the same upload a staff member would make:
// the client's GSTR-1 or GSTR-3B period that holds the month (GSTR-2B goes
// with GSTR-3B), checked with the queuing staff member's permissions.
export async function helperUpload(
  job: HelperJob,
  file: HelperFile
): Promise<{ upload: HelperUpload; error?: never } | { upload?: never; error: NextResponse }> {
  if (!job.requestedById) return { error: badRequest("The staff member who queued this job no longer exists") };
  const access = await getComplianceAccess(job.requestedById);
  if (!access) return { error: NextResponse.json({ error: "The staff member who queued this job can no longer use Compliance" }, { status: 403 }) };

  const gst = (file.gst ?? null) as GstRead | null;
  const work = gst ? placementOf(gst).work : file.returnType === "GSTR1" ? "GSTR1" : "GSTR3B";
  const month = parseMonthKey(gst ? gst.month : file.month)!;
  const item = await prisma.complianceItem.findFirst({
    where: { clientId: job.clientId, workType: { kind: work }, periodStart: { lte: month }, periodEnd: { gte: month } },
    orderBy: { periodStart: "desc" },
    select: { id: true },
  });

  const parsed = uploadSchema.safeParse({
    clientId: job.clientId,
    itemId: item?.id ?? null,
    kind: kindOf(file),
    fileName: file.fileName,
    contentType: file.contentType,
    size: file.size,
    sha256: file.sha256,
    gzipped: file.gzipped,
    // Without a period the file is kept with the client, without figures
    gst: item ? file.gst ?? null : null,
  });
  if (!parsed.success) return { error: badRequest(parsed.error.errors[0]?.message || "Invalid file") };
  const denied = await checkUploadAllowed(access, parsed.data, (workTypeId) => canWorkOn(access, workTypeId));
  if (denied) return { error: denied };
  return { upload: { access, data: parsed.data, periodFound: !!item } };
}
