import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { backupsConfigured, deleteBackup, listBackups, takeBackup } from "@/lib/neon-backup";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" ? user : null;
}

const failed = (error: unknown) =>
  NextResponse.json({ error: error instanceof Error ? error.message : "Neon did not respond. Try again in a while" }, { status: 502 });

// GET /api/admin/backups – the database backups in Neon (Admin)
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Only Admin can see backups" }, { status: 403 });
  if (!backupsConfigured()) return NextResponse.json({ configured: false, backups: [] });
  try {
    return NextResponse.json({ configured: true, backups: await listBackups() });
  } catch (error) {
    return failed(error);
  }
}

// POST /api/admin/backups – takes a backup now (Admin)
export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Only Admin can take backups" }, { status: 403 });
  try {
    return NextResponse.json({ backup: await takeBackup(admin.name) }, { status: 201 });
  } catch (error) {
    return failed(error);
  }
}

// DELETE /api/admin/backups?id=snap-… – removes an old backup (Admin)
export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Only Admin can delete backups" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^snap-[a-z0-9-]+$/.test(id)) return NextResponse.json({ error: "Choose a backup" }, { status: 400 });
  try {
    await deleteBackup(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failed(error);
  }
}
