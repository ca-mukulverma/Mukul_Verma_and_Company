import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/compliance-api";
import { loadHelperJob, readJson } from "@/lib/gst-helper";
import { appendLog } from "@/lib/gst-portal";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  status: z.enum(["WAITING_LOGIN", "RUNNING"]).optional(),
  progress: z.string().trim().max(200).optional(),
  log: z.array(z.string().max(500)).max(20).optional(),
});

// POST /api/gst-helper/jobs/:id/status – heartbeat and progress. 409
// { cancelled: true } when staff cancelled the job.
export async function POST(request: NextRequest, { params }: Params) {
  const { job, error } = await loadHelperJob(request, (await params).id);
  if (error) return error;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Invalid data");
  const d = parsed.data;
  await prisma.gstPortalJob.update({
    where: { id: job.id },
    data: {
      heartbeatAt: new Date(),
      ...(d.status && { status: d.status }),
      ...(d.progress !== undefined && { progress: d.progress }),
      ...(d.log?.length && { log: appendLog(job.log, d.log) as object[] }),
    },
  });
  return NextResponse.json({ ok: true });
}
