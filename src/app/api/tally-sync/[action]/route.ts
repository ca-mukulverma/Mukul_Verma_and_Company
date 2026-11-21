import { NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import {
  commitSchema,
  commitSync,
  ledgersNeeded,
  planSchema,
  pollAnswer,
  reportSyncError,
  saveLedgers,
  saveSalesMonths,
  salesMonthsNeeded,
  syncAgentFromRequest,
  uploadSchema,
} from "@/lib/tally-debtors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A Tally PC (the Tally extension) sending a firm's Sundry Debtors ledgers,
// with that firm's key (the key tells MVC from B Edge). docs/TALLY_DEBTORS.md
// and src/lib/tally-debtors.ts.

const MAX_BODY = 4 * 1024 * 1024; // gzipped, under Vercel's 4.5 MB
const MAX_JSON = 60 * 1024 * 1024;

const refuse = () => NextResponse.json({ error: "Key not accepted. Connect this PC again from Debtors." }, { status: 401 });

// GET /api/tally-sync/poll – every 30 seconds: what to read, and whether a
// refresh is asked for. Redis only.
export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "poll") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const who = await syncAgentFromRequest(request);
  if (!who) return refuse();
  return NextResponse.json(await pollAnswer(who));
}

// The body as JSON; the extension gzips large ones (X-MVC-Gzip: 1)
async function readBody(request: Request): Promise<unknown> {
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > MAX_BODY) throw new Error("Too large");
  const text = request.headers.get("x-mvc-gzip") === "1" ? gunzipSync(bytes, { maxOutputLength: MAX_JSON }).toString("utf8") : bytes.toString("utf8");
  return JSON.parse(text);
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const who = await syncAgentFromRequest(request);
  if (!who) return refuse();

  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return NextResponse.json({ error: "Send JSON (gzipped, at most 4 MB)" }, { status: 400 });
  }

  switch (action) {
    // Which ledgers changed: { hashes: { name: sha256 } } → { need: [names] }
    case "plan": {
      const parsed = planSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Bad list of ledgers" }, { status: 400 });
      const [need, needMonths] = await Promise.all([ledgersNeeded(who.entity, parsed.data.hashes), salesMonthsNeeded(who.entity, parsed.data.salesHashes)]);
      return NextResponse.json({ need, needMonths });
    }
    // The changed ledgers with their entries
    case "upload": {
      const parsed = uploadSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: `Bad ledgers: ${parsed.error.issues[0]?.message ?? ""}` }, { status: 400 });
      await saveLedgers(who.entity, parsed.data.ledgers);
      await saveSalesMonths(who.entity, parsed.data.salesMonths);
      return NextResponse.json({ ok: true, saved: parsed.data.ledgers.length, months: parsed.data.salesMonths.length });
    }
    // The update is complete: groups, every ledger's name, and when Tally was read
    case "commit": {
      const parsed = commitSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: `Bad update: ${parsed.error.issues[0]?.message ?? ""}` }, { status: 400 });
      await commitSync(who, parsed.data);
      return NextResponse.json({ ok: true });
    }
    // Tally couldn't be read (closed, company not open…): shown on Debtors
    case "error": {
      const message = typeof (body as { message?: unknown })?.message === "string" ? (body as { message: string }).message : "Unknown error";
      await reportSyncError(who.entity, message);
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
