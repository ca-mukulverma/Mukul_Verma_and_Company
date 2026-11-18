import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deskFromRequest } from "@/lib/desk";
import { assetLink, GitHubError, releasesFor, VERSION_RE } from "@/lib/desk-updates";

export const dynamic = "force-dynamic";

// GET /api/desk/download?v=1.2.0 – the installer of a version published for
// this client. It comes from the private GitHub release with this server's
// own token; the client only ever sends its key.
//
// By default the client is sent on to GitHub's own short-lived signed link for
// the file (valid a few minutes, no token in it), so a large installer never
// runs into Vercel's time limit. DESK_DOWNLOAD_MODE=stream passes the bytes
// through this server instead.
export async function GET(request: NextRequest) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  const v = request.nextUrl.searchParams.get("v") ?? "";
  if (!VERSION_RE.test(v)) return NextResponse.json({ error: "Give the version, e.g. ?v=1.2.0" }, { status: 400 });
  const rel = (await releasesFor(who.code)).find((r) => r.version === v);
  if (!rel) return NextResponse.json({ error: `Version ${v} is not published for this client` }, { status: 404 });

  let link: string;
  try {
    link = await assetLink(rel.assetId);
  } catch (e) {
    console.error("desk download:", e);
    const msg = e instanceof GitHubError ? e.message : "GitHub not reachable";
    return NextResponse.json({ error: `Installer not available just now: ${msg}` }, { status: 502 });
  }
  await prisma.deskEvent
    .create({ data: { deskClientId: who.id, kind: "download", detail: `Downloaded update ${v}` } })
    .catch(() => undefined);

  if (process.env.DESK_DOWNLOAD_MODE !== "stream") return NextResponse.redirect(link, 302);

  const up = await fetch(link, { cache: "no-store" });
  if (!up.ok || !up.body) return NextResponse.json({ error: `Installer not available just now (${up.status})` }, { status: 502 });
  return new Response(up.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${rel.assetName}"`,
      ...(up.headers.get("content-length") ? { "content-length": up.headers.get("content-length")! } : {}),
      "cache-control": "private, no-store",
    },
  });
}
