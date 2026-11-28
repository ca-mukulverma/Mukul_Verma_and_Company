import { NextResponse } from "next/server";
import { deskFromRequest } from "@/lib/desk";
import { cleanPack, publishSuspense, siteOrigin } from "@/lib/desk-links";

export const dynamic = "force-dynamic";

// POST /api/desk/suspense – the Desk's bank entries waiting for the client's answer, with the client's ledgers by
// kind: { company, items: [{ref, date, amount, direction, narration, bank}], natures: [{label, ledgers}] }.
// Answers { url } – the phone link for the client (same link every day). Redis only.
export async function POST(request: Request) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  const text = await request.text();
  if (text.length > 1024 * 1024) return NextResponse.json({ error: "List too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }
  const pack = cleanPack(body);
  if ("error" in pack) return NextResponse.json({ error: pack.error }, { status: 400 });
  const token = await publishSuspense(who.code, { ...pack, company: pack.company || who.name });
  return NextResponse.json({ url: `${siteOrigin(request)}/s/${token}`, items: pack.items.length });
}
