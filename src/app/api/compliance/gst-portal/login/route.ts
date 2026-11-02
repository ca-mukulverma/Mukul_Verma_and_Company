import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notFound, parseBody, requireComplianceAccess, badRequest } from "@/lib/compliance-api";
import { isGstPortalLogin } from "@/lib/gst-portal";
import { activePortalSettings } from "@/lib/gst-portal-settings";

// POST /api/compliance/gst-portal/login { clientId } – what the GST extension
// needs to open the portal for a client: the active portal settings and the
// client's GST login (the first credential with "GST" in its title, not the
// e-way bill / e-invoice one). Asked for only when staff click, passed
// straight to the extension, which fills the fields and keeps nothing.
// docs/GST_PORTAL_EXTENSION_PLAN.md §11.

const schema = z.object({ clientId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json().catch(() => null));
  if (body.error) return body.error;
  const client = await prisma.client.findUnique({
    where: { id: body.data.clientId },
    select: { gstin: true, credentials: { orderBy: { createdAt: "asc" }, select: { title: true, username: true, password: true } } },
  });
  if (!client) return notFound("Client not found");
  if (!client.gstin?.trim()) return badRequest("Save this client's GSTIN first");
  const login = client.credentials.find((c) => isGstPortalLogin(c.title));
  return NextResponse.json(
    { settings: activePortalSettings(), login: login ? { username: login.username, password: login.password } : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
