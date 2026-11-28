import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { createNotification } from "@/lib/notifications";

/**
 * Links the Control Centre gives to people outside the firm (docs/CONTROL_CENTRE.md, "Phone links"):
 *
 *  1. Suspense answers – /s/<token>
 *     The client's Desk (Gudakesa Desk 1.4.1+) sends the bank entries it could not identify, with the client's own
 *     Tally ledgers grouped by kind (POST /api/desk/suspense). The client opens the link on the phone, taps what each
 *     entry is and the party / ledger, and presses Send. The Desk collects the answers at its next contact
 *     (GET /api/desk/suspense/answers, then /ack).
 *  2. App download – /get/<token>
 *     Admin makes a personal link for one person (Control Centre → Download links) and sends it on WhatsApp. The page
 *     offers the newest installer published for that client.
 *
 * Everything is kept in Redis with an expiry: nothing here wakes the database except the Admin notification when a
 * client sends answers (rare) and the download log.
 */

const DAY = 24 * 60 * 60;
const SUS_DATA = "desk:sus:"; // + code -> SuspensePack
const SUS_TOKEN = "desk:sustok:"; // + token -> code
const SUS_ANS = "desk:susans:"; // + code -> hash ref -> SuspenseAnswer (JSON)
const DL = "desk:dl:"; // + token -> DownloadLink
const DL_LIST = "desk:dl:list"; // tokens, newest first
const SUS_DAYS = 60;

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;
export const newToken = () => crypto.randomBytes(18).toString("base64url");

// ------------------------------------------------------------------ suspense answers
export interface SuspenseItem {
  ref: string; // S12 (the Desk's reference)
  date: string; // YYYY-MM-DD
  amount: number;
  direction: "IN" | "OUT";
  narration: string;
  bank: string;
}
export interface Nature {
  label: string;
  ledgers: string[];
}
export interface SuspensePack {
  token: string;
  code: string;
  company: string;
  items: SuspenseItem[];
  natures: Nature[];
  sentAt: string;
}
export interface SuspenseAnswer {
  ref: string;
  nature: string;
  ledger: string;
  note: string;
  at: string;
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Clean what a Desk sent: refs, amounts, at most 300 items, 20 kinds, 2,000 ledgers per kind. */
export function cleanPack(body: unknown): Omit<SuspensePack, "token" | "code" | "sentAt"> | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300).map((i) => {
    const r = (i ?? {}) as Record<string, unknown>;
    return {
      ref: str(r.ref, 12),
      date: str(r.date, 10),
      amount: Math.round(Number(r.amount) * 100) / 100,
      direction: r.direction === "IN" ? "IN" : "OUT",
      narration: str(r.narration, 200),
      bank: str(r.bank, 60),
    } as SuspenseItem;
  });
  if (items.some((i) => !/^S\d{1,9}$/.test(i.ref) || !Number.isFinite(i.amount))) return { error: "Bad item in the list" };
  const natures = (Array.isArray(b.natures) ? b.natures : []).slice(0, 20).map((n) => {
    const r = (n ?? {}) as Record<string, unknown>;
    return {
      label: str(r.label, 60),
      ledgers: (Array.isArray(r.ledgers) ? r.ledgers : []).slice(0, 2000).map((l) => str(l, 120)).filter(Boolean),
    };
  }).filter((n) => n.label);
  if (!natures.length) return { error: "No kinds of entry sent" };
  return { company: str(b.company, 120), items, natures };
}

/** The Desk's list replaces the earlier one; the link stays the same (the client can keep it). */
export async function publishSuspense(code: string, pack: Omit<SuspensePack, "token" | "code" | "sentAt">) {
  const old = await redis.get(SUS_DATA + code);
  const token = old ? (JSON.parse(old) as SuspensePack).token : newToken();
  const full: SuspensePack = { ...pack, token, code, sentAt: new Date().toISOString() };
  await redis.set(SUS_DATA + code, JSON.stringify(full), "EX", SUS_DAYS * DAY);
  await redis.set(SUS_TOKEN + token, code, "EX", SUS_DAYS * DAY);
  // answers for entries no longer asked are dropped
  const refs = new Set(pack.items.map((i) => i.ref));
  const have = await redis.hkeys(SUS_ANS + code);
  const gone = have.filter((r) => !refs.has(r));
  if (gone.length) await redis.hdel(SUS_ANS + code, ...gone);
  return token;
}

export async function packForToken(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const code = await redis.get(SUS_TOKEN + token);
  if (!code) return null;
  const raw = await redis.get(SUS_DATA + code);
  if (!raw) return null;
  const pack = JSON.parse(raw) as SuspensePack;
  if (pack.token !== token) return null;
  const answered = await redis.hgetall(SUS_ANS + code);
  return { pack, answered: Object.fromEntries(Object.entries(answered).map(([k, v]) => [k, JSON.parse(v) as SuspenseAnswer])) };
}

/** The client's answers from the phone page. Returns how many were saved. */
export async function saveAnswers(token: string, body: unknown) {
  const found = await packForToken(token);
  if (!found) return { error: "This link has expired. Ask MVC for a new one.", status: 404 } as const;
  const { pack } = found;
  const list = Array.isArray((body as Record<string, unknown>)?.answers) ? ((body as Record<string, unknown>).answers as unknown[]) : [];
  const refs = new Set(pack.items.map((i) => i.ref));
  const natures = new Map(pack.natures.map((n) => [n.label, new Set(n.ledgers)]));
  const ok: SuspenseAnswer[] = [];
  for (const a of list.slice(0, 300)) {
    const r = (a ?? {}) as Record<string, unknown>;
    const ref = str(r.ref, 12);
    const nature = str(r.nature, 60);
    const ledger = str(r.ledger, 120);
    const note = str(r.note, 300);
    if (!refs.has(ref) || !natures.has(nature)) continue;
    if (ledger && !natures.get(nature)!.has(ledger)) continue; // only a ledger from the list
    if (!ledger && !note) continue; // something must be said
    ok.push({ ref, nature, ledger, note, at: new Date().toISOString() });
  }
  if (!ok.length) return { error: "Choose what the entry is and the party / ledger (or write a note) first.", status: 400 } as const;
  await redis.hset(SUS_ANS + pack.code, Object.fromEntries(ok.map((a) => [a.ref, JSON.stringify(a)])));
  await redis.expire(SUS_ANS + pack.code, SUS_DAYS * DAY);
  try {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    for (const u of admins) {
      await createNotification({
        title: `${pack.company || pack.code}: suspense answers`,
        content: `${ok.length} bank entr${ok.length === 1 ? "y" : "ies"} explained on the phone link. The Desk takes them at its next contact.`,
        sentById: u.id,
        sentToId: u.id,
      });
    }
  } catch {
    /* the answers are saved; the bell is optional */
  }
  return { saved: ok.length } as const;
}

export async function answersFor(code: string) {
  const all = await redis.hgetall(SUS_ANS + code);
  return Object.values(all).map((v) => JSON.parse(v) as SuspenseAnswer);
}

/** The Desk has the answers: forget them and stop asking those entries. */
export async function ackAnswers(code: string, refs: string[]) {
  if (!refs.length) return 0;
  const n = await redis.hdel(SUS_ANS + code, ...refs);
  const raw = await redis.get(SUS_DATA + code);
  if (raw) {
    const pack = JSON.parse(raw) as SuspensePack;
    const drop = new Set(refs);
    pack.items = pack.items.filter((i) => !drop.has(i.ref));
    const ttl = await redis.ttl(SUS_DATA + code);
    await redis.set(SUS_DATA + code, JSON.stringify(pack), "EX", ttl > 0 ? ttl : SUS_DAYS * DAY);
  }
  return n;
}

// ------------------------------------------------------------------ download links
export interface DownloadLink {
  token: string;
  code: string; // the Desk client whose published versions it offers
  person: string;
  phone: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  downloads: number;
}

export async function createDownloadLink(o: { code: string; person: string; phone: string | null; days: number; createdBy: string }) {
  const token = newToken();
  const days = Math.min(Math.max(Math.round(o.days) || 7, 1), 30);
  const link: DownloadLink = {
    token,
    code: o.code,
    person: o.person,
    phone: o.phone,
    createdBy: o.createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + days * DAY * 1000).toISOString(),
    downloads: 0,
  };
  await redis.set(DL + token, JSON.stringify(link), "EX", days * DAY);
  await redis.lpush(DL_LIST, token);
  await redis.ltrim(DL_LIST, 0, 199);
  return link;
}

export async function getDownloadLink(token: string): Promise<DownloadLink | null> {
  if (!TOKEN_RE.test(token)) return null;
  const raw = await redis.get(DL + token);
  return raw ? (JSON.parse(raw) as DownloadLink) : null;
}

export async function listDownloadLinks() {
  const tokens = await redis.lrange(DL_LIST, 0, 199);
  if (!tokens.length) return [];
  const vals = await redis.mget(...tokens.map((t) => DL + t));
  const live = vals.filter((v): v is string => !!v).map((v) => JSON.parse(v) as DownloadLink);
  const dead = tokens.filter((_, i) => !vals[i]);
  for (const t of dead) await redis.lrem(DL_LIST, 0, t);
  return live;
}

export async function revokeDownloadLink(token: string) {
  await redis.del(DL + token);
  await redis.lrem(DL_LIST, 0, token);
}

export async function countDownload(link: DownloadLink) {
  const ttl = await redis.ttl(DL + link.token);
  if (ttl <= 0) return;
  await redis.set(DL + link.token, JSON.stringify({ ...link, downloads: link.downloads + 1 }), "EX", ttl);
}

/** The address of this website as the person outside sees it. */
export function siteOrigin(request: Request) {
  const env = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (env && !env.includes("localhost")) return env;
  return new URL(request.url).origin;
}
