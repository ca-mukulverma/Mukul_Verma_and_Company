import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/compliance-api";
import { loadHelperJob, readJson } from "@/lib/gst-helper";
import { appendLog } from "@/lib/gst-portal";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  status: z.enum(["DONE", "PARTLY_DONE", "FAILED"]),
  error: z.string().trim().max(2000).optional().nullable(),
  log: z.array(z.string().max(500)).max(40).optional(),
});

const DONE_TEXT = { DONE: "Done", PARTLY_DONE: "Partly done", FAILED: "Failed" } as const;

// POST /api/gst-helper/jobs/:id/finish – the helper has logged out
export async function POST(request: NextRequest, { params }: Params) {
  const { job, error } = await loadHelperJob(request, (await params).id);
  if (error) return error;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Invalid data");
  const d = parsed.data;
  const now = new Date();
  await prisma.gstPortalJob.update({
    where: { id: job.id },
    data: {
      status: d.status,
      error: d.error || null,
      finishedAt: now,
      heartbeatAt: now,
      progress: DONE_TEXT[d.status],
      log: appendLog(job.log, d.log ?? [], now) as object[],
    },
  });
  return NextResponse.json({ ok: true });
}
