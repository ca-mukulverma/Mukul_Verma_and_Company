import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { partyName } from "@/lib/compliance";
import { badRequest } from "@/lib/compliance-api";
import { helperKeyError, readJson } from "@/lib/gst-helper";
import {
  appendLog,
  HELPER_SEEN_KEY,
  HELPER_SEEN_WRITE_MINUTES,
  HELPER_STATUSES,
  isGstPortalLogin,
  STALE_JOB_MINUTES,
} from "@/lib/gst-portal";

const schema = z.object({ helperName: z.string().trim().min(1).max(60) });

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

// POST /api/gst-helper/claim – the helper asks for the next job. Returns
// { job: null }, or the oldest queued job with the client, its GST portal
// login and its GSTR-1 JSON still waiting to be collected. The password is
// sent only here, for the job being started.
export async function POST(request: NextRequest) {
  const keyError = helperKeyError(request);
  if (keyError) return keyError;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest("Send the helper's name");
  const { helperName } = parsed.data;
  const now = new Date();

  // "Helper last seen" for the staff screen, written at most every few minutes
  const seen = await prisma.complianceSetting.findUnique({ where: { key: HELPER_SEEN_KEY } });
  const seenAt = (seen?.value as { at?: string } | null)?.at;
  if (!seenAt || new Date(seenAt) < minutesAgo(HELPER_SEEN_WRITE_MINUTES)) {
    const value = { at: now.toISOString(), name: helperName };
    await prisma.complianceSetting.upsert({ where: { key: HELPER_SEEN_KEY }, create: { key: HELPER_SEEN_KEY, value }, update: { value } });
  }

  // A job with no news for a long time: the helper was closed or crashed
  const stale = await prisma.gstPortalJob.findMany({
    where: { status: { in: [...HELPER_STATUSES] }, heartbeatAt: { lt: minutesAgo(STALE_JOB_MINUTES) } },
    select: { id: true, log: true },
  });
  for (const job of stale) {
    const error = `The helper stopped responding (no news for ${STALE_JOB_MINUTES} minutes)`;
    await prisma.gstPortalJob.updateMany({
      where: { id: job.id, status: { in: [...HELPER_STATUSES] } },
      data: { status: "FAILED", error, finishedAt: now, log: appendLog(job.log, [error], now) as object[] },
    });
  }

  // The oldest queued job; the guarded update makes sure two helpers never take the same one
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await prisma.gstPortalJob.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { id: true, log: true } });
    if (!next) return NextResponse.json({ job: null });
    const { count } = await prisma.gstPortalJob.updateMany({
      where: { id: next.id, status: "QUEUED" },
      data: {
        status: "CLAIMED",
        helperName,
        claimedAt: now,
        heartbeatAt: now,
        progress: "Starting",
        log: appendLog(next.log, [`Taken by ${helperName}`], now) as object[],
      },
    });
    if (count === 0) continue;

    const job = await prisma.gstPortalJob.findUniqueOrThrow({
      where: { id: next.id },
      select: {
        id: true,
        months: true,
        returns: true,
        formats: true,
        client: {
          select: {
            id: true,
            contactPerson: true,
            companyName: true,
            gstin: true,
            credentials: { orderBy: { createdAt: "asc" }, select: { title: true, username: true, password: true } },
            gstJsonRequests: {
              where: { status: "REQUESTED" },
              orderBy: { requestedAt: "asc" },
              select: { id: true, returnType: true, month: true, requestedAt: true },
            },
          },
        },
      },
    });
    const login = job.client.credentials.find((c) => isGstPortalLogin(c.title));
    return NextResponse.json({
      job: {
        id: job.id,
        months: [...job.months].sort(),
        returns: job.returns,
        formats: job.formats,
        client: { id: job.client.id, name: partyName(job.client), gstin: job.client.gstin },
        login: login ? { username: login.username, password: login.password } : null,
        pendingJson: job.client.gstJsonRequests,
      },
    });
  }
  return NextResponse.json({ job: null });
}
