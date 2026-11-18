import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bad, onlyAdmin, requireDeskAdmin } from "@/lib/desk-admin";
import { deleteSupportFile, readSupportFile, supportDownloadLink } from "@/lib/desk-updates";

export const dynamic = "force-dynamic";

// GET /api/admin/desk/support – support files sent by clients' PCs (newest first)
// GET /api/admin/desk/support?id=… – download one
export async function GET(request: NextRequest) {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const f = await prisma.deskSupportFile.findUnique({ where: { id }, include: { deskClient: { select: { code: true } } } });
    if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const name = `${f.deskClient.code}_${f.fileName}`;
    const link = await supportDownloadLink(f.storageKey, name);
    if (link) return NextResponse.redirect(link, 302);
    const bytes = await readSupportFile(f.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${name.replace(/["\\r\n]/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  }
  const files = await prisma.deskSupportFile.findMany({
    orderBy: { receivedAt: "desc" },
    take: 200,
    select: {
      id: true, fileName: true, size: true, note: true, appVersion: true, receivedAt: true,
      deskClient: { select: { code: true, name: true } },
    },
  });
  return NextResponse.json({ files });
}

// DELETE /api/admin/desk/support?id=… – remove the file for good
export async function DELETE(request: NextRequest) {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const f = await prisma.deskSupportFile.findUnique({ where: { id } });
  if (!f) return bad("Choose a file");
  await deleteSupportFile(f.storageKey);
  await prisma.deskSupportFile.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
