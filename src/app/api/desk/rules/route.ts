import { NextResponse } from "next/server";
import { deskFromRequest, rulesFor } from "@/lib/desk";

export const dynamic = "force-dynamic";

// GET /api/desk/rules – the desktop software at a client pulls its rules
// (rates / limits by date). Key in "Authorization: Bearer mvcd_…".
// Served from Redis: does not wake the database (docs/CONTROL_CENTRE.md).
export async function GET(request: Request) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  return NextResponse.json({
    client: { code: who.code, name: who.name },
    rules: await rulesFor(who.code),
    serverTime: new Date().toISOString(),
  });
}
