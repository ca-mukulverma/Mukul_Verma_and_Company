import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partyName } from "@/lib/compliance";
import { requireComplianceAccess } from "@/lib/compliance-api";

// GET /api/compliance/clients?search= – clients with the recurring work set up for them
export async function GET(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const search = new URL(request.url).searchParams.get("search")?.trim();

  const clients = await prisma.client.findMany({
    where: {
      isGuest: false,
      ...(search && {
        OR: [
          { contactPerson: { contains: search, mode: "insensitive" } },
          { companyName: { contains: search, mode: "insensitive" } },
          { gstin: { contains: search, mode: "insensitive" } },
        ],
      }),
    },
    select: {
      id: true,
      contactPerson: true,
      companyName: true,
      gstin: true,
      phone: true,
      email: true,
      complianceSubscriptions: { where: { active: true }, select: { workTypeId: true, frequency: true } },
    },
    orderBy: [{ companyName: "asc" }, { contactPerson: "asc" }],
    take: 2000,
  });
  return NextResponse.json({
    clients: clients
      .map((c) => ({
        id: c.id,
        name: partyName(c),
        gstin: c.gstin,
        phone: c.phone,
        email: c.email,
        works: c.complianceSubscriptions,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}
