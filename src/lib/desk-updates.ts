import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { cacheDel, cacheGet, cacheSet, type DeskIdentity } from "@/lib/desk";
import { createNotification } from "@/lib/notifications";
import { deleteObject, downloadUrl, putObject, r2Configured, readObject } from "@/lib/r2";

/**
 * MVC Control Centre: new versions of the desktop software and support files
 * (docs/CONTROL_CENTRE.md, "Updates" and "Support files").
 *
 *   GET  /api/desk/version          – latest version published for this client, or {}
 *   GET  /api/desk/download?v=x.y.z – the installer, from the private GitHub release
 *   POST /api/desk/support          – a logs zip from the client's PC
 *
 * The installers are built by GitHub Actions in the private repository
 * (GITHUB_DESK_REPO, default ca-mukulverma/gudakesa-desk) as release assets
 * named GudakesaDesk_Setup_<version>.exe on tag v<version>. Only this server
 * holds the GitHub token (GITHUB_DESK_TOKEN); clients only ever use their key.
 *
 * Neon cost: the version check runs at every contact (4 a day per client), so
 * the published versions are served from Redis like the rules.
 */

const RELEASES_CACHE = "desk:releases:v1";
const WEEK = 7 * 24 * 60 * 60;

export const VERSION_RE = /^\d{1,4}(\.\d{1,4}){1,3}$/;
export const MAX_SUPPORT_BYTES = 10 * 1024 * 1024;
const MAX_NOTE = 2000;

/** "1.10.0" > "1.9.2"; same rule as the desktop app (gk/update.py newer()). */
export function compareVersions(a: string, b: string) {
  const pa = a.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
  const pb = b.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export const installerName = (version: string) => `GudakesaDesk_Setup_${version}.exe`;

// ------------------------------------------------------------------ published versions
export interface LiveRelease {
  id: number;
  version: string;
  notes: string | null;
  mandatory: boolean;
  sha256: string;
  assetId: string;
  assetName: string;
  size: number;
  clientCodes: string[];
}

async function liveReleases(): Promise<LiveRelease[]> {
  const cached = await cacheGet<LiveRelease[]>(RELEASES_CACHE);
  if (cached) return cached;
  const rows = await prisma.deskRelease.findMany({
    where: { withdrawn: false },
    select: {
      id: true, version: true, notes: true, mandatory: true, sha256: true, assetId: true, assetName: true, size: true,
      clientCodes: true,
    },
  });
  await cacheSet(RELEASES_CACHE, rows, WEEK);
  return rows;
}

export async function releasesChanged() {
  await cacheDel(RELEASES_CACHE);
}

/** Versions this client may see: published for everybody or for it; newest first. */
export async function releasesFor(code: string) {
  const rows = await liveReleases();
  return rows
    .filter((r) => r.clientCodes.length === 0 || r.clientCodes.includes(code))
    .sort((a, b) => compareVersions(b.version, a.version) || b.id - a.id);
}

/** The answer for GET /api/desk/version (the contract in gudakesa-desk docs/UPDATES.md §4). */
export async function latestFor(code: string) {
  const [r] = await releasesFor(code);
  if (!r) return {};
  return {
    version: r.version,
    url: `/api/desk/download?v=${encodeURIComponent(r.version)}`,
    sha256: r.sha256,
    notes: r.notes ?? "",
    mandatory: r.mandatory,
  };
}

// ------------------------------------------------------------------ GitHub (server side only)
export class GitHubError extends Error {}

const repo = () => process.env.GITHUB_DESK_REPO || "ca-mukulverma/gudakesa-desk";
const apiBase = () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

export const githubConfigured = () => !!process.env.GITHUB_DESK_TOKEN;

function gh(pathname: string, init: RequestInit = {}) {
  const token = process.env.GITHUB_DESK_TOKEN;
  if (!token) throw new GitHubError("GitHub is not connected yet: add GITHUB_DESK_TOKEN in Vercel (see docs/CONTROL_CENTRE.md)");
  return fetch(`${apiBase()}/repos/${repo()}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "MVC-Control-Centre",
      ...(init.headers as Record<string, string>),
    },
    cache: "no-store",
  });
}

interface GhAsset {
  id: number;
  name: string;
  size: number;
  digest?: string | null; // "sha256:<hex>" on newer GitHub releases
}
interface GhRelease {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: GhAsset[];
}

const versionOfTag = (tag: string) => tag.replace(/^v/i, "");

/** Releases on GitHub that carry an installer, newest first (for the Updates screen). */
export async function githubReleases() {
  const r = await gh("/releases?per_page=30");
  if (!r.ok) throw new GitHubError(`GitHub answered ${r.status}: check GITHUB_DESK_TOKEN and GITHUB_DESK_REPO`);
  const list = (await r.json()) as GhRelease[];
  return list
    .filter((x) => !x.draft)
    .map((x) => {
      const version = versionOfTag(x.tag_name);
      const asset = x.assets.find((a) => a.name === installerName(version));
      return {
        version,
        title: x.name ?? x.tag_name,
        publishedAt: x.published_at,
        prerelease: x.prerelease,
        link: x.html_url,
        installer: asset ? { name: asset.name, size: asset.size } : null,
      };
    })
    .filter((x) => VERSION_RE.test(x.version));
}

/** A short-lived link to the installer's bytes (GitHub's own signed link; no token in it). */
export async function assetLink(assetId: string): Promise<string> {
  const r = await gh(`/releases/assets/${encodeURIComponent(assetId)}`, {
    headers: { Accept: "application/octet-stream" },
    redirect: "manual",
  });
  const loc = r.headers.get("location");
  if (r.status >= 300 && r.status < 400 && loc) return loc;
  throw new GitHubError(`GitHub did not give the installer (${r.status})`);
}

async function sha256OfAsset(assetId: string) {
  const r = await fetch(await assetLink(assetId), { cache: "no-store" });
  if (!r.ok || !r.body) throw new GitHubError(`Could not read the installer from GitHub (${r.status})`);
  const h = crypto.createHash("sha256");
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    h.update(value);
  }
  return h.digest("hex");
}

/** The installer of a version on GitHub with its SHA-256 (from GitHub, or worked out here). */
export async function findInstaller(version: string) {
  const r = await gh(`/releases/tags/v${encodeURIComponent(version)}`);
  if (r.status === 404) throw new GitHubError(`There is no release v${version} on GitHub. Build it first (Actions → Build installer).`);
  if (!r.ok) throw new GitHubError(`GitHub answered ${r.status}: check GITHUB_DESK_TOKEN and GITHUB_DESK_REPO`);
  const rel = (await r.json()) as GhRelease;
  const asset = rel.assets.find((a) => a.name === installerName(version));
  if (!asset) throw new GitHubError(`Release v${version} has no ${installerName(version)} yet (the build may still be running).`);
  const fromGitHub = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? "")?.[1];
  const sha256 = (fromGitHub ?? (await sha256OfAsset(String(asset.id)))).toLowerCase();
  return { assetId: String(asset.id), assetName: asset.name, size: asset.size, sha256 };
}

// ------------------------------------------------------------------ support files
const localDir = () => (!process.env.VERCEL && process.env.DESK_SUPPORT_LOCAL_DIR) || null;

/** Where support files are kept: Cloudflare R2 (private), or a local folder when developing. */
export const supportStorageReady = () => r2Configured() || !!localDir();

async function storeFile(key: string, body: Buffer) {
  const dir = localDir();
  if (!r2Configured() && dir) {
    const p = path.join(dir, key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
    return;
  }
  await putObject(key, body, "application/zip");
}

export async function readSupportFile(key: string) {
  const dir = localDir();
  if (!r2Configured() && dir) return fs.readFile(path.join(dir, key));
  return readObject(key);
}

export async function supportDownloadLink(key: string, fileName: string) {
  return r2Configured() ? downloadUrl(key, fileName) : null;
}

export async function deleteSupportFile(key: string) {
  const dir = localDir();
  if (!r2Configured() && dir) return fs.rm(path.join(dir, key), { force: true });
  await deleteObject(key);
}

const isZip = (b: Buffer) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && [0x03, 0x05].includes(b[2]);

export async function saveSupportFile(who: DeskIdentity, file: File, note: string, appVersion: string | null) {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_SUPPORT_BYTES) return { error: "File larger than 10 MB", status: 413 } as const;
  if (!isZip(bytes)) return { error: "Send a zip file", status: 400 } as const;
  const id = crypto.randomUUID();
  const fileName = (file.name || "support.zip").replace(/[^\w.\-]+/g, "_").slice(-120);
  const storageKey = `desk-support/${who.code}/${id}.zip`;
  await storeFile(storageKey, bytes);
  const trimmed = note.slice(0, MAX_NOTE).trim() || null;
  await prisma.deskSupportFile.create({
    data: { id, deskClientId: who.id, fileName, size: bytes.length, note: trimmed, storageKey, appVersion },
  });
  await prisma.deskEvent.create({ data: { deskClientId: who.id, kind: "support", detail: `Support file ${fileName} received` } });
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  const kb = Math.max(1, Math.round(bytes.length / 1024));
  for (const a of admins) {
    await createNotification({
      title: `Control Centre: support file from ${who.name}`,
      content: `${fileName} (${kb} KB)${trimmed ? `. Note: ${trimmed.slice(0, 300)}` : ""}. Open Admin → Control Centre → Support files.`,
      sentById: a.id,
      sentToId: a.id,
    });
  }
  return { id } as const;
}

/** "GudakesaDesk/1.2.0" -> "1.2.0" */
export const versionFromAgent = (ua: string | null) => /GudakesaDesk\/([\w.\-]{1,20})/.exec(ua ?? "")?.[1] ?? null;
