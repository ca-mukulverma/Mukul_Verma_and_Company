import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CODE_RE } from "@/lib/desk";
import { bad, onlyAdmin, requireDeskAdmin } from "@/lib/desk-admin";
import { findInstaller, GitHubError, githubConfigured, githubReleases, releasesChanged, VERSION_RE } from "@/lib/desk-updates";

export const dynamic = "force-dynamic";

// GET /api/admin/desk/updates – versions published to clients (newest first),
// the releases built on GitHub, and which version each client runs now
export async function GET() {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const published = await prisma.deskRelease.findMany({ orderBy: [{ publishedAt: "desc" }], take: 200 });
  const desks = await prisma.deskClient.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { code: true, name: true, appVersion: true, lastReportAt: true },
  });
  let github: Awaited<ReturnType<typeof githubReleases>> = [];
  let githubError: string | null = null;
  if (!githubConfigured()) githubError = "GitHub is not connected yet: add GITHUB_DESK_TOKEN in Vercel (see docs/CONTROL_CENTRE.md).";
  else {
    try {
      github = await githubReleases();
    } catch (e) {
      githubError = e instanceof GitHubError ? e.message : "GitHub not reachable just now";
    }
  }
  return NextResponse.json({ published, github, githubError, desks, codes: desks.map((d) => d.code) });
}

// POST /api/admin/desk/updates – publish { version, notes?, mandatory?, clientCodes? }.
// The installer and its SHA-256 are taken from the GitHub release v<version>.
export async function POST(request: NextRequest) {
  const admin = await requireDeskAdmin();
  if (!admin) return onlyAdmin();
  const b = await request.json().catch(() => ({}));
  const version = String(b.version ?? "").trim().replace(/^v/i, "");
  if (!VERSION_RE.test(version)) return bad("Choose a version like 1.2.0");
  const codes: string[] = Array.isArray(b.clientCodes)
    ? [...new Set<string>(b.clientCodes.map((c: unknown) => String(c).toUpperCase()))].sort()
    : [];
  if (codes.some((c) => !CODE_RE.test(c))) return bad("Unknown client code");
  const same = await prisma.deskRelease.findFirst({ where: { version, withdrawn: false, clientCodes: { equals: codes } } });
  if (same) return bad(`Version ${version} is already published to ${codes.length ? codes.join(", ") : "all clients"}`);
  let inst;
  try {
    inst = await findInstaller(version);
  } catch (e) {
    return bad(e instanceof GitHubError ? e.message : "GitHub not reachable just now; try again");
  }
  const release = await prisma.deskRelease.create({
    data: {
      version, notes: b.notes ? String(b.notes).slice(0, 2000) : null, mandatory: b.mandatory === true,
      ...inst, clientCodes: codes, publishedBy: admin.name.slice(0, 50),
    },
  });
  await releasesChanged();
  return NextResponse.json({ release }, { status: 201 });
}

// PATCH /api/admin/desk/updates – { id, withdrawn: true|false }
export async function PATCH(request: NextRequest) {
  if (!(await requireDeskAdmin())) return onlyAdmin();
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id) || typeof b.withdrawn !== "boolean") return bad("Choose a version");
  await prisma.deskRelease.update({ where: { id }, data: { withdrawn: b.withdrawn } });
  await releasesChanged();
  return NextResponse.json({ ok: true });
}
