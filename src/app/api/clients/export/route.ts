import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fileResponse } from "@/lib/bill-files";
import { buildClientExport, MAX_EXPORT_CLIENTS } from "@/lib/client-export";

// Admins and partners can download client details
async function requireExporter() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" || user?.role === "PARTNER" ? user : null;
}

const FORBIDDEN = { error: "Only administrators and partners can export clients" };

// GET /api/clients/export – every client, briefly, to pick from
export async function GET() {
  if (!(await requireExporter())) return NextResponse.json(FORBIDDEN, { status: 403 });
  const clients = await prisma.client.findMany({
    select: { id: true, contactPerson: true, companyName: true, gstin: true, email: true, phone: true, isGuest: true },
    orderBy: [{ companyName: "asc" }, { contactPerson: "asc" }],
    take: MAX_EXPORT_CLIENTS,
  });
  return NextResponse.json({ clients }, { headers: { "Cache-Control": "no-store" } });
}

const exportSchema = z.object({
  // Leave out for every client
  ids: z.array(z.string().min(1)).min(1).max(MAX_EXPORT_CLIENTS).optional(),
});

// POST /api/clients/export – { ids? } – the clients' details as an Excel file
export async function POST(request: NextRequest) {
  const user = await requireExporter();
  if (!user) return NextResponse.json(FORBIDDEN, { status: 403 });

  const parsed = exportSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Choose the clients to export" }, { status: 400 });

  const ids = parsed.data.ids ?? null;
  const file = await buildClientExport(ids, user.name);
  const stamp = new Date().toISOString().slice(0, 10);
  return fileResponse(file, "xlsx", `Clients-${stamp}.xlsx`);
}
