// Unit test of the WhatsApp intake's pure helpers (no database, no Redis).
// Run: node --experimental-strip-types tests/whatsapp/classify.test.mjs   (Node 22.6+)
import assert from "node:assert/strict";
import test from "node:test";
import { classify, last10, officeMinutes } from "../../src/lib/wa-classify.ts";

test("client messages are sorted without AI", () => {
  assert.deepEqual(classify("ACKO ka bill bana do 3 licence", false, false), { kind: "REQUEST", status: "NEW" });
  assert.deepEqual(classify("Please send the ledger", false, false), { kind: "REQUEST", status: "NEW" });
  assert.deepEqual(classify("GST kitna payable hai?", false, false), { kind: "QUERY", status: "NEW" });
  assert.deepEqual(classify("ok 👍", false, false), { kind: "CHAT", status: "CLOSED" });
  assert.deepEqual(classify("🙏", false, false), { kind: "CHAT", status: "CLOSED" });
  assert.deepEqual(classify("Paid GST today", false, false), { kind: "INFO", status: "INFO" });
  assert.deepEqual(classify("Nov statement", true, false), { kind: "DOCUMENT", status: "FILED" });
  assert.deepEqual(classify("is PO ka bill bana do", true, false), { kind: "REQUEST", status: "NEW" });
  assert.deepEqual(classify("", true, false), { kind: "DOCUMENT", status: "FILED" });
  assert.deepEqual(classify("will do", false, true), { kind: "STAFF", status: "CLOSED" });
});

test("phone numbers compare on the last 10 digits", () => {
  assert.equal(last10("+91 98260-12345"), "9826012345");
  assert.equal(last10("919826012345@s.whatsapp.net"), "9826012345");
});

test("office minutes: weekdays 11:00-20:00 IST only", () => {
  const ist = (s) => new Date(`${s}+05:30`);
  assert.equal(officeMinutes(ist("2026-11-23T10:00:00"), ist("2026-11-23T14:00:00")), 180); // Mon, from 11:00
  assert.equal(officeMinutes(ist("2026-11-23T19:00:00"), ist("2026-11-24T12:00:00")), 120); // 1 h Mon + 1 h Tue
  assert.equal(officeMinutes(ist("2026-11-27T19:30:00"), ist("2026-11-30T11:30:00")), 60); // Fri 30 min + Mon 30 min
  assert.equal(officeMinutes(ist("2026-11-28T12:00:00"), ist("2026-11-29T18:00:00")), 0); // weekend
});
