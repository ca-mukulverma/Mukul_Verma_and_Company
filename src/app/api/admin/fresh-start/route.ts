import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { compare } from "bcryptjs";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientCache, dashboardCache, taskCache } from "@/lib/cache";
import { backupsConfigured, takeBackup } from "@/lib/neon-backup";
import { clearClientData, clearStoredFiles, freshStartCounts } from "@/lib/fresh-start";

export const maxDuration = 60;

const schema = z.object({
  password: z.string().min(1).max(200),
  clearFiles: z.boolean().default(false),
});

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" ? user : null;
}

// GET /api/admin/fresh-start – what a fresh start would remove (Admin)
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Only Admin can start afresh" }, { status: 403 });
  return NextResponse.json({ counts: await freshStartCounts(), backupsReady: backupsConfigured() });
}

// POST /api/admin/fresh-start – Admin removes all client data after a backup,
// confirmed with their login password (docs/FRESH_START.md)
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Only Admin can start afresh" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Enter your login password" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: admin.id }, select: { password: true, isActive: true } });
  const passwordMatches = user?.isActive && user.password ? await compare(parsed.data.password, user.password) : false;
  if (!passwordMatches) {
    return NextResponse.json({ error: "Incorrect password. Nothing was removed." }, { status: 403 });
  }

  // Never without a backup to go back to
  if (!backupsConfigured()) {
    return NextResponse.json({ error: "Set up backups first (see Backups above). Nothing was removed." }, { status: 400 });
  }
  let backup;
  try {
    backup = await takeBackup(admin.name, "before fresh start");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Neon did not respond";
    return NextResponse.json({ error: `The backup failed, so nothing was removed. ${reason}` }, { status: 502 });
  }

  const counts = await freshStartCounts();
  await clearClientData(admin.id, { ...counts, backup: backup.name, clearFiles: parsed.data.clearFiles });
  const files = parsed.data.clearFiles ? await clearStoredFiles() : null;

  await Promise.all([clientCache, taskCache, dashboardCache].map((cache) => cache.invalidate("*"))).catch(() => undefined);
  return NextResponse.json({ removed: counts, backup, files });
}
