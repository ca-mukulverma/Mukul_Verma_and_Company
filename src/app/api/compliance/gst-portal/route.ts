import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { partyName } from "@/lib/compliance";
import { badRequest, monthString, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import {
  GST_PORTAL_FORMATS,
  GST_PORTAL_RETURNS,
  HELPER_SEEN_KEY,
  isGstPortalLogin,
  UNFINISHED_STATUSES,
} from "@/lib/gst-portal";

// GST portal downloads (docs/GST_PORTAL_DOWNLOADS.md): staff queue jobs here;
// the helper program on the office PC runs them.

const JOB_LIST = 40;

// GET /api/compliance/gst-portal – the latest jobs, GSTR-1 JSON waiting to be
// collected and when the helper was last seen. ?clients=1 also lists the
// clients with a GSTIN and whether their GST login is saved.
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const withClients = request.nextUrl.searchParams.get("clients") === "1";

  const clientName = { select: { contactPerson: true, companyName: true, gstin: true } } as const;
  const [jobs, pendingJson, seen, clients] = await Promise.all([
    prisma.gstPortalJob.findMany({
      orderBy: { createdAt: "desc" },
      take: JOB_LIST,
      select: {
        id: true,
        clientId: true,
        months: true,
        returns: true,
        formats: true,
        status: true,
        progress: true,
        log: true,
        filesSaved: true,
        error: true,
        helperName: true,
        createdAt: true,
        finishedAt: true,
        client: clientName,
        requestedBy: { select: { name: true } },
      },
    }),
    prisma.gstJsonRequest.findMany({
      where: { status: "REQUESTED" },
      orderBy: { requestedAt: "asc" },
      select: { id: true, clientId: true, returnType: true, month: true, requestedAt: true, client: clientName },
    }),
    prisma.complianceSetting.findUnique({ where: { key: HELPER_SEEN_KEY } }),
    withClients
      ? prisma.client.findMany({
          where: { gstin: { not: null }, NOT: { gstin: "" }, isGuest: false },
          orderBy: [{ companyName: "asc" }, { contactPerson: "asc" }],
          select: { id: true, contactPerson: true, companyName: true, gstin: true, credentials: { select: { title: true } } },
        })
      : null,
  ]);

  return NextResponse.json({
    jobs: jobs.map(({ client, requestedBy, ...job }) => ({
      ...job,
      months: [...job.months].sort(),
      clientName: partyName(client),
      gstin: client.gstin,
      requestedBy: requestedBy?.name ?? null,
    })),
    pendingJson: pendingJson.map(({ client, ...r }) => ({ ...r, clientName: partyName(client), gstin: client.gstin })),
    helperSeen: (seen?.value as { at: string; name: string } | null) ?? null,
    ...(clients && {
      clients: clients.map((c) => ({
        id: c.id,
        name: partyName(c),
        gstin: c.gstin,
        hasLogin: c.credentials.some((cr) => isGstPortalLogin(cr.title)),
      })),
    }),
  });
}

const queueSchema = z.object({
  clientIds: z.array(z.string().min(1)).min(1, "Choose at least one client").max(50, "Choose at most 50 clients at a time"),
  months: z.array(monthString).min(1, "Choose at least one month").max(24, "Choose at most 24 months"),
  returns: z.array(z.enum(GST_PORTAL_RETURNS)).min(1, "Choose at least one return"),
  formats: z.array(z.enum(GST_PORTAL_FORMATS)).min(1, "Choose at least one file type"),
});

// POST /api/compliance/gst-portal – one job per client
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(queueSchema, await request.json());
  if (body.error) return body.error;
  const d = body.data;
  const clientIds = [...new Set(d.clientIds)];
  const months = [...new Set(d.months)].sort();
  const returns = GST_PORTAL_RETURNS.filter((r) => d.returns.includes(r));
  const formats = GST_PORTAL_FORMATS.filter((f) => d.formats.includes(f));
  // Excel is offered for GSTR-2B only
  if (formats.length === 1 && formats[0] === "EXCEL" && !returns.includes("GSTR2B")) {
    return badRequest("Excel is downloaded for GSTR-2B only: tick GSTR-2B, PDF or JSON");
  }

  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: {
      id: true,
      contactPerson: true,
      companyName: true,
      gstin: true,
      gstPortalJobs: { where: { status: { in: [...UNFINISHED_STATUSES] } }, select: { id: true }, take: 1 },
    },
  });
  if (clients.length !== clientIds.length) return badRequest("A client was not found. Reload and try again");
  const noGstin = clients.filter((c) => !c.gstin?.trim());
  if (noGstin.length) return badRequest(`No GSTIN saved for ${noGstin.map(partyName).join(", ")}`);
  const busy = clients.filter((c) => c.gstPortalJobs.length);
  if (busy.length) return badRequest(`Already queued or running for ${busy.map(partyName).join(", ")}`);

  await prisma.gstPortalJob.createMany({
    data: clientIds.map((clientId) => ({ clientId, months, returns, formats, requestedById: access.userId })),
  });
  return NextResponse.json({ queued: clientIds.length }, { status: 201 });
}
