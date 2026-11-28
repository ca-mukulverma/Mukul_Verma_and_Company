import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { countDownload, getDownloadLink } from "@/lib/desk-links";
import { assetLink, GitHubError, releasesFor } from "@/lib/desk-updates";

export const dynamic = "force-dynamic";

// GET /api/public/desk-get/<token> – the installer for the person a download link was made for (no sign-in: the
// link is the key, it expires). Same way as /api/desk/download: GitHub's short-lived signed link, no token shown.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await getDownloadLink(token);
  if (!link) return NextResponse.json({ error: "This download link has expired. Ask MVC for a new one." }, { status: 404 });
  const [rel] = await releasesFor(link.code);
  if (!rel) return NextResponse.json({ error: "No version is available just now. Ask MVC." }, { status: 404 });
  let url: string;
  try {
    url = await assetLink(rel.assetId);
  } catch (e) {
    const msg = e instanceof GitHubError ? e.message : "GitHub not reachable";
    return NextResponse.json({ error: `Download not available just now: ${msg}` }, { status: 502 });
  }
  await countDownload(link);
  const desk = await prisma.deskClient.findUnique({ where: { code: link.code }, select: { id: true } });
  if (desk) {
    await prisma.deskEvent
      .create({ data: { deskClientId: desk.id, kind: "download", detail: `${link.person} downloaded ${rel.version} from a download link` } })
      .catch(() => undefined);
  }
  return NextResponse.redirect(url, 302);
}
