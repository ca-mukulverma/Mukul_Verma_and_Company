import path from "node:path";

// Settings from .env (see .env.example)

export interface Config {
  appUrl: string;
  helperKey: string;
  helperName: string;
  // 1 = Monday … 7 = Sunday
  activeDays: Set<number>;
  // Minutes after midnight, this PC's clock
  activeFrom: number;
  activeTo: number;
  pollSeconds: number;
  downloadDir: string;
  keepLocalCopies: boolean;
  loginWaitMinutes: number;
  jsonReadyMinutes: number;
  jsonMaxWaitMinutes: number;
  jsonCheckEveryMinutes: number;
  // Pause between clicks on the portal, in ms
  clickPauseMs: [number, number];
}

type Env = Record<string, string | undefined>;

function number(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number (got "${raw}")`);
  return value;
}

// "1-6" or "1,2,3,5"
export function parseDays(text: string): Set<number> {
  const days = new Set<number>();
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const range = part.match(/^([1-7])\s*-\s*([1-7])$/);
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) days.add(d);
    } else if (/^[1-7]$/.test(part)) {
      days.add(Number(part));
    } else {
      throw new Error(`ACTIVE_DAYS: "${part}" is not a day (1 = Monday … 7 = Sunday)`);
    }
  }
  return days;
}

// "10:00-20:00" → [600, 1200]
export function parseHours(text: string): [number, number] {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`ACTIVE_HOURS must look like 10:00-20:00 (got "${text}")`);
  const from = Number(m[1]) * 60 + Number(m[2]);
  const to = Number(m[3]) * 60 + Number(m[4]);
  if (from >= to || to > 24 * 60) throw new Error(`ACTIVE_HOURS: the start must be before the end (got "${text}")`);
  return [from, to];
}

export function loadConfig(env: Env = process.env): Config {
  const appUrl = (env.PORTAL_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(appUrl)) throw new Error("Set PORTAL_URL in .env to the office app's address, e.g. https://mvcompany.vercel.app");
  const helperKey = (env.GST_HELPER_KEY ?? "").trim();
  if (helperKey.length < 32) throw new Error("Set GST_HELPER_KEY in .env (the same value as in Vercel, at least 32 characters)");
  const [activeFrom, activeTo] = parseHours(env.ACTIVE_HOURS || "10:00-20:00");
  const pause = (env.CLICK_PAUSE_MS || "2000-5000").split("-").map(Number);
  return {
    appUrl,
    helperKey,
    helperName: (env.HELPER_NAME || "GST helper").trim().slice(0, 60),
    activeDays: parseDays(env.ACTIVE_DAYS || "1-6"),
    activeFrom,
    activeTo,
    pollSeconds: Math.max(5, number(env, "POLL_SECONDS", 60)),
    downloadDir: path.resolve(env.DOWNLOAD_DIR || "./downloads"),
    keepLocalCopies: /^(1|true|yes)$/i.test(env.KEEP_LOCAL_COPIES ?? ""),
    loginWaitMinutes: number(env, "LOGIN_WAIT_MINUTES", 10),
    jsonReadyMinutes: number(env, "JSON_READY_MINUTES", 20),
    jsonMaxWaitMinutes: number(env, "JSON_MAX_WAIT_MINUTES", 45),
    jsonCheckEveryMinutes: number(env, "JSON_CHECK_EVERY_MINUTES", 3),
    clickPauseMs: [pause[0] || 0, pause[1] ?? pause[0] ?? 0],
  };
}

// ISO weekday: 1 = Monday … 7 = Sunday
const isoDay = (date: Date) => date.getDay() || 7;

export function isActiveTime(config: Config, date = new Date()): boolean {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return config.activeDays.has(isoDay(date)) && minutes >= config.activeFrom && minutes < config.activeTo;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
