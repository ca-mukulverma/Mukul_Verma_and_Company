import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

// Control Centre: app updates and support files (docs/CONTROL_CENTRE.md), end
// to end against a running app on a TEST database (never production). GitHub is
// replaced by a small fake on FAKE_GITHUB_PORT, so start the app with
//   GITHUB_API_URL=http://127.0.0.1:3998 GITHUB_DESK_TOKEN=test-gh-token
//   DESK_SUPPORT_LOCAL_DIR=<a temp folder>   (or R2 settings)
// then:
//   BASE=http://localhost:3999 DATABASE_URL=<test db> NEXTAUTH_SECRET=<same as the app> \
//   node --test tests/control-centre/updates.test.mjs

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { encode } = require("next-auth/jwt");

const BASE = process.env.BASE ?? "http://localhost:3999";
const GH_PORT = Number(process.env.FAKE_GITHUB_PORT ?? 3998);
const GH_TOKEN = process.env.GITHUB_DESK_TOKEN ?? "test-gh-token";
const prisma = new PrismaClient();
const RUN = Date.now().toString(36).toUpperCase();
let cookie = "";
let admin;
let keyA;
let keyB;

// ------------------------------------------------------------------ fake GitHub
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const bytes = { 120: crypto.randomBytes(3 * 1024 * 1024 + 17), 130: crypto.randomBytes(200_000) };
const releases = [
  { id: 1, tag_name: "v7.1.0", assets: [{ id: 120, name: "GudakesaDesk_Setup_7.1.0.exe", size: bytes[120].length }] },
  { id: 2, tag_name: "v7.2.0",
    assets: [{ id: 130, name: "GudakesaDesk_Setup_7.2.0.exe", size: bytes[130].length, digest: `sha256:${sha(bytes[130])}` }] },
  { id: 3, tag_name: "v7.3.0", assets: [] }, // build still running
].map((r) => ({ ...r, name: `Gudakesa Desk ${r.tag_name.slice(1)}`, draft: false, prerelease: false,
                published_at: "2026-11-18T05:00:00Z", html_url: `https://github.example/${r.tag_name}` }));
const seenAuth = []; // every Authorization header GitHub received
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  seenAuth.push(req.headers.authorization ?? "");
  const signed = /^\/signed\/(\d+)$/.exec(url.pathname);
  if (signed) {
    // like GitHub's real signed links: no token needed, and refuses one
    if (req.headers.authorization) return res.writeHead(400).end("no auth on signed links");
    const b = bytes[signed[1]];
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": b.length });
    return res.end(b);
  }
  if (req.headers.authorization !== `Bearer ${GH_TOKEN}`) return res.writeHead(401).end("{}");
  const repo = "/repos/ca-mukulverma/gudakesa-desk";
  if (url.pathname === `${repo}/releases`) return res.writeHead(200).end(JSON.stringify(releases));
  const tag = new RegExp(`^${repo}/releases/tags/(.+)$`).exec(url.pathname);
  if (tag) {
    const r = releases.find((x) => x.tag_name === decodeURIComponent(tag[1]));
    return r ? res.writeHead(200).end(JSON.stringify(r)) : res.writeHead(404).end("{}");
  }
  const asset = new RegExp(`^${repo}/releases/assets/(\\d+)$`).exec(url.pathname);
  if (asset && req.headers.accept === "application/octet-stream" && bytes[asset[1]]) {
    res.writeHead(302, { location: `http://127.0.0.1:${GH_PORT}/signed/${asset[1]}?sig=abc` });
    return res.end();
  }
  res.writeHead(404).end("{}");
});

// ------------------------------------------------------------------ helpers
const api = async (path, { method = "GET", body, key, form } = {}) => {
  const headers = {};
  if (!form) headers["content-type"] = "application/json";
  if (key) headers.authorization = `Bearer ${key}`;
  else if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString());
  } catch {
    /* not JSON */
  }
  return { status: r.status, json, buf, headers: r.headers };
};

const zip = (size) => {
  const b = crypto.randomBytes(size);
  b.write("PK\x03\x04", 0, "latin1");
  return b;
};
const supportForm = (b, note, name = "support_20261118_1030.zip") => {
  const f = new FormData();
  f.append("file", new Blob([b], { type: "application/zip" }), name);
  f.append("note", note);
  return f;
};

before(async () => {
  await new Promise((ok) => fake.listen(GH_PORT, "127.0.0.1", ok));
  admin = await prisma.user.create({
    data: { name: `CC Upd Admin ${RUN}`, email: `ccu-${RUN.toLowerCase()}@test.invalid`, role: "ADMIN" },
  });
  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET,
    token: { id: admin.id, sub: admin.id, name: admin.name, email: admin.email, role: "ADMIN", roleVersion: 1, checkedAt: Date.now() },
  });
  cookie = `next-auth.session-token=${token}`;
  keyA = (await api("/api/admin/desk/clients", { method: "POST", body: { code: `UA${RUN}`, name: "Update A (test)" } })).json.key;
  keyB = (await api("/api/admin/desk/clients", { method: "POST", body: { code: `UB${RUN}`, name: "Update B (test)" } })).json.key;
});

after(async () => {
  // withdraw through the API first, so the cached list of versions is cleared too
  for (const r of await prisma.deskRelease.findMany({ where: { notes: { contains: RUN }, withdrawn: false } })) {
    await api("/api/admin/desk/updates", { method: "PATCH", body: { id: r.id, withdrawn: true } });
  }
  await prisma.deskRelease.deleteMany({ where: { notes: { contains: RUN } } });
  await prisma.deskClient.deleteMany({ where: { code: { endsWith: RUN } } });
  await prisma.notification.deleteMany({ where: { sentToId: admin.id } });
  await prisma.user.delete({ where: { id: admin.id } });
  await prisma.$disconnect();
  fake.close();
});

test("only Admin can use the Updates and Support files APIs", async () => {
  const saved = cookie;
  cookie = "";
  for (const p of ["/api/admin/desk/updates", "/api/admin/desk/support"]) assert.equal((await api(p)).status, 403, p);
  cookie = saved;
});

test("version check, publish, download and withdraw", async () => {
  // a key is needed
  assert.equal((await api("/api/desk/version")).status, 401);
  assert.equal((await api("/api/desk/version", { key: "mvcd_" + "x".repeat(32) })).status, 401);
  // nothing published -> {} (the desktop app reads that as "no update")
  const none = await api("/api/desk/version", { key: keyA });
  assert.equal(none.status, 200);
  if (!(await prisma.deskRelease.count({ where: { withdrawn: false } }))) assert.deepEqual(none.json, {});

  // Admin sees GitHub's builds
  const list = await api("/api/admin/desk/updates");
  assert.equal(list.status, 200);
  assert.equal(list.json.githubError, null);
  assert.deepEqual(list.json.github.map((g) => [g.version, !!g.installer]), [["7.1.0", true], ["7.2.0", true], ["7.3.0", false]]);

  // publish 7.1.0 to all: SHA-256 worked out by the website (GitHub gave none)
  const p1 = await api("/api/admin/desk/updates", { method: "POST", body: { version: "v7.1.0", notes: `Faster bank import ${RUN}` } });
  assert.equal(p1.status, 201, JSON.stringify(p1.json));
  assert.equal(p1.json.release.sha256, sha(bytes[120]));
  assert.equal(p1.json.release.assetName, "GudakesaDesk_Setup_7.1.0.exe");
  assert.equal((await api("/api/admin/desk/updates", { method: "POST", body: { version: "7.1.0", notes: RUN } })).status, 400, "twice");
  assert.match((await api("/api/admin/desk/updates", { method: "POST", body: { version: "7.3.0", notes: RUN } })).json.error, /no GudakesaDesk_Setup_7.3.0.exe/);
  assert.match((await api("/api/admin/desk/updates", { method: "POST", body: { version: "9.9.9", notes: RUN } })).json.error, /no release v9.9.9/);
  assert.equal((await api("/api/admin/desk/updates", { method: "POST", body: { version: "abc" } })).status, 400);

  // the answer the desktop app expects (gudakesa-desk docs/UPDATES.md §4)
  const vA = await api("/api/desk/version", { key: keyA });
  assert.deepEqual(vA.json, {
    version: "7.1.0", url: "/api/desk/download?v=7.1.0", sha256: sha(bytes[120]), notes: `Faster bank import ${RUN}`, mandatory: false,
  });

  // 7.2.0 only for client B (SHA-256 from GitHub's digest), marked important
  const p2 = await api("/api/admin/desk/updates", {
    method: "POST", body: { version: "7.2.0", notes: `B only ${RUN}`, mandatory: true, clientCodes: [`ub${RUN}`] },
  });
  assert.equal(p2.status, 201);
  assert.equal((await api("/api/desk/version", { key: keyA })).json.version, "7.1.0", "A does not see B's version");
  const vB = (await api("/api/desk/version", { key: keyB })).json;
  assert.deepEqual([vB.version, vB.sha256, vB.mandatory], ["7.2.0", sha(bytes[130]), true]);

  // download: bytes match the check-sum; only a key that may see the version
  const before = seenAuth.length;
  const d = await api(vA.json.url, { key: keyA });
  assert.equal(d.status, 200);
  assert.equal(sha(d.buf), vA.json.sha256);
  assert.ok(!seenAuth.slice(before).some((a) => a.includes("mvcd_")), "the client's key never reaches GitHub");
  assert.equal((await api("/api/desk/download?v=7.2.0", { key: keyA })).status, 404, "A may not download B's version");
  assert.equal((await api("/api/desk/download?v=7.1.0")).status, 401);
  assert.equal((await api("/api/desk/download?v=../x", { key: keyA })).status, 400);
  assert.equal(sha((await api("/api/desk/download?v=7.2.0", { key: keyB })).buf), sha(bytes[130]));
  // the redirect link carries no GitHub token
  const raw = await fetch(`${BASE}/api/desk/download?v=7.1.0`, { headers: { authorization: `Bearer ${keyA}` }, redirect: "manual" });
  assert.equal(raw.status, 302);
  assert.ok(!(raw.headers.get("location") ?? "").includes(GH_TOKEN));

  // withdraw 7.2.0 -> B is back on 7.1.0 and cannot download 7.2.0
  await api("/api/admin/desk/updates", { method: "PATCH", body: { id: p2.json.release.id, withdrawn: true } });
  assert.equal((await api("/api/desk/version", { key: keyB })).json.version, "7.1.0");
  assert.equal((await api("/api/desk/download?v=7.2.0", { key: keyB })).status, 404);
  const events = await prisma.deskEvent.findMany({ where: { deskClient: { code: `UA${RUN}` }, kind: "download" } });
  assert.ok(events.length >= 1, "downloads are logged");
});

test("support file: stored privately, Admin notified, download and delete", async () => {
  const b = zip(150_000);
  assert.equal((await api("/api/desk/support", { method: "POST", form: supportForm(b, "x") })).status, 401);
  const s = await api("/api/desk/support", { method: "POST", key: keyA, form: supportForm(b, `Bank import stops ${RUN}`) });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.ok, true);
  assert.ok(s.json.id);
  assert.equal((await api("/api/desk/support", { method: "POST", key: keyA, form: supportForm(Buffer.from("not a zip"), "") })).status, 400);
  assert.equal((await api("/api/desk/support", { method: "POST", key: keyA, form: supportForm(zip(10 * 1024 * 1024 + 1), "") })).status, 413);

  const note = await prisma.notification.findFirst({ where: { sentToId: admin.id, title: { contains: "support file from Update A (test)" } } });
  assert.ok(note, "bell notification to Admin");
  const files = (await api("/api/admin/desk/support")).json.files;
  const f = files.find((x) => x.id === s.json.id);
  assert.equal(f.deskClient.code, `UA${RUN}`);
  assert.equal(f.size, b.length);
  assert.match(f.note, /Bank import stops/);
  const got = await api(`/api/admin/desk/support?id=${f.id}`);
  assert.equal(got.status, 200);
  assert.equal(sha(got.buf), sha(b));
  assert.equal((await api(`/api/admin/desk/support?id=${f.id}`, { method: "DELETE" })).status, 200);
  assert.ok(!(await api("/api/admin/desk/support")).json.files.some((x) => x.id === f.id));
});

// The real desktop client (gudakesa-desk gk/update.py) against these endpoints.
// Runs when GK_DESK_REPO points at a checkout of the gudakesa-desk repository.
test("Gudakesa Desk's own update code: check, download with check-sum, send support file", { skip: !process.env.GK_DESK_REPO }, async () => {
  const { execFile } = await import("node:child_process");
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gk-client-"));
  const script = `
import json, os, sys, hashlib
sys.path.insert(0, os.environ["GK_DESK_REPO"])
from gk import update
class DB:
    data_dir = os.environ["APPDATA"]
    def __init__(self): self.s = {"_central_key": os.environ["KEY"], "Control Centre URL": os.environ["BASE"]}
    def settings(self): return dict(self.s)
    def set_setting(self, k, v): self.s[k] = v
    def log(self, *a): pass
    def q(self, *a): return []
db = DB()
info = update.check(db)
setup = update.download(db, info)
digest = hashlib.sha256(open(setup, "rb").read()).hexdigest()
os.remove(setup)
sent = update.send_support(db, "sent by the test")
print(json.dumps({"info": info, "digest": digest, "available": update.available(db), "zip": os.path.basename(sent)}))
`;
  // not execFileSync: the fake GitHub above runs in this process and must keep answering
  const out = await new Promise((ok, fail) =>
    execFile(process.env.PYTHON ?? "python", ["-I", "-c", script],
      { env: { ...process.env, KEY: keyA, BASE, APPDATA: tmp, PYTHONIOENCODING: "utf-8" } },
      (err, stdout, stderr) => (err ? fail(new Error(stderr || err.message)) : ok(stdout))));
  const r = JSON.parse(out.trim().split("\n").pop());
  assert.equal(r.info.version, "7.1.0");
  assert.equal(r.digest, sha(bytes[120]), "installer downloaded and check-sum accepted by the desktop app");
  assert.equal(r.available.version, "7.1.0", "the app would show 'Update 7.1.0 – Install'");
  const files = (await api("/api/admin/desk/support")).json.files;
  assert.ok(files.some((f) => f.deskClient.code === `UA${RUN}` && f.note === "sent by the test" && f.fileName === r.zip));
  fs.rmSync(tmp, { recursive: true, force: true });
});
