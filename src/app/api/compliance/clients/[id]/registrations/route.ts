import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { partyName } from "@/lib/compliance";
import { canSetTallyLedger } from "@/lib/connectors";
import { GSTIN_PATTERN, gstState, panOfGstin } from "@/lib/gst-states";
import { badRequest, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

// A party registered for GST in several states: each other state's GSTIN is
// its own client record under the party's main one, so its returns, periods,
// GST working and bills stay with that GSTIN. The owner's contacts and the
// connector are copied from the main record; the address and TAN are not.

const schema = z.object({
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_PATTERN, "Check the GSTIN: it should look like 27AAACM1234A1Z5"),
});

// POST /api/compliance/clients/[id]/registrations – adds another state's GSTIN
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess({ manager: true });
  if (error) return error;
  const { id } = await params;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { gstin } = body.data;

  const client = await prisma.client.findUnique({ where: { id }, select: { id: true, parentClientId: true } });
  if (!client) return notFound("Client not found");
  const main = await prisma.client.findUnique({ where: { id: client.parentClientId ?? client.id } });
  if (!main) return notFound("Client not found");
  if (!main.gstin) return badRequest("Save the party's own GSTIN first (Edit client), then add the other states");

  const pan = main.pan ?? panOfGstin(main.gstin);
  if (pan && panOfGstin(gstin) !== pan) {
    return badRequest(`GSTIN ${gstin} has PAN ${panOfGstin(gstin)}, not this party's (${pan}): add it as a separate client`);
  }
  const taken = await prisma.client.findFirst({
    where: { gstin: { equals: gstin, mode: "insensitive" } },
    select: { contactPerson: true, companyName: true },
  });
  if (taken) return badRequest(`GSTIN ${gstin} is already saved for ${partyName(taken)}`);

  const mayLedger = await canSetTallyLedger(access.userId);
  const created = await prisma.client.create({
    data: {
      parentClientId: main.id,
      gstin,
      pan,
      contactPerson: main.contactPerson,
      companyName: main.companyName,
      email: main.email,
      phone: main.phone,
      phones: main.phones ?? Prisma.DbNull,
      ownerIsResponsible: main.ownerIsResponsible,
      responsibleName: main.responsibleName,
      responsiblePhone: main.responsiblePhone,
      responsibleEmail: main.responsibleEmail,
      connectorId: main.connectorId,
      tallyLedgerPending: !mayLedger && !main.connectorId,
      managerId: main.managerId,
      notes: `${gstState(gstin)} GST registration of ${partyName(main)}`,
    },
    select: { id: true },
  });
  await prisma.activity.create({
    data: { type: "client", action: "created", target: `${partyName(main)} – ${gstState(gstin)} (${gstin})`, userId: access.userId },
  });
  return NextResponse.json({ id: created.id, state: gstState(gstin) }, { status: 201 });
}
