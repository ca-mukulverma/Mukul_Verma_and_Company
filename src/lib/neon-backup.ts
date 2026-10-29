// Database backups are Neon snapshots of the production branch, taken through
// the Neon API. Needs NEON_API_KEY and NEON_PROJECT_ID in Vercel; NEON_BRANCH_ID
// is optional (the project's default branch otherwise). Restoring is done in the
// Neon console (Backup & restore), never from the app, as it replaces live data.

const API = "https://console.neon.tech/api/v2";

export interface Backup {
  id: string;
  name: string;
  createdAt: string;
  manual: boolean;
}

export function backupsConfigured() {
  return !!(process.env.NEON_API_KEY && process.env.NEON_PROJECT_ID);
}

async function neon<T>(path: string, init?: RequestInit): Promise<T> {
  if (!backupsConfigured()) throw new Error("Backups are not set up: add NEON_API_KEY and NEON_PROJECT_ID in Vercel");
  const response = await fetch(`${API}/projects/${process.env.NEON_PROJECT_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}`, Accept: "application/json" },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Neon: ${body?.message || response.statusText}`);
  return body as T;
}

async function branchId() {
  if (process.env.NEON_BRANCH_ID) return process.env.NEON_BRANCH_ID;
  const { branches } = await neon<{ branches: { id: string; default: boolean }[] }>("/branches");
  const branch = branches.find((b) => b.default);
  if (!branch) throw new Error("Neon: the project has no default branch");
  return branch.id;
}

type Snapshot = { id: string; name?: string; created_at: string; manual?: boolean };
const toBackup = (s: Snapshot): Backup => ({ id: s.id, name: s.name || s.id, createdAt: s.created_at, manual: !!s.manual });

export async function listBackups(): Promise<Backup[]> {
  const { snapshots } = await neon<{ snapshots: Snapshot[] }>("/snapshots");
  return (snapshots ?? []).map(toBackup).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// e.g. "2026-10-29 14-05 Mukul before fresh start"
export async function takeBackup(by: string, reason?: string): Promise<Backup> {
  const stamp = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
  const name = [stamp, by, reason].filter(Boolean).join(" ").replace(/[^\w .-]/g, "").slice(0, 120);
  const { snapshot } = await neon<{ snapshot: Snapshot }>(`/branches/${await branchId()}/snapshot?name=${encodeURIComponent(name)}`, {
    method: "POST",
  });
  return toBackup(snapshot);
}

export async function deleteBackup(id: string) {
  await neon(`/snapshots/${encodeURIComponent(id)}`, { method: "DELETE" });
}
