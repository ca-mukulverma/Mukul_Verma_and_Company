import { prisma } from "@/lib/prisma";
import { partyName } from "@/lib/compliance";
import { addMonths, dateKey, monthKey, parseMonthKey, periodContaining, todayIST, utcDate } from "@/lib/compliance-periods";
import { loadPeriods, periodTitle } from "@/lib/gst-working";
import type { PeriodResult } from "@/lib/gst-read/working";
import { isGstLogin, PortalPeriod, portalState } from "@/lib/gst-portal";

// Which GST return files are saved and which are missing, per client and
// period, for the GST portal box on the client's page and the download round
// (docs/GST_PORTAL_EXTENSION_PLAN.md, stage 1). Read-only: it reuses the GST
// working's periods (loadPeriods), so it costs the same few queries.

function toPortal(p: PeriodResult, today: string): PortalPeriod {
  return {
    start: p.start,
    title: periodTitle(p),
    quarterly: p.quarterly,
    files: p.files.map((f) => ({ kind: f.kind, month: f.month, label: f.label, state: portalState(f, p, today), docId: f.docId, docs: f.docs })),
  };
}

const loginTitles = { credentials: { select: { kind: true, title: true } } } as const;

// One client's financial year (2026 = FY 2026-27), up to the current month
export async function clientPortalFiles(clientId: string, fy: number) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, contactPerson: true, companyName: true, gstin: true, ...loginTitles },
  });
  if (!client) return null;
  const today = todayIST();
  const current = monthKey(today);
  const until = utcDate(fy + 1, 3);
  const periods = (await loadPeriods([clientId], utcDate(fy, 4), until)).get(clientId) ?? [];
  return {
    client: {
      id: client.id,
      name: partyName(client),
      gstin: client.gstin,
      hasLogin: client.credentials.some(isGstLogin),
    },
    fy,
    periods: periods.filter((p) => p.start <= current).map((p) => toPortal(p, dateKey(today))),
  };
}

export type ClientPortalFiles = NonNullable<Awaited<ReturnType<typeof clientPortalFiles>>>;

// Every client with GST work in a month: the period holding that month (a
// QRMP client's quarter) and its files
export async function roundPortalFiles(month: string) {
  const start = parseMonthKey(month)!;
  const subs = await prisma.clientCompliance.findMany({
    where: {
      active: true,
      workType: { kind: { in: ["GSTR1", "GSTR3B"] } },
      startPeriod: { lte: start },
      OR: [{ endPeriod: null }, { endPeriod: { gte: start } }],
      client: { isGuest: false },
    },
    select: {
      clientId: true,
      client: { select: { contactPerson: true, companyName: true, gstin: true, managerId: true, ...loginTitles } },
    },
  });
  const clients = new Map(subs.map((s) => [s.clientId, s.client]));
  // From the quarter's first month, so a QRMP client's quarter is built whole
  const from = periodContaining("QUARTERLY", start).start;
  const periods = await loadPeriods([...clients.keys()], from, start);
  const today = dateKey(todayIST());

  const rows = [...clients.entries()].flatMap(([id, c]) => {
    const period = periods.get(id)?.find((p) => p.months.includes(month));
    if (!period) return [];
    return [
      {
        clientId: id,
        name: partyName(c),
        gstin: c.gstin,
        managerId: c.managerId,
        hasLogin: c.credentials.some(isGstLogin),
        period: toPortal(period, today),
      },
    ];
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { month, rows };
}

export type RoundPortalFiles = Awaited<ReturnType<typeof roundPortalFiles>>;

// The month the round opens on: last month (its returns are being filed now)
export const defaultRoundMonth = () => monthKey(addMonths(todayIST(), -1));
