import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { swingPercent } from "@/lib/gst-working";

// GET/PUT /api/compliance/gst-working/settings – how far sales, ITC or credit
// notes may move from the last 3 periods' average before they are flagged
export async function GET() {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  return NextResponse.json({ swingPercent: await swingPercent() });
}

const schema = z.object({ swingPercent: z.number().int().min(5, "At least 5%").max(1000) });

export async function PUT(request: NextRequest) {
  const { error } = await requireComplianceAccess({ manager: true });
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  await prisma.complianceSetting.upsert({
    where: { key: "gstSwingPercent" },
    create: { key: "gstSwingPercent", value: body.data.swingPercent },
    update: { value: body.data.swingPercent },
  });
  return NextResponse.json({ swingPercent: body.data.swingPercent });
}
