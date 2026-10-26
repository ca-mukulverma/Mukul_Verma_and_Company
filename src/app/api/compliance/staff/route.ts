import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireComplianceAccess } from "@/lib/compliance-api";

// GET /api/compliance/staff – active staff, for choosing work teams
export async function GET() {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}
