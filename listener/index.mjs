// MVC WhatsApp listener (docs/WHATSAPP_INTAKE.md)
//
// Runs on MVC's office PC, logged in as the firm's dedicated WhatsApp number (a
// "linked device", like WhatsApp Web). It READS the client groups the number is
// in and never sends anything. Every message is written to a queue file on this
// PC at once (nothing is lost if the internet or the website is down); files go
// straight to the app's private R2 storage. The queue is sent to the MV Company
// app in batches: every 30 minutes 11:00-20:00 IST on weekdays, and once after
// 20:00 (with the evening summary). That keeps the app's database asleep.
//
// First start: a QR code appears - on the dedicated number's phone, WhatsApp >
// Linked devices > Link a device, scan it. Keep that phone charged and online.

import fs from "node:fs";
import path from "node:path";
import makeWASocket, { DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";

// ------------------------------------------------------------------ settings (.env next to this file)
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
for (const line of (fs.existsSync(path.join(HERE, ".env")) ? fs.readFileSync(path.join(HERE, ".env"), "utf8") : "").split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const APP_URL = (process.env.APP_URL || "https://mvcompany.vercel.app").replace(/\/$/, "");
const KEY = process.env.WA_LISTENER_KEY || "";
const DATA = process.env.DATA_DIR || path.join(HERE, "data");
const BATCH_MINUTES = Number(process.env.BATCH_MINUTES || 30);
if (KEY.length < 20) {
  console.error("Set WA_LISTENER_KEY in .env (the same value as in Vercel).");
  process.exit(1);
}
fs.mkdirSync(DATA, { recursive: true });
const QUEUE = path.join(DATA, "queue.jsonl");
const STATE = path.join(DATA, "state.json");
const log = pino({ level: "warn" });
const say = (...a) => console.log(new Date().toLocaleString("en-IN"), ...a);

// ------------------------------------------------------------------ the queue on disk
function queued() {
  if (!fs.existsSync(QUEUE)) return [];
  return fs.readFileSync(QUEUE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function enqueue(m) {
  fs.appendFileSync(QUEUE, JSON.stringify(m) + "\n");
}
function keepOnly(rest) {
  fs.writeFileSync(QUEUE, rest.map((m) => JSON.stringify(m)).join("\n") + (rest.length ? "\n" : ""));
}
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { lastSent: 0, endOfDay: "" };
const saveState = () => fs.writeFileSync(STATE, JSON.stringify(state));

// ------------------------------------------------------------------ talking to the app
async function call(p, body) {
  const r = await fetch(APP_URL + p, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "User-Agent": "MVC-WhatsApp-Listener/1.0" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${p} answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function uploadFile(fileName, contentType, bytes) {
  const { key, url } = await call("/api/whatsapp/upload-url", { fileName, contentType });
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType || "application/octet-stream" }, body: bytes });
  if (!r.ok) throw new Error(`upload answered ${r.status}`);
  return key;
}

async function sendBatch(endOfDay) {
  const all = queued();
  if (!all.length && !endOfDay) return;
  for (let i = 0; i < Math.max(all.length, 1); i += 500) {
    const part = all.slice(i, i + 500);
    const res = await call("/api/whatsapp/batch", { messages: part, endOfDay: endOfDay && i + 500 >= all.length });
    say(`batch sent: ${part.length} message(s)`, JSON.stringify(res));
  }
  keepOnly(queued().slice(all.length)); // anything that arrived while sending stays for next time
  state.lastSent = Date.now();
  saveState();
}

// ------------------------------------------------------------------ when to send (India time)
function ist(now = new Date()) {
  const t = new Date(now.getTime() + 330 * 60 * 1000);
  return { day: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
let sending = false;
setInterval(async () => {
  if (sending) return;
  const t = ist();
  const office = t.weekday >= 1 && t.weekday <= 5 && t.minutes >= 11 * 60 && t.minutes < 20 * 60;
  const due = office && Date.now() - state.lastSent >= BATCH_MINUTES * 60 * 1000 && queued().length > 0;
  const evening = t.minutes >= 20 * 60 + 5 && state.endOfDay !== t.day;
  if (!due && !evening) return;
  sending = true;
  try {
    await sendBatch(evening);
    if (evening) {
      state.endOfDay = t.day;
      saveState();
    }
  } catch (e) {
    say("could not send, will try again:", e.message);
  } finally {
    sending = false;
  }
}, 60 * 1000);

// ------------------------------------------------------------------ WhatsApp (read-only)
const groupNames = new Map();
async function groupName(sock, jid) {
  if (!groupNames.has(jid)) {
    try {
      groupNames.set(jid, (await sock.groupMetadata(jid)).subject);
    } catch {
      groupNames.set(jid, jid);
    }
  }
  return groupNames.get(jid);
}

function unwrap(message) {
  let m = message || {};
  for (const k of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "documentWithCaptionMessage", "editedMessage"]) {
    if (m[k]?.message) m = m[k].message;
  }
  return m;
}

const MEDIA = {
  imageMessage: ["image.jpg", "image/jpeg"],
  documentMessage: ["document", "application/octet-stream"],
  audioMessage: ["voice.ogg", "audio/ogg"],
  videoMessage: ["video.mp4", "video/mp4"],
};

async function start() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(path.join(DATA, "auth"));
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth, logger: log, markOnlineOnConnect: false, syncFullHistory: false, browser: ["MVC Listener", "Chrome", "1.0"] });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      say("Scan this with the dedicated number's phone: WhatsApp > Linked devices > Link a device");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") say("connected - listening to the groups (read-only)");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        say("LOGGED OUT: the number was unlinked. Delete the folder", path.join(DATA, "auth"), "and start again to scan a new QR.");
        process.exit(2);
      }
      say("connection closed, reconnecting in 10 s", code ?? "");
      setTimeout(start, 10_000);
    }
  });
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      const jid = msg.key?.remoteJid || "";
      if (!jid.endsWith("@g.us") || !msg.message) continue; // groups only
      const m = unwrap(msg.message);
      const text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.documentMessage?.caption || m.videoMessage?.caption || "";
      const mediaType = Object.keys(MEDIA).find((k) => m[k]);
      if (!text && !mediaType) continue; // reactions, polls, protocol messages
      const sender = (msg.key.participant || msg.participant || "").split("@")[0].split(":")[0];
      const out = {
        waId: msg.key.id,
        groupJid: jid,
        groupName: await groupName(sock, jid),
        senderPhone: msg.key.fromMe ? (sock.user?.id || "").split(":")[0] : sender,
        senderName: msg.pushName || undefined,
        sentAt: new Date(Number(msg.messageTimestamp) * 1000).toISOString(),
        text: text || undefined,
      };
      if (mediaType) {
        const [defName, defType] = MEDIA[mediaType];
        const fileName = m[mediaType].fileName || `${out.sentAt.slice(0, 10)}_${defName}`;
        try {
          const bytes = await downloadMediaMessage(msg, "buffer", {}, { logger: log, reuploadRequest: sock.updateMediaMessage });
          out.fileKey = await uploadFile(fileName, m[mediaType].mimetype || defType, bytes);
          out.fileName = fileName;
          out.fileSize = bytes.length;
        } catch (e) {
          out.fileName = fileName;
          out.text = `${text}\n[file could not be saved by the listener: ${e.message}]`.trim();
        }
      }
      enqueue(out);
      say(`${out.groupName}: ${out.senderName || out.senderPhone}: ${(out.fileName ? `[${out.fileName}] ` : "") + (text || "").slice(0, 60)}`);
    }
  });
}

say(`MVC WhatsApp listener - app ${APP_URL}, data in ${DATA}, ${queued().length} message(s) waiting`);
start().catch((e) => {
  console.error(e);
  process.exit(1);
});
