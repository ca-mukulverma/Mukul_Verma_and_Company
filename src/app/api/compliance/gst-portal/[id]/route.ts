import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { appendLog, UNFINISHED_STATUSES } from "@/lib/gst-portal";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ action: z.enum(["cancel", "retry"]) });

// PATCH /api/compliance/gst-portal/:id – cancel an unfinished job (the helper
// stops at its next step), or run a finished one again as a new job
export async function PATCH(request: NextRequest, { params }: Params) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { id } = await params;
  const job = await prisma.gstPortalJob.findUnique({ where: { id } });
  if (!job) return notFound("Job not found");
  const unfinished = (UNFINISHED_STATUSES as readonly string[]).includes(job.status);

  if (body.data.action === "cancel") {
    if (!unfinished) return badRequest("This job has already finished");
    const { count } = await prisma.gstPortalJob.updateMany({
      where: { id, status: { in: [...UNFINISHED_STATUSES] } },
      data: { status: "CANCELLED", finishedAt: new Date(), progress: null, log: appendLog(job.log, [`Cancelled by ${access.name}`]) as object[] },
    });
    if (!count) return badRequest("This job has already finished");
    return NextResponse.json({ ok: true });
  }

  if (unfinished) return badRequest("This job is still queued or running");
  const other = await prisma.gstPortalJob.findFirst({
    where: { clientId: job.clientId, status: { in: [...UNFINISHED_STATUSES] } },
    select: { id: true },
  });
  if (other) return badRequest("This client already has a job queued or running");
  const created = await prisma.gstPortalJob.create({
    data: { clientId: job.clientId, months: job.months, returns: job.returns, formats: job.formats, requestedById: access.userId },
    select: { id: true },
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
