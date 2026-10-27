import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbidden, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { ensureBuiltInRequests, serializeRequestType } from "@/lib/client-dispatch";
import { requestTypeSchema } from "@/lib/client-requests";

// GET /api/client-requests – the ready-made requests of Send to Client.
// Staff get the active ones they may send (logins are Admin-only); Admin
// with ?all=1 gets every request, for editing.
export async function GET(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  await ensureBuiltInRequests();
  const all = access.isAdmin && request.nextUrl.searchParams.get("all") === "1";
  const rows = await prisma.clientRequestType.findMany({
    where: all ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const requests = rows.map(serializeRequestType).filter((r) => access.isAdmin || !r.adminOnly);
  return NextResponse.json({ requests, isAdmin: access.isAdmin });
}

// POST /api/client-requests – Admin adds a request of their own
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  if (!access.isAdmin) return forbidden("Only Admin can change the requests");
  const body = parseBody(requestTypeSchema, await request.json());
  if (body.error) return body.error;
  const { config, ...rest } = body.data;
  const row = await prisma.clientRequestType.create({
    data: { ...rest, description: rest.description || null, config, sortOrder: rest.sortOrder ?? 1000 },
  });
  return NextResponse.json({ request: serializeRequestType(row) });
}
