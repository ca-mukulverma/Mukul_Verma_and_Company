import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getMyWork } from "@/lib/my-work";

// Everything waiting for the signed-in person (the "My work" page)
export async function GET() {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getMyWork(user.id));
}
