import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { partyName } from "@/lib/compliance";
import { parseBody, requireComplianceAccess } from "@/lib/compliance-api";

const schema = z.object({
  gstins: z.array(z.string().trim().toUpperCase().regex(/^\d{2}[A-Z0-9]{13}$/)).max(2000).default([]),
  tans: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{4}\d{5}[A-Z]$/)).max(2000).default([]),
});

// POST /api/compliance/clients/lookup – the clients with these GSTINs / TANs
// (Upload returns for all clients sorts files by the GSTIN or TAN in them)
export async function POST(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { gstins, tans } = body.data;
  if (gstins.length === 0 && tans.length === 0) return NextResponse.json({ clients: [] });

  const clients = await prisma.client.findMany({
    where: {
      isGuest: false,
      OR: [
        ...(gstins.length ? [{ gstin: { in: gstins, mode: "insensitive" as const } }] : []),
        ...(tans.length ? [{ tan: { in: tans, mode: "insensitive" as const } }] : []),
      ],
    },
    select: {
      id: true,
      contactPerson: true,
      companyName: true,
      gstin: true,
      tan: true,
      complianceSubscriptions: { where: { active: true }, select: { workTypeId: true } },
    },
  });
  return NextResponse.json({
    clients: clients.map((c) => ({
      id: c.id,
      name: partyName(c),
      gstin: c.gstin?.toUpperCase() ?? null,
      tan: c.tan?.toUpperCase() ?? null,
      subscribed: c.complianceSubscriptions.map((s) => s.workTypeId),
    })),
  });
}
