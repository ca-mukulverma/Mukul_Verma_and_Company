import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn } from "@/lib/compliance";
import { parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { fileFromStoredReturns } from "@/lib/gst-working";

const schema = z.object({ clientIds: z.array(z.string().min(1)).min(1).max(500) });

// POST /api/compliance/gst-working/file – after many returns are uploaded:
// marks the clients' open GST periods filed from their uploaded return PDFs,
// oldest first (only for works the user is on the team of)
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const works = await prisma.complianceWorkType.findMany({ where: { kind: { in: ["GSTR1", "GSTR3B"] } }, select: { id: true } });
  if (!works.every((w) => canWorkOn(access, w.id))) return NextResponse.json({ filed: 0 });
  return NextResponse.json({ filed: await fileFromStoredReturns(body.data.clientIds, access) });
}
