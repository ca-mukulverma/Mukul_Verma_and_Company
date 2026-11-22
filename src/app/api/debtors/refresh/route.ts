import { NextResponse } from "next/server";
import { askRefresh, debtorsUser, entityParam, notAllowed, syncStatus } from "@/lib/tally-debtors";
import { ENTITY_LABELS } from "@/lib/tally-debtors-shared";

export const dynamic = "force-dynamic";

// POST /api/debtors/refresh { entity } – "Refresh now" for one firm: its Tally
// PC picks this up within a minute and sends that firm's debtors again.
// Redis only.
export async function POST(request: Request) {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  const body = (await request.json().catch(() => null)) as { entity?: unknown } | null;
  const entity = entityParam.safeParse(body?.entity ?? "MVC");
  if (!entity.success) return NextResponse.json({ error: "Choose MVC or B Edge" }, { status: 400 });
  const status = await syncStatus(entity.data);
  if (!status.connected) {
    return NextResponse.json({ error: `No Tally PC is connected for ${ENTITY_LABELS[entity.data]} yet. Admin connects it from Debtors on that PC.` }, { status: 409 });
  }
  // One request is enough while one is waiting
  if (!status.refresh) {
    try {
      await askRefresh(entity.data, user.name);
    } catch {
      return NextResponse.json({ error: "Could not ask the Tally PC just now. Try again in a minute." }, { status: 503 });
    }
  }
  return NextResponse.json(await syncStatus(entity.data));
}
