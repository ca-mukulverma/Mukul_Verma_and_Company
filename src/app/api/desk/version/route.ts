import { NextResponse } from "next/server";
import { deskFromRequest } from "@/lib/desk";
import { latestFor } from "@/lib/desk-updates";

export const dynamic = "force-dynamic";

// GET /api/desk/version – the latest version of the desktop software published
// for this client (or for all): {version, url, sha256, notes, mandatory}, or {}
// when there is none. Asked at every contact; served from Redis.
export async function GET(request: Request) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  return NextResponse.json(await latestFor(who.code));
}
