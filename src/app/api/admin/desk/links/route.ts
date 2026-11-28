import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bad, onlyAdmin, requireDeskAdmin } from "@/lib/desk-admin";
import { createDownloadLink, listDownloadLinks, revokeDownloadLink, siteOrigin, TOKEN_RE } from "@/lib/desk-links";
import { releasesFor } from "@/lib/desk-updates";

export const dynamic = "force-dynamic";

// GET /api/admin/desk/links – personal download links still valid, and the clients a link can be made for
export async function GET(request: NextRequest) {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const origin = siteOrigin(request);
  const desks = await prisma.deskClient.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { code: true, name: true } });
  const latest: Record<string, string | null> = {};
  for (const d of desks) latest[d.code] = (await releasesFor(d.code))[0]?.version ?? null;
  const links = (await listDownloadLinks()).map((l) => ({ ...l, url: `${origin}/get/${l.token}` }));
  return NextResponse.json({ links, desks: desks.map((d) => ({ ...d, latest: latest[d.code] })) });
}

// POST /api/admin/desk/links – { code, person, phone?, days? } -> a link for that one person
export async function POST(request: NextRequest) {
  const admin = await requireDeskAdmin();
  if (!admin) return onlyAdmin();
  const b = await request.json().catch(() => ({}));
  const code = String(b.code ?? "");
  const person = String(b.person ?? "").trim().slice(0, 80);
  const phone = String(b.phone ?? "").replace(/[^\d]/g, "").slice(0, 15) || null;
  if (!person) return bad("Write the name of the person");
  const desk = await prisma.deskClient.findUnique({ where: { code }, select: { active: true } });
  if (!desk?.active) return bad("Choose the client");
  if (!(await releasesFor(code)).length) return bad("No version is published for this client yet (Updates tab)");
  const link = await createDownloadLink({ code, person, phone, days: Number(b.days) || 7, createdBy: admin.name ?? "Admin" });
  return NextResponse.json({ ...link, url: `${siteOrigin(request)}/get/${link.token}` });
}

// DELETE /api/admin/desk/links?token=… – the link stops working at once
export async function DELETE(request: NextRequest) {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) return bad("Which link?");
  await revokeDownloadLink(token);
  return NextResponse.json({ ok: true });
}
