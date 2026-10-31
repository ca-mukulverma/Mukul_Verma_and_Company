import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, monthString, notFound } from "@/lib/compliance-api";
import { loadHelperJob, readJson } from "@/lib/gst-helper";
import { GST_PORTAL_RETURNS } from "@/lib/gst-portal";

type Params = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), returnType: z.enum(GST_PORTAL_RETURNS), month: monthString }),
  z.object({
    action: z.literal("update"),
    requestId: z.string().min(1),
    status: z.enum(["REQUESTED", "DOWNLOADED", "EXPIRED", "FAILED"]),
    parts: z.number().int().min(0).max(100).optional().nullable(),
  }),
]);

// POST /api/gst-helper/jobs/:id/json-requests – the helper clicked "Generate
// JSON" (create), or collected / gave up on a request (update). Requests not
// collected stay REQUESTED for the client's next job.
export async function POST(request: NextRequest, { params }: Params) {
  const { job, error } = await loadHelperJob(request, (await params).id);
  if (error) return error;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Invalid data");
  const d = parsed.data;
  await prisma.gstPortalJob.update({ where: { id: job.id }, data: { heartbeatAt: new Date() } });

  if (d.action === "create") {
    const created = await prisma.gstJsonRequest.create({
      data: { clientId: job.clientId, jobId: job.id, returnType: d.returnType, month: d.month },
      select: { id: true, returnType: true, month: true, requestedAt: true, status: true },
    });
    return NextResponse.json({ request: created });
  }

  const existing = await prisma.gstJsonRequest.findUnique({ where: { id: d.requestId }, select: { clientId: true } });
  if (!existing || existing.clientId !== job.clientId) return notFound("JSON request not found");
  const updated = await prisma.gstJsonRequest.update({
    where: { id: d.requestId },
    data: {
      status: d.status,
      jobId: job.id,
      ...(d.parts !== undefined && { parts: d.parts }),
      downloadedAt: d.status === "DOWNLOADED" ? new Date() : null,
    },
    select: { id: true, returnType: true, month: true, requestedAt: true, status: true, parts: true },
  });
  return NextResponse.json({ request: updated });
}
