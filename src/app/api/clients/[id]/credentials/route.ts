import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { credentialInput, credentialSelect } from "@/lib/credential-input";
import { PORTAL_KINDS } from "@/lib/credential-kinds";

// GET /api/clients/[id]/credentials – the client's logins, portals first in
// their order, then other logins by name
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Passwords: signed-in staff only (the middleware skips /api routes)
  if (!getSessionUser(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: clientId } = await params;
  if (!clientId) return NextResponse.json({ error: "Client ID is required" }, { status: 400 });

  try {
    const credentials = await prisma.credential.findMany({ where: { clientId }, select: credentialSelect, orderBy: [{ title: "asc" }, { createdAt: "asc" }] });
    const order = (kind: string) => {
      const i = (PORTAL_KINDS as readonly string[]).indexOf(kind);
      return i < 0 ? PORTAL_KINDS.length : i;
    };
    credentials.sort((a, b) => order(a.kind) - order(b.kind));
    return NextResponse.json({ credentials });
  } catch (error) {
    console.error("Error fetching credentials:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to fetch credentials" }, { status: 500 });
  }
}

// POST /api/clients/[id]/credentials { kind, title?, username, password } –
// any staff member; "Other" needs its title. Who added it is kept.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = credentialInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the login" }, { status: 400 });

  try {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const created = await prisma.credential.create({ data: { ...parsed.data, clientId, updatedById: user.id }, select: credentialSelect });
    return NextResponse.json(created);
  } catch (error) {
    console.error("Error adding credential:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to add credential" }, { status: 500 });
  }
}
