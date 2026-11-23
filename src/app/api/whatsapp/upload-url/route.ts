import { NextResponse } from "next/server";
import { fileUploadUrl, listenerFromRequest } from "@/lib/wa-intake";

export const dynamic = "force-dynamic";

// POST /api/whatsapp/upload-url – the listener on the office PC asks for a
// 10-minute link and PUTs the file straight to R2 (never through Vercel).
// Body { fileName, contentType }. No database call.
export async function POST(request: Request) {
  if (!(await listenerFromRequest(request))) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const fileName = String(b.fileName ?? "").trim();
  if (!fileName) return NextResponse.json({ error: "fileName is needed" }, { status: 400 });
  try {
    return NextResponse.json(await fileUploadUrl(fileName, String(b.contentType ?? "")));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "R2 not set up" }, { status: 503 });
  }
}
