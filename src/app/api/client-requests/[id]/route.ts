import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { serializeRequestType } from "@/lib/client-dispatch";
import { BUILT_IN_REQUESTS, requestTypeSchema } from "@/lib/client-requests";

const patchSchema = requestTypeSchema.partial().extend({
  // Built-in requests only: back to how the app ships it
  reset: z.boolean().optional(),
});

// PATCH /api/client-requests/[id] – Admin edits, switches off or resets a request
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  if (!access.isAdmin) return forbidden("Only Admin can change the requests");
  const { id } = await params;
  const existing = await prisma.clientRequestType.findUnique({ where: { id } });
  if (!existing) return notFound("Request not found");
  const body = parseBody(patchSchema, await request.json());
  if (body.error) return body.error;
  const { reset, ...data } = body.data;

  if (reset) {
    const builtIn = BUILT_IN_REQUESTS.find((r) => r.key === existing.key);
    if (!builtIn) return badRequest("Only built-in requests can be reset");
    const row = await prisma.clientRequestType.update({
      where: { id },
      data: { name: builtIn.name, description: builtIn.description, category: builtIn.category, config: builtIn.config, active: true },
    });
    return NextResponse.json({ request: serializeRequestType(row) });
  }

  const row = await prisma.clientRequestType.update({
    where: { id },
    data: { ...data, ...(data.description !== undefined && { description: data.description || null }) },
  });
  return NextResponse.json({ request: serializeRequestType(row) });
}

// DELETE /api/client-requests/[id] – Admin removes a request they added;
// built-in ones can only be switched off
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  if (!access.isAdmin) return forbidden("Only Admin can change the requests");
  const { id } = await params;
  const existing = await prisma.clientRequestType.findUnique({ where: { id }, select: { key: true } });
  if (!existing) return notFound("Request not found");
  if (existing.key) return badRequest("Built-in requests can be switched off, not removed");
  await prisma.clientRequestType.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
