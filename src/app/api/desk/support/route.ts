import { NextResponse } from "next/server";
import { deskFromRequest } from "@/lib/desk";
import { MAX_SUPPORT_BYTES, saveSupportFile, supportStorageReady, versionFromAgent } from "@/lib/desk-updates";

export const dynamic = "force-dynamic";

// POST /api/desk/support – a support file (logs zip, ≤ 10 MB) from the client's
// PC: multipart "file" + "note". Kept privately; Admin gets a bell notification
// and finds it in Control Centre → Support files. Answer {ok: true, id}.
export async function POST(request: Request) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_SUPPORT_BYTES + 64 * 1024) return NextResponse.json({ error: "File larger than 10 MB" }, { status: 413 });
  if (!supportStorageReady()) {
    return NextResponse.json({ error: "File storage is not set up on the website yet" }, { status: 503 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  const note = typeof form.get("note") === "string" ? (form.get("note") as string) : "";
  const res = await saveSupportFile(who, file, note, versionFromAgent(request.headers.get("user-agent")));
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, id: res.id });
}
