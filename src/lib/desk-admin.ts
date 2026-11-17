import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";

/** Control Centre pages and APIs are for Admin only. */
export async function requireDeskAdmin() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" ? user : null;
}

export const onlyAdmin = () => NextResponse.json({ error: "Only Admin can use the Control Centre" }, { status: 403 });
export const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
