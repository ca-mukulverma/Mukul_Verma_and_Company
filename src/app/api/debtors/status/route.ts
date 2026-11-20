import { NextResponse } from "next/server";
import { debtorsUser, entityParam, notAllowed, syncStatus } from "@/lib/tally-debtors";

export const dynamic = "force-dynamic";

// GET /api/debtors/status?entity=MVC|BEDGE – when that firm's Tally data was
// read, whether a refresh is waiting, when its Tally PC last checked in.
// Redis only (asked every few seconds while a refresh runs, so it must not
// wake the database).
export async function GET(request: Request) {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  const entity = entityParam.safeParse(new URL(request.url).searchParams.get("entity") ?? "MVC");
  if (!entity.success) return NextResponse.json({ error: "Choose MVC or B Edge" }, { status: 400 });
  return NextResponse.json(await syncStatus(entity.data));
}
