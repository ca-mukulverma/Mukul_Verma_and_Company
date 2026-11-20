import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { cacheDel, cacheGet, cacheSet, sha256 } from "@/lib/desk";
import { connectorLedger } from "@/lib/connectors";
import { DEBTOR_ENTITIES, ENTITY_LABELS, istToday, keptPeriod, type DebtorEntity, type LedgerEntry } from "@/lib/tally-debtors-shared";
import { addMonths, recovery, type Recovery } from "@/lib/tally-recovery";

/**
 * Debtors from Tally (docs/TALLY_DEBTORS.md).
 *
 * Each firm (MVC, B Edge) has its own Tally company, on its own Tally PC or
 * both on one. The Tally extension on that PC reads the Sundry Debtors
 * ledgers (and nothing else) of the company it was connected for and sends
 * them here at 11:30, 13:00, 16:00 and 19:00 IST (or as soon as the PC is on,
 * if it was off then), and when someone presses "Refresh now". A failed
 * update is not tried again on its own: someone presses Refresh now. Each
 * firm's PC has its own key, so the key tells which firm the data is for.
 * It calls /api/tally-sync/* (Authorization: Bearer mvct_…):
 *   GET  poll    every 30 seconds: is a refresh asked for? (Redis only)
 *   POST plan    which ledgers changed since the last time (their hashes)
 *   POST upload  the changed ledgers with their entries
 *   POST commit  the groups and the full list of ledgers; sets the "as of" time
 *   POST error   Tally couldn't be read (Redis only)
 *
 * Neon cost: the 30-second checks, the key check, the update time and the
 * refresh requests live in Redis, so only an update itself (4 a day, in office
 * hours) and people opening Debtors touch the database. Unchanged ledgers are
 * not written again.
 */

const KEY_CACHE = "tdebt:pc:"; // + sha256 -> { entity, company }
// Per firm: + entity
const SEEN = "tdebt:seen:"; // ISO time its Tally PC last checked in
const REFRESH = "tdebt:refresh:"; // { at, by } a refresh asked for
const STATE = "tdebt:state:"; // SyncState
const ERROR = "tdebt:error:"; // { at, message } the last failed update
const SHARE = "tdebt:share:";
const RECOVERY_CACHE = "tdebt:recovery:"; // + entity:readAt:month -> recovery figures (10 minutes) // + token -> { key, fileName }
const DAY = 24 * 60 * 60;
export const SHARE_DAYS = 7;
export const SHARE_PREFIX = "ledger-shares/";

export const DEFAULT_PORT = 9000;

// ─── The Tally PC's key ─────────────────────────────────────────────────────

export function newSyncKey() {
  const key = `mvct_${crypto.randomBytes(24).toString("base64url")}`;
  return { key, keyHash: sha256(key), keyHint: key.slice(-6) };
}

export interface SyncAgent {
  entity: DebtorEntity;
  company: string;
}

/** The Tally PC (and the firm it sends for) a request comes from ("Authorization: Bearer mvct_…"); null = refuse. */
export async function syncAgentFromRequest(request: Request): Promise<SyncAgent | null> {
  const m = /^Bearer\s+(mvct_[A-Za-z0-9_-]{20,64})$/.exec((request.headers.get("authorization") ?? "").trim());
  if (!m) return null;
  const hash = sha256(m[1]);
  let who = await cacheGet<SyncAgent>(KEY_CACHE + hash);
  if (!who) {
    const row = await prisma.tallyDebtorSync.findUnique({ where: { keyHash: hash }, select: { entity: true, company: true } });
    if (!row) return null;
    who = { entity: row.entity, company: row.company };
    await cacheSet(KEY_CACHE + hash, who, 30 * DAY);
  }
  try {
    await redis.set(SEEN + who.entity, new Date().toISOString(), "EX", 30 * DAY);
  } catch {
    /* optional */
  }
  return who;
}

export async function forgetSyncKey(keyHash: string | null | undefined) {
  if (keyHash) await cacheDel(KEY_CACHE + keyHash);
}

// ─── Status (Redis first) ───────────────────────────────────────────────────

export interface SyncState {
  entity: DebtorEntity;
  connected: boolean;
  company: string | null;
  readAt: string | null;
  syncedAt: string | null;
  trigger: string | null;
  ledgerCount: number;
}

export interface SyncStatus extends SyncState {
  // When the Tally PC last checked in (it does every 30 seconds while on)
  seenAt: string | null;
  // A refresh asked for and not yet done
  refresh: { at: string; by: string } | null;
  // The last update that failed, if after the last good one
  error: { at: string; message: string } | null;
}

async function stateFromDb(entity: DebtorEntity): Promise<SyncState> {
  const row = await prisma.tallyDebtorSync.findUnique({ where: { entity } });
  const state: SyncState = {
    entity,
    connected: !!row?.keyHash,
    company: row?.company ?? null,
    readAt: row?.readAt?.toISOString() ?? null,
    syncedAt: row?.syncedAt?.toISOString() ?? null,
    trigger: row?.trigger ?? null,
    ledgerCount: row?.ledgerCount ?? 0,
  };
  await cacheSet(STATE + entity, state, 30 * DAY);
  return state;
}

async function readState(entity: DebtorEntity): Promise<SyncState> {
  return (await cacheGet<SyncState>(STATE + entity)) ?? stateFromDb(entity);
}

export async function syncStatus(entity: DebtorEntity): Promise<SyncStatus> {
  const state = await readState(entity);
  let seenAt: string | null = null;
  let refresh: SyncStatus["refresh"] = null;
  let error: SyncStatus["error"] = null;
  try {
    const [seen, ref, err] = await redis.mget(SEEN + entity, REFRESH + entity, ERROR + entity);
    seenAt = seen;
    refresh = ref ? JSON.parse(ref) : null;
    error = err ? JSON.parse(err) : null;
  } catch {
    /* Redis down: no live status */
  }
  if (error && state.readAt && new Date(error.at) <= new Date(state.readAt)) error = null;
  return { ...state, seenAt, refresh, error };
}

// Both firms' status (for the pages)
export async function allSyncStatus() {
  const list = await Promise.all(DEBTOR_ENTITIES.map((e) => syncStatus(e)));
  return Object.fromEntries(list.map((s) => [s.entity, s])) as Record<DebtorEntity, SyncStatus>;
}

export async function askRefresh(entity: DebtorEntity, by: string) {
  const request = { at: new Date().toISOString(), by };
  await redis.set(REFRESH + entity, JSON.stringify(request), "EX", DAY);
  return request;
}

export async function pendingRefresh(entity: DebtorEntity): Promise<{ at: string; by: string } | null> {
  return cacheGet(REFRESH + entity);
}

export async function reportSyncError(entity: DebtorEntity, message: string) {
  await cacheSet(ERROR + entity, { at: new Date().toISOString(), message: message.slice(0, 500) }, 30 * DAY);
  // The refresh asked for has been tried: the page shows the error instead of waiting
  await cacheDel(REFRESH + entity);
}

// ─── Who may see Debtors ────────────────────────────────────────────────────

// Admin, and partners switched on in Settings → Permissions. From the session
// (refreshed from the database every minute), so the status checks while a
// refresh runs don't wake the database.
export async function debtorsUser() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return null;
  if (user.role === "ADMIN" || (user.role === "PARTNER" && session?.user.canViewDebtors)) return user;
  return null;
}

export const notAllowed = () =>
  NextResponse.json({ error: "Only Admin and the partners allowed by Admin see Debtors" }, { status: 403 });

// ─── What the Tally PC sends ────────────────────────────────────────────────

const name = z.string().trim().min(1).max(150);
const money = z.number().finite().gt(-1e12).lt(1e12);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const entrySchema = z.object({
  d: day,
  p: z.string().max(150),
  t: z.string().max(60),
  n: z.string().max(60),
  dr: money.min(0),
  cr: money.min(0),
  r: z.string().max(300).optional(),
});

export const planSchema = z.object({
  hashes: z.record(z.string().max(150), z.string().regex(/^[0-9a-f]{64}$/)),
});

export const uploadSchema = z.object({
  ledgers: z
    .array(
      z.object({
        name,
        group: name,
        opening: money,
        closing: money,
        hash: z.string().regex(/^[0-9a-f]{64}$/),
        entries: z.array(entrySchema).max(20_000),
      })
    )
    .max(5000),
});

export const commitSchema = z.object({
  readAt: z.string().datetime(),
  periodFrom: day,
  periodTo: day,
  rootGroup: name,
  groups: z.array(z.object({ name, parent: name })).max(2000),
  names: z.array(name).max(20_000),
  trigger: z.enum(["scheduled", "refresh", "manual"]),
});

export const nameKey = (ledgerName: string) => ledgerName.trim().toLowerCase();

export const entityParam = z.enum(DEBTOR_ENTITIES);

// Which of the ledgers the Tally PC has differ from what is stored
export async function ledgersNeeded(entity: DebtorEntity, hashes: Record<string, string>) {
  const stored = await prisma.tallyDebtorLedger.findMany({ where: { entity }, select: { nameKey: true, hash: true } });
  const have = new Map(stored.map((l) => [l.nameKey, l.hash]));
  return Object.entries(hashes)
    .filter(([n, h]) => have.get(nameKey(n)) !== h)
    .map(([n]) => n);
}

// The last receipt in the entries (latest date)
function lastReceipt(entries: LedgerEntry[]) {
  let found: LedgerEntry | null = null;
  for (const e of entries) if (e.cr > 0 && /receipt/i.test(e.t) && (!found || e.d >= found.d)) found = e;
  return found;
}

export async function saveLedgers(entity: DebtorEntity, ledgers: z.infer<typeof uploadSchema>["ledgers"]) {
  const writes = ledgers.map((l) => {
    const receipt = lastReceipt(l.entries);
    const data = {
      name: l.name,
      groupName: l.group,
      opening: l.opening,
      closing: l.closing,
      lastReceiptDate: receipt ? new Date(`${receipt.d}T00:00:00Z`) : null,
      lastReceiptAmt: receipt ? receipt.cr : null,
      entries: l.entries as unknown as Prisma.InputJsonValue,
      hash: l.hash,
    };
    const key = nameKey(l.name);
    return prisma.tallyDebtorLedger.upsert({ where: { entity_nameKey: { entity, nameKey: key } }, create: { entity, nameKey: key, ...data }, update: data });
  });
  for (let i = 0; i < writes.length; i += 100) await prisma.$transaction(writes.slice(i, i + 100));
}

export async function commitSync({ entity, company }: SyncAgent, body: z.infer<typeof commitSchema>) {
  const keys = [...new Set(body.names.map(nameKey))];
  const readAt = new Date(body.readAt);
  const syncedAt = new Date();
  await prisma.$transaction([
    prisma.tallyDebtorLedger.deleteMany({ where: { entity, nameKey: { notIn: keys } } }),
    prisma.tallyDebtorSync.update({
      where: { entity },
      data: {
        rootGroup: body.rootGroup,
        groups: body.groups,
        periodFrom: new Date(`${body.periodFrom}T00:00:00Z`),
        periodTo: new Date(`${body.periodTo}T00:00:00Z`),
        readAt,
        syncedAt,
        trigger: body.trigger,
        ledgerCount: keys.length,
      },
    }),
  ]);
  const state: SyncState = {
    entity,
    connected: true,
    company,
    readAt: readAt.toISOString(),
    syncedAt: syncedAt.toISOString(),
    trigger: body.trigger,
    ledgerCount: keys.length,
  };
  await cacheSet(STATE + entity, state, 30 * DAY);
  // The refresh asked for is done if it was asked before Tally was read
  const asked = await pendingRefresh(entity);
  if (asked && new Date(asked.at) <= readAt) await cacheDel(REFRESH + entity);
  await cacheDel(ERROR + entity);
}

// What the Tally PC needs to know at each check
export async function pollAnswer({ entity, company }: SyncAgent) {
  return { entity, company, period: keptPeriod(), refresh: await pendingRefresh(entity) };
}

// ─── Connecting the Tally PC (Admin) ────────────────────────────────────────

export async function connectSyncPc(entity: DebtorEntity, company: string, adminName: string) {
  const before = await prisma.tallyDebtorSync.findUnique({ where: { entity }, select: { keyHash: true, company: true } });
  const { key, keyHash, keyHint } = newSyncKey();
  const companyChanged = !!before && before.company.trim().toLowerCase() !== company.trim().toLowerCase();
  await prisma.$transaction([
    // Another Tally company's debtors must not stay under this firm
    ...(companyChanged ? [prisma.tallyDebtorLedger.deleteMany({ where: { entity } })] : []),
    prisma.tallyDebtorSync.upsert({
      where: { entity },
      create: { entity, company, keyHash, keyHint, connectedAt: new Date(), connectedBy: adminName },
      update: {
        company,
        keyHash,
        keyHint,
        connectedAt: new Date(),
        connectedBy: adminName,
        ...(companyChanged && { rootGroup: null, groups: Prisma.DbNull, readAt: null, syncedAt: null, trigger: null, ledgerCount: 0 }),
      },
    }),
  ]);
  await forgetSyncKey(before?.keyHash);
  await cacheDel(STATE + entity, ERROR + entity);
  return key;
}

export async function disconnectSyncPc(entity: DebtorEntity) {
  const before = await prisma.tallyDebtorSync.findUnique({ where: { entity }, select: { keyHash: true } });
  if (!before) return;
  await prisma.tallyDebtorSync.update({ where: { entity }, data: { keyHash: null, keyHint: null } });
  await forgetSyncKey(before.keyHash);
  await cacheDel(STATE + entity, REFRESH + entity);
}

// ─── Reading ────────────────────────────────────────────────────────────────

export interface PartyDetails {
  kind: "client" | "connector";
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phones: { number: string; label: string; whatsapp: boolean }[];
  gstin: string | null;
  pan: string | null;
  address: string | null;
  manager: string | null;
  // For a connector: how many clients' bills go to this ledger
  clientCount?: number;
}

// The clients (by their own ledger) and connectors whose Tally ledger is among `keys`
export async function partiesForLedgers(keys: string[]) {
  const wanted = new Set(keys);
  const [clients, connectors] = await Promise.all([
    prisma.client.findMany({
      where: { isGuest: false },
      select: {
        id: true,
        contactPerson: true,
        companyName: true,
        tallyLedgerName: true,
        email: true,
        phone: true,
        phones: true,
        gstin: true,
        pan: true,
        address: true,
        manager: { select: { name: true } },
      },
    }),
    prisma.connector.findMany({
      select: { id: true, name: true, tallyLedgerName: true, phone: true, email: true, _count: { select: { clients: true } } },
    }),
  ]);
  const parties = new Map<string, PartyDetails>();
  for (const c of connectors) {
    const key = nameKey(connectorLedger(c));
    if (!wanted.has(key) || parties.has(key)) continue;
    parties.set(key, {
      kind: "connector",
      id: c.id,
      name: c.name,
      companyName: null,
      email: c.email,
      phones: c.phone ? [{ number: c.phone, label: "Connector", whatsapp: true }] : [],
      gstin: null,
      pan: null,
      address: null,
      manager: null,
      clientCount: c._count.clients,
    });
  }
  for (const c of clients) {
    // The client's own ledger (not a connector's, which holds other clients' bills too)
    const key = nameKey(c.tallyLedgerName || c.companyName || c.contactPerson);
    if (!wanted.has(key) || parties.has(key)) continue;
    const phones = Array.isArray(c.phones) ? (c.phones as PartyDetails["phones"]) : c.phone ? [{ number: c.phone, label: "Owner", whatsapp: true }] : [];
    parties.set(key, {
      kind: "client",
      id: c.id,
      name: c.contactPerson,
      companyName: c.companyName,
      email: c.email,
      phones,
      gstin: c.gstin,
      pan: c.pan,
      address: c.address,
      manager: c.manager?.name ?? null,
    });
  }
  return parties;
}

export const toNumber = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

export async function loadLedger(id: string) {
  const ledger = await prisma.tallyDebtorLedger.findUnique({ where: { id } });
  if (!ledger) return null;
  const sync = await prisma.tallyDebtorSync.findUnique({
    where: { entity: ledger.entity },
    select: { company: true, readAt: true, periodFrom: true, periodTo: true },
  });
  if (!sync) return null;
  return {
    id: ledger.id,
    entity: ledger.entity as DebtorEntity,
    name: ledger.name,
    group: ledger.groupName,
    opening: toNumber(ledger.opening),
    closing: toNumber(ledger.closing),
    entries: ledger.entries as unknown as LedgerEntry[],
    company: sync.company,
    readAt: sync.readAt?.toISOString() ?? null,
    periodFrom: sync.periodFrom?.toISOString().slice(0, 10) ?? keptPeriod().from,
    periodTo: sync.periodTo?.toISOString().slice(0, 10) ?? keptPeriod().to,
  };
}

export type LoadedLedger = NonNullable<Awaited<ReturnType<typeof loadLedger>>>;

// ─── WhatsApp links (PDF kept 7 days in R2) ─────────────────────────────────

export function newShareToken() {
  return crypto.randomBytes(18).toString("base64url");
}

export async function saveShare(token: string, share: { key: string; fileName: string }) {
  await redis.set(SHARE + token, JSON.stringify(share), "EX", SHARE_DAYS * DAY);
}

export async function readShare(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return cacheGet<{ key: string; fileName: string }>(SHARE + token);
}

// Daily job: ledger PDFs whose WhatsApp link has expired (Cloudflare R2 only)
export async function cleanupLedgerShares() {
  const { deleteOlderThan, r2Configured } = await import("@/lib/r2");
  if (!r2Configured()) return { message: "R2 not set up" };
  const deleted = await deleteOlderThan(SHARE_PREFIX, new Date(Date.now() - (SHARE_DAYS + 1) * 86_400_000));
  return { message: `Deleted ${deleted} expired ledger PDF(s)` };
}

// ─── Recovery ───────────────────────────────────────────────────────────────

export interface RecoveryAnswer {
  entity: DebtorEntity;
  company: string | null;
  readAt: string | null;
  periodFrom: string | null;
  recovery: Recovery | null;
}

// A firm's recovery figures for a month (YYYY-MM), from the synced ledgers.
// Kept 10 minutes in Redis (per update), so opening the page again is cheap.
export async function recoveryFor(entity: DebtorEntity, month: string): Promise<RecoveryAnswer> {
  const sync = await prisma.tallyDebtorSync.findUnique({ where: { entity } });
  const base = { entity, company: sync?.company ?? null, readAt: sync?.readAt?.toISOString() ?? null };
  if (!sync?.readAt || !sync.rootGroup || !sync.periodFrom) return { ...base, periodFrom: null, recovery: null };
  const periodFrom = sync.periodFrom.toISOString().slice(0, 10);
  const cacheKey = `${RECOVERY_CACHE}${entity}:${base.readAt}:${month}`;
  const cached = await cacheGet<Recovery>(cacheKey);
  if (cached) return { ...base, periodFrom, recovery: cached };

  const [ledgers, sends] = await Promise.all([
    prisma.tallyDebtorLedger.findMany({ where: { entity }, select: { id: true, name: true, groupName: true, opening: true, entries: true } }),
    prisma.tallyLedgerEvent.findMany({ where: { entity, kind: "whatsapp", at: { gte: sync.periodFrom } }, select: { ledgerName: true, at: true } }),
  ]);
  const result = recovery({
    ledgers: ledgers.map((l) => ({ id: l.id, name: l.name, group: l.groupName, opening: toNumber(l.opening), entries: l.entries as unknown as LedgerEntry[] })),
    rootGroup: sync.rootGroup,
    groups: (sync.groups as { name: string; parent: string }[] | null) ?? [],
    periodFrom,
    month,
    sends: sends.map((e) => ({ ledgerName: e.ledgerName, at: e.at.toISOString() })),
  });
  await cacheSet(cacheKey, result, 600);
  return { ...base, periodFrom, recovery: result };
}

const INR0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// Daily job: on the first days of a month, last month's recovery for each
// firm goes to Admin (bell + push), once
export async function sendMonthlyRecoveryReport() {
  const today = istToday();
  if (Number(today.slice(8, 10)) > 3) return { message: "Not the start of a month" };
  const month = addMonths(today.slice(0, 7), -1);
  const title = `Recovery for ${monthName(month)}`;
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  if (!admins.length) return { message: "No Admin" };
  const already = await prisma.notification.findFirst({ where: { title, sentToId: admins[0].id }, select: { id: true } });
  if (already) return { message: "Already sent" };
  const lines: string[] = [];
  for (const entity of DEBTOR_ENTITIES) {
    const { recovery: r } = await recoveryFor(entity, month);
    if (!r) continue;
    const m = r.month;
    lines.push(
      `${ENTITY_LABELS[entity]}: recovered Rs. ${INR0.format(m.recovered)}` +
        (m.recoveryPct == null ? "" : ` (${m.recoveryPct}%)`) +
        ` of Rs. ${INR0.format(m.openingDue + m.billed)} due; billed Rs. ${INR0.format(m.billed)}; dues now Rs. ${INR0.format(m.closingDue)}, over 90 days Rs. ${INR0.format(m.over90)}.`
    );
  }
  if (!lines.length) return { message: "No Tally data" };
  const { sendPushForNotification } = await import("@/lib/web-push");
  for (const a of admins) {
    const n = await prisma.notification.create({ data: { title, content: `${lines.join("\n")}\nDebtors → Recovery shows the details.`, sentById: a.id, sentToId: a.id } });
    await sendPushForNotification(n).catch(() => undefined);
  }
  return { message: `Sent to ${admins.length} Admin(s)` };
}
