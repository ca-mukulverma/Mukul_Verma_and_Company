import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

// Control Centre (docs/CONTROL_CENTRE.md) end to end, against a running app
// on a TEST database (never production):
//   BASE=http://localhost:3999 DATABASE_URL=<test db> NEXTAUTH_SECRET=<same as the app> \
//   CRON_SECRET=<same as the app> node --test tests/control-centre/
// It creates its own Admin user and Desk clients, and removes them after.

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { encode } = require("next-auth/jwt");

const BASE = process.env.BASE ?? "http://localhost:3999";
const prisma = new PrismaClient();
const RUN = Date.now().toString(36).toUpperCase();
let cookie = "";
let admin;

const api = async (path, { method = "GET", body, key, raw } = {}) => {
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  else if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, json };
};

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const prevWeekday = (ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
};

before(async () => {
  admin = await prisma.user.create({
    data: { name: `CC Test Admin ${RUN}`, email: `cc-${RUN.toLowerCase()}@test.invalid`, role: "ADMIN" },
  });
  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET,
    token: { id: admin.id, sub: admin.id, name: admin.name, email: admin.email, role: "ADMIN", roleVersion: 1, checkedAt: Date.now() },
  });
  cookie = `next-auth.session-token=${token}`;
});

after(async () => {
  await prisma.deskClient.deleteMany({ where: { code: { endsWith: RUN } } });
  await prisma.deskRule.deleteMany({ where: { notes: `test ${RUN}` } });
  await prisma.notification.deleteMany({ where: { sentToId: admin.id } });
  await prisma.user.delete({ where: { id: admin.id } });
  await prisma.$disconnect();
});

test("only Admin can use the Control Centre APIs", async () => {
  const saved = cookie;
  cookie = "";
  for (const p of ["/api/admin/desk/clients", "/api/admin/desk/rules", "/api/admin/desk/reports"]) {
    assert.equal((await api(p)).status, 403, p);
  }
  cookie = saved;
});

test("add client, key works once shown, rules reach only the right client, report saved", async () => {
  const a = await api("/api/admin/desk/clients", { method: "POST", body: { code: `GK${RUN}`, name: "Gudakesa (test)" } });
  assert.equal(a.status, 201);
  const key = a.json.key;
  assert.match(key, /^mvcd_/);
  const b = await api("/api/admin/desk/clients", { method: "POST", body: { code: `OT${RUN}`, name: "Other (test)" } });
  const otherKey = b.json.key;
  // duplicate code refused
  assert.equal((await api("/api/admin/desk/clients", { method: "POST", body: { code: `GK${RUN}`, name: "x" } })).status, 400);
  // key stored only as a hash
  const row = await prisma.deskClient.findUnique({ where: { code: `GK${RUN}` } });
  assert.notEqual(row.keyHash, key);
  assert.equal(row.keyHint, key.slice(-6));

  // wrong key refused
  assert.equal((await api("/api/desk/rules", { key: "mvcd_" + "x".repeat(32) })).status, 401);
  const r0 = await api("/api/desk/rules", { key });
  assert.equal(r0.status, 200);
  assert.equal(r0.json.client.code, `GK${RUN}`);
  const before = r0.json.rules.length;

  // publish: one rule for all, one only for the other client
  const p1 = await api("/api/admin/desk/rules", {
    method: "POST",
    body: { key: "pf.admin_min", value: "550", effectiveFrom: "2026-12-01", label: "PF admin min", unit: "Rs", notes: `test ${RUN}` },
  });
  assert.equal(p1.status, 201);
  assert.equal(p1.json.rule.key, "PF.ADMIN_MIN");
  const p2 = await api("/api/admin/desk/rules", {
    method: "POST",
    body: { key: "GST.RATE.SERVICES", value: "20", effectiveFrom: "2027-01-01", clientCodes: [`OT${RUN}`], notes: `test ${RUN}` },
  });
  assert.equal(p2.status, 201);
  assert.equal((await api("/api/admin/desk/rules", { method: "POST", body: { key: "X", value: "{bad", effectiveFrom: "2026-01-01" } })).status, 400);

  const mine = (await api("/api/desk/rules", { key })).json.rules;
  assert.equal(mine.length, before + 1, "new rule reaches the client at once (cache cleared on publish)");
  const pf = mine.find((x) => x.id === p1.json.rule.id);
  assert.deepEqual([pf.key, pf.value, pf.effectiveFrom], ["PF.ADMIN_MIN", 550, "2026-12-01"]);
  assert.ok(!mine.some((x) => x.id === p2.json.rule.id), "a rule for another client is not sent");
  assert.ok((await api("/api/desk/rules", { key: otherKey })).json.rules.some((x) => x.id === p2.json.rule.id));

  // withdraw -> gone from the client's list
  await api("/api/admin/desk/rules", { method: "PATCH", body: { id: p1.json.rule.id, withdrawn: true } });
  assert.ok(!(await api("/api/desk/rules", { key })).json.rules.some((x) => x.id === p1.json.rule.id));

  // report
  const day = prevWeekday(istToday());
  const rep = {
    reportDate: day, appVersion: "1.1.0", pc: "TALLY-PC", sentBy: "Deepak",
    summary: { bills: 2, billsTotal: 347354, bankLines: 3, purchases: 0, payrollPosted: 1, errors: 0, pending: 4, users: ["Deepak"] },
    payload: { bills: [{ number: "GTPL/26-27/046", customer: "SOFTMART", total: 188054 }], pending: { bank_lines_to_do: 4 },
               localRules: [{ key: "ESIC.EE_RATE", value: "0.8", effective_from: "2026-11-17", notes: "test", changed_by: "Deepak" }] },
  };
  assert.equal((await api("/api/desk/report", { method: "POST", key, body: rep })).status, 200);
  assert.equal((await api("/api/desk/report", { method: "POST", key, body: { ...rep, summary: { ...rep.summary, bills: 3 } } })).status, 200,
    "sending the same day again replaces it");
  assert.equal((await api("/api/desk/report", { method: "POST", key, body: { ...rep, reportDate: "2099-01-01" } })).status, 400);
  assert.equal((await api("/api/desk/report", { method: "POST", key, raw: "{not json" })).status, 400);
  assert.equal((await api("/api/desk/report", { method: "POST", key, raw: JSON.stringify({ ...rep, payload: { x: "y".repeat(600000) } }) })).status, 413);

  const dayView = await api(`/api/admin/desk/reports?date=${day}`);
  const mineRow = dayView.json.rows.find((x) => x.code === `GK${RUN}`);
  assert.equal(mineRow.report.summary.bills, 3);
  assert.ok(dayView.json.rows.find((x) => x.code === `OT${RUN}`).report === null);
  const full = await api(`/api/admin/desk/reports?id=${mineRow.report.id}`);
  assert.equal(full.json.report.payload.bills[0].number, "GTPL/26-27/046");
  const office = (await api("/api/admin/desk/rules")).json.officeChanges;
  assert.ok(office.some((o) => o.code === `GK${RUN}` && o.key === "ESIC.EE_RATE"), "office rate changes are listed for Admin");

  // switch off -> refused at once; new key -> old key refused, new works
  const id = row.id;
  await api("/api/admin/desk/clients", { method: "PATCH", body: { id, active: false } });
  assert.equal((await api("/api/desk/rules", { key })).status, 401);
  await api("/api/admin/desk/clients", { method: "PATCH", body: { id, active: true } });
  assert.equal((await api("/api/desk/rules", { key })).status, 200);
  const nk = (await api("/api/admin/desk/clients", { method: "PATCH", body: { id, newKey: true } })).json.key;
  assert.equal((await api("/api/desk/rules", { key })).status, 401);
  assert.equal((await api("/api/desk/rules", { key: nk })).status, 200);
  const list = (await api("/api/admin/desk/clients")).json.desks.find((d) => d.id === id);
  assert.ok(list.lastSeen, "last contact is shown");
  assert.ok(list.events.some((e) => /new key/.test(e.detail)));
});

test("daily job alerts Admin once about a client that did not report", async () => {
  const dow = new Date(`${istToday()}T00:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) return; // the check runs on weekdays only
  // the 'other' client existed before the last weekday and sent nothing
  await prisma.deskClient.update({ where: { code: `OT${RUN}` }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  const run = async () => {
    const r = await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const j = await r.json();
    return j.steps.find((s) => s.step === "desk-missing-reports");
  };
  const s1 = await run();
  assert.ok(s1.ok, JSON.stringify(s1));
  assert.ok(s1.result.missing.includes(`OT${RUN}`));
  assert.ok(!s1.result.missing.includes(`GK${RUN}`), "the client that reported is not listed");
  const mine = { sentToId: admin.id, title: { startsWith: "Control Centre" } }; // other daily steps notify Admin too
  const notes = await prisma.notification.findMany({ where: mine });
  assert.equal(notes.length, 1);
  assert.match(notes[0].content, /Other \(test\)/);
  const s2 = await run();
  assert.ok(!(s2.result.missing ?? []).includes(`OT${RUN}`), "not repeated for the same day");
  assert.equal(await prisma.notification.count({ where: mine }), 1);
});
