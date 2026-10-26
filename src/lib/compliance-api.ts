import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { ComplianceAccess, getComplianceAccess } from "@/lib/compliance";

// Shared bits of the /api/compliance routes

export async function requireComplianceAccess(
  options: { manager?: boolean } = {}
): Promise<{ access: ComplianceAccess; error?: never } | { access?: never; error: NextResponse }> {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = await getComplianceAccess(user.id);
  if (!access) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (options.manager && !access.isManager) {
    return { error: NextResponse.json({ error: "Only Admins and Partners can do this" }, { status: 403 }) };
  }
  return { access };
}

export const badRequest = (message: string) => NextResponse.json({ error: message }, { status: 400 });
export const forbidden = (message = "You are not on the team for this work") =>
  NextResponse.json({ error: message }, { status: 403 });
export const notFound = (message = "Not found") => NextResponse.json({ error: message }, { status: 404 });

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): { data: z.infer<T>; error?: never } | { data?: never; error: NextResponse } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: badRequest(parsed.error.errors[0]?.message || "Invalid data") };
  return { data: parsed.data };
}

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
export const monthString = z.string().regex(/^\d{4}-\d{2}$/, "Choose a month");
export const money = z.number().min(0).max(1e12);
