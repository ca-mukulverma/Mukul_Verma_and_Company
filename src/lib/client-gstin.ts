import { prisma } from "@/lib/prisma";
import { gstState } from "@/lib/gst-states";

// One GSTIN belongs to one client record. A second record with the same
// GSTIN splits that registration's returns, files and bills between two
// clients (one month on each), so adding or editing a client to a GSTIN
// that is already saved is refused. Another state's GSTIN of the same party
// is added under the party in Compliance → Clients (Add another state).

export function normalizeGstin(gstin: string | null | undefined) {
  const value = (gstin ?? "").replace(/\s/g, "").toUpperCase();
  return value || null;
}

// Why the GSTIN can't be saved for this client, or null when it is free
export async function gstinTakenProblem(gstin: string | null, exceptClientId?: string) {
  if (!gstin) return null;
  const taken = await prisma.client.findFirst({
    where: { gstin: { equals: gstin, mode: "insensitive" }, ...(exceptClientId && { id: { not: exceptClientId } }) },
    select: { contactPerson: true, companyName: true, parentClientId: true },
  });
  if (!taken) return null;
  const name = taken.companyName || taken.contactPerson;
  return (
    `GSTIN ${gstin} is already saved for ${name}${taken.parentClientId ? ` (${gstState(gstin)} registration)` : ""}. ` +
    `Use that client instead of adding it again; for another state's GSTIN of the same party, open the party in ` +
    `Compliance → Clients and add the state there.`
  );
}
