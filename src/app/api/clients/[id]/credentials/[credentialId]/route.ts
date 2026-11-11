import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { credentialInput, credentialSelect } from "@/lib/credential-input";

type Params = { params: Promise<{ id: string; credentialId: string }> };

// PATCH /api/clients/[id]/credentials/[credentialId] – change a login (its
// portal, name, username or password): any staff member, as adding. Who
// changed it last is kept and shown with the login.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: clientId, credentialId } = await params;
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = credentialInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the login" }, { status: 400 });

  const existing = await prisma.credential.findFirst({ where: { id: credentialId, clientId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Login not found" }, { status: 404 });
  const updated = await prisma.credential.update({ where: { id: credentialId }, data: { ...parsed.data, updatedById: user.id }, select: credentialSelect });
  return NextResponse.json(updated);
}

// DELETE a specific credential (Admins only)
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: clientId, credentialId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only administrators can delete credentials" }, { status: 403 });
  }
  const { count } = await prisma.credential.deleteMany({ where: { id: credentialId, clientId } });
  if (!count) return NextResponse.json({ error: "Login not found" }, { status: 404 });
  return NextResponse.json({ message: "Credential deleted successfully" });
}
