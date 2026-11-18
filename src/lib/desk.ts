import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { createNotification } from "@/lib/notifications";

/**
 * MVC Control Centre (docs/CONTROL_CENTRE.md).
 *
 * The desktop software at each client (e.g. Gudakesa Desk) calls this website
 * on weekdays at 11:30, 13:00, 16:00 and 19:00 IST with its own secret key:
 *   GET  /api/desk/rules   – rules (rates / limits by date) for that client
 *   POST /api/desk/report  – the day's report (19:00 only)
 *
 * Neon cost: the rule pulls and the key check are served from Redis, so only
 * the 19:00 report touches the database, and 13:00–19:00 is inside office use
 * anyway. The missing-report alert runs inside the existing daily job.
 */

const RULES_CACHE = "desk:rules:v1";
const KEY_CACHE = "desk:key:"; // + sha256 -> { id, code, name, active }
const SEEN = "desk:seen:"; // + code -> ISO time of last contact
const DAY = 24 * 60 * 60;

export const DESK_SLOTS = ["11:30", "13:00", "16:00", "19:00"];
export const MAX_REPORT_BYTES = 512 * 1024;

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** A new key: shown to Admin once, only its hash is stored. */
export function newDeskKey() {
  const key = `mvcd_${crypto.randomBytes(24).toString("base64url")}`;
  return { key, keyHash: sha256(key), keyHint: key.slice(-6) };
}

export const CODE_RE = /^[A-Z0-9_-]{2,30}$/;
export const RULE_KEY_RE = /^[A-Z0-9_.]{2,60}$/;

export async function cacheGet<T>(k: string): Promise<T | null> {
  try {
    const v = await redis.get(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null; // Redis down: fall back to the database
  }
}

export async function cacheSet(k: string, v: unknown, ttl = DAY) {
  try {
    await redis.set(k, JSON.stringify(v), "EX", ttl);
  } catch {
    /* cache is optional */
  }
}

export async function cacheDel(...keys: string[]) {
  try {
    if (keys.length) await redis.del(...keys);
  } catch {
    /* cache is optional */
  }
}

export interface DeskIdentity {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

/** The client a request belongs to, from "Authorization: Bearer <key>". Null = refuse. */
export async function deskFromRequest(request: Request): Promise<DeskIdentity | null> {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(mvcd_[A-Za-z0-9_-]{20,64})$/.exec(auth.trim());
  if (!m) return null;
  const hash = sha256(m[1]);
  let who = await cacheGet<DeskIdentity>(KEY_CACHE + hash);
  if (!who) {
    const row = await prisma.deskClient.findUnique({
      where: { keyHash: hash },
      select: { id: true, code: true, name: true, active: true },
    });
    if (!row) return null;
    who = row;
    await cacheSet(KEY_CACHE + hash, who);
  }
  if (!who.active) return null;
  try {
    await redis.set(SEEN + who.code, new Date().toISOString(), "EX", 30 * DAY);
  } catch {
    /* optional */
  }
  return who;
}

/** Forget the cached key check (after switching a client off or giving a new key). */
export async function forgetDeskKey(keyHash: string) {
  await cacheDel(KEY_CACHE + keyHash);
}

export async function lastSeen(codes: string[]): Promise<Record<string, string | null>> {
  if (!codes.length) return {};
  try {
    const vals = await redis.mget(...codes.map((c) => SEEN + c));
    return Object.fromEntries(codes.map((c, i) => [c, vals[i]]));
  } catch {
    return Object.fromEntries(codes.map((c) => [c, null]));
  }
}

type RuleRow = {
  id: number;
  key: string;
  value: Prisma.JsonValue;
  effectiveFrom: string;
  label: string | null;
  unit: string | null;
  notes: string | null;
  clientCodes: string[];
  publishedBy: string;
  publishedAt: string;
};

async function allLiveRules(): Promise<RuleRow[]> {
  const cached = await cacheGet<RuleRow[]>(RULES_CACHE);
  if (cached) return cached;
  const rows = await prisma.deskRule.findMany({
    where: { withdrawn: false },
    orderBy: [{ key: "asc" }, { effectiveFrom: "asc" }],
  });
  const out = rows.map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
    label: r.label,
    unit: r.unit,
    notes: r.notes,
    clientCodes: r.clientCodes,
    publishedBy: r.publishedBy,
    publishedAt: r.publishedAt.toISOString(),
  }));
  await cacheSet(RULES_CACHE, out, 7 * DAY);
  return out;
}

/** Rules for one client: the ones for everybody plus the ones meant for it. */
export async function rulesFor(code: string) {
  const rows = await allLiveRules();
  return rows
    .filter((r) => r.clientCodes.length === 0 || r.clientCodes.includes(code))
    .map((r) => ({ id: r.id, key: r.key, value: r.value, effectiveFrom: r.effectiveFrom, label: r.label, unit: r.unit,
                   notes: r.notes, publishedBy: r.publishedBy, publishedAt: r.publishedAt }));
}

export async function rulesChanged() {
  await cacheDel(RULES_CACHE);
}

// ------------------------------------------------------------------ dates (India time)
export function istToday(now = new Date()) {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** The weekday before the given yyyy-mm-dd (Monday -> Friday). */
export function previousWeekday(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

export const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

// ------------------------------------------------------------------ report
export interface DeskReportBody {
  reportDate: string;
  appVersion?: string;
  pc?: string;
  sentBy?: string;
  summary: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export function checkReport(body: unknown): string | null {
  const b = body as DeskReportBody;
  if (!b || typeof b !== "object") return "Send JSON";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.reportDate ?? "")) return "reportDate must be yyyy-mm-dd";
  const d = asDate(b.reportDate);
  if (Number.isNaN(d.getTime())) return "reportDate is not a date";
  const today = asDate(istToday());
  if (d > today) return "reportDate is in the future";
  if (today.getTime() - d.getTime() > 31 * DAY * 1000) return "reportDate is more than a month old";
  if (!b.summary || typeof b.summary !== "object" || !b.payload || typeof b.payload !== "object")
    return "summary and payload are needed";
  return null;
}

export async function saveReport(who: DeskIdentity, b: DeskReportBody) {
  const reportDate = asDate(b.reportDate);
  const data = {
    appVersion: b.appVersion?.slice(0, 20) ?? null,
    pc: b.pc?.slice(0, 60) ?? null,
    sentBy: b.sentBy?.slice(0, 60) ?? null,
    summary: b.summary as Prisma.InputJsonValue,
    payload: b.payload as Prisma.InputJsonValue,
    receivedAt: new Date(),
  };
  await prisma.$transaction(async (tx) => {
    await tx.deskDailyReport.upsert({
      where: { deskClientId_reportDate: { deskClientId: who.id, reportDate } },
      create: { deskClientId: who.id, reportDate, ...data },
      update: data,
    });
    const cur = await tx.deskClient.findUnique({ where: { id: who.id }, select: { lastReportDate: true } });
    await tx.deskClient.update({
      where: { id: who.id },
      data: {
        appVersion: data.appVersion,
        lastReportAt: new Date(),
        ...(!cur?.lastReportDate || cur.lastReportDate < reportDate ? { lastReportDate: reportDate } : {}),
      },
    });
    await tx.deskEvent.create({
      data: { deskClientId: who.id, kind: "report", detail: `Report for ${b.reportDate} received` },
    });
  });
}

// ------------------------------------------------------------------ daily job: missing reports
/**
 * Runs inside /api/cron/daily (about noon IST). On weekdays, every active
 * client that should report and has no report for the previous weekday gets
 * one alert to each Admin (bell + phone push). Never repeats for the same day.
 */
export async function alertMissingDeskReports(now = new Date()) {
  const today = istToday(now);
  const dow = asDate(today).getUTCDay();
  if (dow === 0 || dow === 6) return { message: "Weekend: no check" };
  const day = previousWeekday(today);
  const dayDate = asDate(day);
  const missing = await prisma.deskClient.findMany({
    where: {
      active: true,
      expectReports: true,
      createdAt: { lt: dayDate },
      reports: { none: { reportDate: dayDate } },
      OR: [{ lastAlertDate: null }, { lastAlertDate: { lt: dayDate } }],
    },
    select: { id: true, code: true, name: true, lastReportDate: true },
  });
  if (!missing.length) return { message: `All clients reported for ${day}` };
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  const names = missing.map((m) => m.name).join(", ");
  for (const a of admins) {
    await createNotification({
      title: `Control Centre: ${missing.length} client(s) did not report`,
      content: `No daily report for ${day} from: ${names}. Open Admin → Control Centre.`,
      sentById: a.id,
      sentToId: a.id,
    });
  }
  await prisma.deskClient.updateMany({ where: { id: { in: missing.map((m) => m.id) } }, data: { lastAlertDate: dayDate } });
  await prisma.deskEvent.createMany({
    data: missing.map((m) => ({ deskClientId: m.id, kind: "missing", detail: `No report for ${day}` })),
  });
  return { message: `Missing for ${day}: ${names}`, missing: missing.map((m) => m.code) };
}
