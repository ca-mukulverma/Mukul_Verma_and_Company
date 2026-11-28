import { gunzipSync } from "zlib";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deskFromRequest } from "@/lib/desk";
import { siteOrigin } from "@/lib/desk-links";
import { r2Configured, readObject } from "@/lib/r2";

export const dynamic = "force-dynamic";

// GET /api/desk/gst2b            – the GSTR-2B JSON files kept for this client in the portal (Compliance), newest first:
//                                  { files: [{id, month: "YYYY-MM", fileName, uploadedAt}], page }
// GET /api/desk/gst2b?id=<file>  – that file's JSON (unzipped)
// Only when staff click "Get 2B from MV Company app" in the Desk, so a database read here is fine.
export async function GET(request: NextRequest) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  const desk = await prisma.deskClient.findUnique({ where: { id: who.id }, select: { clientId: true } });
  if (!desk?.clientId) {
    return NextResponse.json(
      { error: "This Desk is not linked to its client in the portal yet. MVC: Control Centre → Clients → link it." },
      { status: 409 }
    );
  }
  const page = `${siteOrigin(request)}/dashboard/clients/${desk.clientId}`;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    const docs = await prisma.complianceDocument.findMany({
      where: { clientId: desk.clientId, kind: "GSTR2B_JSON" },
      orderBy: [{ gstMonth: "desc" }, { createdAt: "desc" }],
      take: 60,
      select: { id: true, fileName: true, gstMonth: true, createdAt: true },
    });
    return NextResponse.json({
      page,
      files: docs.map((d) => ({
        id: d.id,
        month: d.gstMonth ? d.gstMonth.toISOString().slice(0, 7) : null,
        fileName: d.fileName,
        uploadedAt: d.createdAt.toISOString(),
      })),
    });
  }
  const doc = await prisma.complianceDocument.findFirst({
    where: { id, clientId: desk.clientId, kind: "GSTR2B_JSON" },
    select: { storageKey: true, gzipped: true, fileName: true },
  });
  if (!doc) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (!r2Configured()) return NextResponse.json({ error: "Document storage is not set up" }, { status: 503 });
  let bytes = await readObject(doc.storageKey);
  if (doc.gzipped || (bytes[0] === 0x1f && bytes[1] === 0x8b)) bytes = gunzipSync(bytes);
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${doc.fileName.replace(/"/g, "")}"`, "cache-control": "private, no-store" },
  });
}
