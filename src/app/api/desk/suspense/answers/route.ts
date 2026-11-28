import { NextResponse } from "next/server";
import { deskFromRequest } from "@/lib/desk";
import { answersFor } from "@/lib/desk-links";

export const dynamic = "force-dynamic";

// GET /api/desk/suspense/answers – what the client answered on the phone link: [{ref, nature, ledger, note, at}].
export async function GET(request: Request) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  return NextResponse.json({ answers: await answersFor(who.code) });
}
