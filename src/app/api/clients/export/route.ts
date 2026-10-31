import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fileResponse } from "@/lib/bill-files";
import {
  buildClientExport,
  buildComplianceHistoryExport,
  countComplianceHistory,
  MAX_EXPORT_CLIENTS,
  MAX_HISTORY_ROWS,
} from "@/lib/client-export";

export const maxDuration = 60;

// Admins and partners can download client details
async function requireExporter() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" || user?.role === "PARTNER" ? user : null;
}

const FORBIDDEN = { error: "Only administrators and partners can export clients" };

// GET /api/clients/export – every client, briefly, to pick from
export async function GET() {
  const user = await requireExporter();
  if (!user) return NextResponse.json(FORBIDDEN, { status: 403 });
  const clients = await prisma.client.findMany({
    select: { id: true, contactPerson: true, companyName: true, gstin: true, email: true, phone: true, isGuest: true },
    orderBy: [{ companyName: "asc" }, { contactPerson: "asc" }],
    take: MAX_EXPORT_CLIENTS,
  });
  return NextResponse.json(
    { clients, canExportLogins: user.role === "ADMIN" },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const exportSchema = z.object({
  // Leave out for every client
  ids: z.array(z.string().min(1)).min(1).max(MAX_EXPORT_CLIENTS).optional(),
  // clients: details, compliance setup and payments (to import again);
  // history: every compliance period, as a record
  file: z.enum(["clients", "history"]).default("clients"),
  // Admin only
  includeLogins: z.boolean().default(false),
});

// POST /api/clients/export – { ids?, file?, includeLogins? } – an Excel file
export async function POST(request: NextRequest) {
  const user = await requireExporter();
  if (!user) return NextResponse.json(FORBIDDEN, { status: 403 });

  const parsed = exportSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Choose the clients to export" }, { status: 400 });

  const { file, includeLogins } = parsed.data;
  const ids = parsed.data.ids ?? null;
  const stamp = new Date().toISOString().slice(0, 10);

  if (file === "history") {
    const total = await countComplianceHistory(ids);
    if (total > MAX_HISTORY_ROWS) {
      return NextResponse.json(
        { error: `${total} periods match; one file holds up to ${MAX_HISTORY_ROWS}. Tick fewer clients and download in parts.` },
        { status: 400 }
      );
    }
    const history = await buildComplianceHistoryExport(ids, user.name);
    return fileResponse(history, "xlsx", `Compliance-history-${stamp}.xlsx`);
  }

  if (includeLogins && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only Admin can export logins and passwords" }, { status: 403 });
  }
  const workbook = await buildClientExport(ids, user.name, { includeLogins });
  if (includeLogins) {
    await prisma.activity.create({
      data: {
        type: "client",
        action: "exported",
        target: `logins and passwords of ${ids ? ids.length : "all"} client${ids?.length === 1 ? "" : "s"}`,
        userId: user.id,
      },
    });
  }
  return fileResponse(workbook, "xlsx", `Clients-${stamp}${includeLogins ? "-with-logins" : ""}.xlsx`);
}
