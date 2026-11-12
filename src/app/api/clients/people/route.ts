import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClientPhone, clientPhones } from "@/lib/client-contacts";

// A person already saved on a client, as an owner or as the responsible person
export interface SavedPerson {
  key: string;
  name: string;
  phones: ClientPhone[];
  email: string | null;
  // The clients this person is on, e.g. "ABC Traders (owner)"
  clients: string[];
}

const digits = (text: string | null | undefined) => (text ?? "").replace(/\D/g, "").slice(-10);

// GET /api/clients/people?q= – owners and responsible persons of saved clients
// whose name or mobile number matches, so their details can be copied into
// another client's form. Each person appears once, with every client they are on.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ people: [] });
  const excludeId = new URL(request.url).searchParams.get("exclude");

  const qDigits = q.replace(/\D/g, "");
  const byNumber = qDigits.length >= 4;
  const select = {
    id: true,
    contactPerson: true,
    companyName: true,
    email: true,
    phone: true,
    phones: true,
    ownerIsResponsible: true,
    responsibleName: true,
    responsiblePhone: true,
    responsibleEmail: true,
  } satisfies Prisma.ClientSelect;

  // Numbers are compared on their digits, as they are saved with spaces
  const numberIds = byNumber
    ? (
        await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Client"
          WHERE regexp_replace(coalesce(phone, '') || ' ' || coalesce("responsiblePhone", '') || ' ' || coalesce(phones::text, ''), '[^0-9]', '', 'g')
            LIKE ${"%" + qDigits + "%"}
          LIMIT 60`
      ).map((row) => row.id)
    : [];

  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { contactPerson: { contains: q, mode: "insensitive" } },
        { responsibleName: { contains: q, mode: "insensitive" } },
        ...(numberIds.length ? [{ id: { in: numberIds } }] : []),
      ],
      ...(excludeId && { id: { not: excludeId } }),
    },
    select,
    take: 80,
    orderBy: { updatedAt: "desc" },
  });

  const qLower = q.toLowerCase();
  const matches = (name: string | null, numbers: string[]) =>
    (!!name && name.toLowerCase().includes(qLower)) || (byNumber && numbers.some((n) => n.replace(/\D/g, "").includes(qDigits)));

  const people = new Map<string, SavedPerson>();
  const add = (name: string, phones: ClientPhone[], email: string | null, clientLabel: string) => {
    const key = `${name.trim().toLowerCase()}|${digits(phones[0]?.number)}`;
    const existing = people.get(key);
    if (existing) {
      if (!existing.clients.includes(clientLabel)) existing.clients.push(clientLabel);
      if (!existing.email && email) existing.email = email;
      for (const p of phones) {
        if (!existing.phones.some((e) => digits(e.number) === digits(p.number))) existing.phones.push(p);
      }
      return;
    }
    people.set(key, { key, name: name.trim(), phones: [...phones], email, clients: [clientLabel] });
  };

  for (const client of clients) {
    const firm = client.companyName || client.contactPerson;
    const ownerPhones = clientPhones(client);
    if (matches(client.contactPerson, ownerPhones.map((p) => p.number))) {
      add(client.contactPerson, ownerPhones, client.email?.trim() || null, `${firm} (owner)`);
    }
    if (!client.ownerIsResponsible && client.responsibleName && matches(client.responsibleName, [client.responsiblePhone ?? ""])) {
      add(
        client.responsibleName,
        client.responsiblePhone ? [{ number: client.responsiblePhone, label: "Owner", whatsapp: true }] : [],
        client.responsibleEmail?.trim() || null,
        `${firm} (responsible person)`
      );
    }
  }

  return NextResponse.json({ people: [...people.values()].slice(0, 20) });
}
