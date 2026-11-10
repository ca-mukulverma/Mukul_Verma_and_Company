import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notFound, parseBody, requireComplianceAccess, badRequest } from "@/lib/compliance-api";
import { isGstLogin } from "@/lib/gst-portal";
import { activePortalSettings } from "@/lib/gst-portal-settings";
import { partyName } from "@/lib/compliance";
import { gstState } from "@/lib/gst-states";

// POST /api/compliance/gst-portal/login { clientId } – what the GST extension
// needs to open the portal for a client: the active portal settings and the
// client's GST login (the one saved under GST in its Logins, else an "Other"
// login titled for the GST portal, not the e-way bill / e-invoice one). Asked for only when staff click, passed
// straight to the extension, which fills the fields and keeps nothing. Also
// the party's GST registrations (main record first), so the files fetched
// can be saved to the right GSTIN and period on any page.
// docs/GST_PORTAL_EXTENSION_PLAN.md §11.

const schema = z.object({ clientId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json().catch(() => null));
  if (body.error) return body.error;
  const client = await prisma.client.findUnique({
    where: { id: body.data.clientId },
    select: { id: true, gstin: true, parentClientId: true, credentials: { orderBy: { createdAt: "asc" }, select: { kind: true, title: true, username: true, password: true } } },
  });
  if (!client) return notFound("Client not found");
  if (!client.gstin?.trim()) return badRequest("Save this client's GSTIN first");
  const login = client.credentials.find((c) => c.kind === "GST") ?? client.credentials.find(isGstLogin);
  const mainId = client.parentClientId ?? client.id;
  const party = await prisma.client.findMany({
    where: { OR: [{ id: mainId }, { parentClientId: mainId }] },
    select: {
      id: true,
      contactPerson: true,
      companyName: true,
      gstin: true,
      tan: true,
      pan: true,
      complianceSubscriptions: { where: { active: true }, select: { workTypeId: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(
    {
      settings: activePortalSettings(),
      login: login ? { username: login.username, password: login.password } : null,
      party: party
        .sort((a, b) => (a.id === mainId ? -1 : b.id === mainId ? 1 : 0))
        .map((r) => ({
          id: r.id,
          name: partyName(r),
          gstin: r.gstin,
          tan: r.tan,
          pan: r.pan,
          state: gstState(r.gstin),
          subscribed: r.complianceSubscriptions.map((s) => s.workTypeId),
        })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
