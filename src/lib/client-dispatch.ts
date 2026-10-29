import { Company, ComplianceFrequency, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DOC_KIND_LABELS, partyName } from "@/lib/compliance";
import { addMonths, formatDay, monthKey, periodLabel, todayIST, utcDate } from "@/lib/compliance-periods";
import { BillingAccess } from "@/lib/billing";
import { formatIndianDate, formatRupees } from "@/lib/billing-constants";
import { loadBillDocuments } from "@/lib/bill-document";
import { clientDocLabel, clientDocType, fyLabel } from "@/lib/client-documents";
import type { EmailContent, EmailSection } from "@/lib/email-layout";
import {
  BUILT_IN_REQUESTS,
  DETAIL_FIELDS,
  DetailField,
  PORTALS,
  RETURN_WORKS,
  RangeOption,
  RequestConfig,
  RequestTypeView,
  isAdminOnly,
  portalOf,
  requestConfigSchema,
} from "@/lib/client-requests";

// Send to Client, on the server: which of a client's files, details, logins
// and bills a request picks (the preview staff see before sending), and the
// email text (see docs/CLIENT_REQUESTS.md).

// ─── Request types ──────────────────────────────────────────────────────────

// Adds built-in requests that aren't in the database yet (new installs, or
// ones added in a later version). Ones Admin edited or switched off are kept.
export async function ensureBuiltInRequests() {
  const existing = await prisma.clientRequestType.findMany({ where: { key: { not: null } }, select: { key: true } });
  const have = new Set(existing.map((r) => r.key));
  const missing = BUILT_IN_REQUESTS.map((r, i) => ({ ...r, sortOrder: (i + 1) * 10 })).filter((r) => !have.has(r.key));
  if (missing.length === 0) return;
  await prisma.clientRequestType.createMany({
    data: missing.map((r) => ({ key: r.key, name: r.name, description: r.description, category: r.category, config: r.config, sortOrder: r.sortOrder })),
    skipDuplicates: true,
  });
}

export function serializeRequestType(row: {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  category: string;
  config: Prisma.JsonValue;
  active: boolean;
  sortOrder: number;
}): RequestTypeView {
  // A stored config from an older version gets today's defaults
  const parsed = requestConfigSchema.safeParse(row.config);
  const config = parsed.success ? parsed.data : requestConfigSchema.parse({});
  return { id: row.id, key: row.key, name: row.name, description: row.description, category: row.category, config, active: row.active, sortOrder: row.sortOrder, adminOnly: isAdminOnly(config) };
}

// ─── Periods ────────────────────────────────────────────────────────────────

// First and last month (as month-start dates) of a default period
export function rangeMonths(range: RangeOption, today: Date = todayIST()): { from: Date; to: Date } | null {
  const thisMonth = utcDate(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const lastMonth = addMonths(thisMonth, -1);
  const fyStart = utcDate(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 4);
  switch (range) {
    case "none":
      return null;
    case "lastMonth":
      return { from: lastMonth, to: lastMonth };
    case "lastQuarter": {
      // Financial-year quarters start in Apr, Jul, Oct and Jan
      const quarterStart = addMonths(thisMonth, -(thisMonth.getUTCMonth() % 3));
      return { from: addMonths(quarterStart, -3), to: addMonths(quarterStart, -1) };
    }
    case "last12Months":
      return { from: addMonths(lastMonth, -11), to: lastMonth };
    case "currentFY":
      return { from: fyStart, to: lastMonth < fyStart ? fyStart : lastMonth };
    case "lastFY":
      return { from: addMonths(fyStart, -12), to: addMonths(fyStart, -1) };
  }
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
export function rangeLabel(from: Date, to: Date) {
  const a = MONTH_LABEL.format(from);
  const b = MONTH_LABEL.format(to);
  return a === b ? a : `${a} – ${b}`;
}

// ─── Preview ────────────────────────────────────────────────────────────────

export interface DispatchFile {
  id: string;
  source: "document" | "bill";
  label: string;
  fileName: string;
  group: string;
  size: number;
  selected: boolean;
}

export interface DispatchLogin {
  id: string;
  title: string;
  username: string;
  portal: string | null;
  selected: boolean;
}

export interface DispatchPreview {
  client: { id: string; name: string; emails: string[] };
  company: Company;
  range: { from: string; to: string } | null;
  years: number;
  files: DispatchFile[];
  details: { field: DetailField; label: string; value: string | null; selected: boolean }[];
  // null when the user may not send logins (only Admin can)
  logins: DispatchLogin[] | null;
  statement: boolean;
  canSeeBills: boolean;
  missing: string[];
}

const clientSelect = {
  id: true,
  contactPerson: true,
  companyName: true,
  email: true,
  phone: true,
  address: true,
  gstin: true,
  pan: true,
  tan: true,
  cin: true,
  udyamNumber: true,
  iec: true,
  ownerIsResponsible: true,
  responsibleEmail: true,
} satisfies Prisma.ClientSelect;
export type DispatchClient = Prisma.ClientGetPayload<{ select: typeof clientSelect }>;

export async function loadDispatchClient(clientId: string) {
  return prisma.client.findUnique({ where: { id: clientId }, select: clientSelect });
}

// The client's own addresses; anything else is a third party
export function clientEmails(client: Pick<DispatchClient, "email" | "responsibleEmail">) {
  return [...new Set([client.email, client.responsibleEmail].map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e))];
}

const docInclude = {
  item: { select: { id: true, frequency: true, periodStart: true, status: true, workType: { select: { name: true, kind: true, company: true } } } },
} satisfies Prisma.ComplianceDocumentInclude;
type DocWithItem = Prisma.ComplianceDocumentGetPayload<{ include: typeof docInclude }>;

// Works kept per financial year: picked by the latest years, not the period
const YEARLY_WORKS = ["Income Tax Return"];
const workLabel = (work: string) => RETURN_WORKS.find((w) => w.key === work)?.label ?? work;

function worksMatch(works: string[], workType: { name: string; kind: string }) {
  return works.some((w) => w === workType.kind || w.toLowerCase() === workType.name.toLowerCase());
}

export function documentLabel(doc: DocWithItem) {
  if (doc.item) return `${doc.item.workType.name} ${periodLabel(doc.item.frequency, doc.item.periodStart)} – ${DOC_KIND_LABELS[doc.kind]}`;
  if (doc.docType) return clientDocLabel(doc);
  return doc.fileName;
}

function documentGroup(doc: DocWithItem) {
  if (doc.item) return "Returns, challans & certificates";
  return clientDocType(doc.docType)?.group ?? "Other files";
}

export async function buildPreview(options: {
  client: DispatchClient;
  config: RequestConfig;
  range: { from: Date; to: Date } | null;
  years: number;
  isAdmin: boolean;
  billing: BillingAccess | null;
}): Promise<DispatchPreview> {
  const { client, config, range, years, isAdmin, billing } = options;
  const missing: string[] = [];

  const docs = await prisma.complianceDocument.findMany({
    where: { clientId: client.id },
    include: docInclude,
    orderBy: { createdAt: "asc" },
  });
  const selected = new Set<string>();

  // Return files, challans and certificates of the request's works
  if (config.returnWorks.length && config.returnDocs.length) {
    const itemDocs = docs.filter((d) => d.item && worksMatch(config.returnWorks, d.item.workType) && (config.returnDocs as string[]).includes(d.kind));
    // Yearly works (ITR) by the latest years; others by the period
    const yearly = itemDocs.filter((d) => d.item!.frequency === ComplianceFrequency.YEARLY);
    const latestYears = [...new Set(yearly.map((d) => d.item!.periodStart.getTime()))].sort((a, b) => b - a).slice(0, years);
    yearly.filter((d) => latestYears.includes(d.item!.periodStart.getTime())).forEach((d) => selected.add(d.id));

    const periodic = config.returnWorks.filter((w) => !YEARLY_WORKS.includes(w));
    if (range && periodic.length) {
      const items = await prisma.complianceItem.findMany({
        where: { clientId: client.id, periodStart: { gte: range.from, lte: range.to }, workType: { frequency: { not: "YEARLY" } } },
        include: { workType: { select: { name: true, kind: true } } },
        orderBy: [{ periodStart: "asc" }],
      });
      const relevant = items.filter((it) => worksMatch(config.returnWorks, it.workType));
      for (const it of relevant) {
        const files = itemDocs.filter((d) => d.itemId === it.id);
        files.forEach((d) => selected.add(d.id));
        if (files.length === 0) {
          const what = `${it.workType.name} ${periodLabel(it.frequency, it.periodStart)}`;
          missing.push(it.status === "filed" || it.status === "completed" ? `${what}: no file uploaded` : `${what}: not filed yet`);
        }
      }
      if (relevant.length === 0) missing.push(`No ${periodic.map(workLabel).join(" / ")} periods in ${rangeLabel(range.from, range.to)}`);
    }
  }

  // The client's own documents: registrations (every copy) and yearly papers
  // of the latest years
  if (config.documents.length) {
    const types = config.documents.map(clientDocType).filter((t) => t !== null);
    const own = docs.filter((d) => !d.item && d.docType && config.documents.includes(d.docType));
    for (const type of types.filter((t) => !t.yearly)) {
      const copies = own.filter((d) => d.docType === type.key);
      copies.forEach((d) => selected.add(d.id));
      if (copies.length === 0) missing.push(`${type.label}: not uploaded`);
    }
    const yearlyTypes = types.filter((t) => t.yearly);
    if (yearlyTypes.length) {
      const yearlyDocs = own.filter((d) => yearlyTypes.some((t) => t.key === d.docType) && d.financialYear !== null);
      const fys = [...new Set(yearlyDocs.map((d) => d.financialYear!))].sort((a, b) => b - a).slice(0, years);
      yearlyDocs.filter((d) => fys.includes(d.financialYear!)).forEach((d) => selected.add(d.id));
      if (fys.length === 0) missing.push(`${yearlyTypes.map((t) => t.label).join(", ")}: not uploaded`);
      else {
        if (fys.length < years) missing.push(`Only ${fys.length} of ${years} years uploaded (${fys.map(fyLabel).join(", ")})`);
        for (const type of yearlyTypes) {
          const without = fys.filter((fy) => !yearlyDocs.some((d) => d.docType === type.key && d.financialYear === fy));
          if (without.length) missing.push(`${type.label}: not uploaded for ${without.map(fyLabel).join(", ")}`);
        }
      }
    }
  }

  const files: DispatchFile[] = docs.map((d) => ({
    id: d.id,
    source: "document",
    label: documentLabel(d),
    fileName: d.fileName,
    group: documentGroup(d),
    size: d.size,
    selected: selected.has(d.id),
  }));

  // Bills: only numbered bills of a Billing List the user may see
  const canSeeBills = !!billing && billing.listCompanies.length > 0;
  if (canSeeBills) {
    const bills = await prisma.bill.findMany({
      where: { clientId: client.id, status: "approved", billNumber: { not: null }, type: { in: billing!.listTypes } },
      select: { id: true, billNumber: true, billDate: true, description: true },
      orderBy: { billDate: "desc" },
    });
    bills.forEach((b, i) => {
      const inRange = !!range && !!b.billDate && b.billDate >= range.from && b.billDate < addMonths(range.to, 1);
      files.push({
        id: b.id,
        source: "bill",
        label: `Bill ${b.billNumber}${b.billDate ? ` – ${formatIndianDate(b.billDate)}` : ""} – ${b.description.slice(0, 60)}`,
        fileName: `Bill-${b.billNumber!.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`,
        group: "Bills",
        size: 60_000,
        selected: (config.bills === "latest" && i === 0) || (config.bills === "range" && inRange),
      });
    });
    if (config.bills !== "none" && bills.length === 0) missing.push("No bills issued to this client");
  } else if (config.bills !== "none" || config.statement) {
    missing.push("Bills can only be sent by billing managers and partners who see the Billing List");
  }

  const details = (Object.keys(DETAIL_FIELDS) as DetailField[]).map((field) => {
    const value = (client[field] as string | null)?.trim() || null;
    const wanted = config.details.includes(field);
    if (wanted && !value) missing.push(`${DETAIL_FIELDS[field]}: not on the client's record`);
    return { field, label: DETAIL_FIELDS[field], value, selected: wanted && !!value };
  });

  let logins: DispatchLogin[] | null = null;
  if (isAdmin) {
    const credentials = await prisma.credential.findMany({ where: { clientId: client.id }, orderBy: { title: "asc" } });
    logins = credentials.map((cr) => {
      const portal = portalOf(cr.title);
      return { id: cr.id, title: cr.title, username: cr.username, portal: portal ? PORTALS[portal].label : null, selected: !!portal && config.logins.includes(portal) };
    });
    const unsaved = config.logins.filter((portal) => !logins!.some((l) => l.portal === PORTALS[portal].label));
    if (unsaved.length) missing.push(`No saved login (Credentials) for ${unsaved.map((p) => PORTALS[p].label).join(", ")}`);
  }

  return {
    client: { id: client.id, name: partyName(client), emails: clientEmails(client) },
    company: companyFor(docs.filter((d) => selected.has(d.id))),
    range: range ? { from: monthKey(range.from), to: monthKey(range.to) } : null,
    years,
    files,
    details,
    logins,
    statement: config.statement && canSeeBills,
    canSeeBills,
    missing,
  };
}

// Files of B Edge work go from B Edge's mailbox; everything else from MVC's
function companyFor(docs: DocWithItem[]): Company {
  const companies = docs.map((d) => d.item?.workType.company).filter((c): c is Company => !!c);
  const bedge = companies.filter((c) => c === "BEDGE").length;
  return bedge > 0 && bedge >= companies.length - bedge ? "BEDGE" : "MVC";
}

// ─── The email ──────────────────────────────────────────────────────────────

export interface ComposeInput {
  client: DispatchClient;
  docs: DocWithItem[];
  billDocs: Awaited<ReturnType<typeof loadBillDocuments>>;
  details: DetailField[];
  logins: { title: string; username: string; password: string }[];
  statement: { from: Date; to: Date; bills: Awaited<ReturnType<typeof loadBillDocuments>> } | null;
  note: string | null;
  attached: boolean;
  links: string;
}

export async function loadDocs(ids: string[]) {
  return prisma.complianceDocument.findMany({ where: { id: { in: ids } }, include: docInclude, orderBy: { createdAt: "asc" } });
}

export async function filingLines(itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const items = await prisma.complianceItem.findMany({
    where: { id: { in: itemIds }, filedAt: { not: null } },
    select: { frequency: true, periodStart: true, filedAt: true, arn: true, workType: { select: { name: true } } },
    orderBy: [{ periodStart: "asc" }],
  });
  return items.map((it) => `${it.workType.name} ${periodLabel(it.frequency, it.periodStart)}: filed on ${formatDay(it.filedAt)}${it.arn ? `, ARN ${it.arn}` : ""}`);
}

// The email's content, in the professional layout (src/lib/email-layout.ts)
export async function buildEmailContent(input: ComposeInput): Promise<EmailContent> {
  const { client, docs, billDocs } = input;
  const sections: EmailSection[] = [];
  const listed = [...docs.map(documentLabel), ...billDocs.map((b) => `Bill no. ${b.billNumber} dated ${formatIndianDate(b.billDate)}`)];
  const paragraphs = [
    listed.length
      ? `As requested, please find ${input.attached ? "attached" : "below the download links for"} the following for ${partyName(client)}.`
      : `As requested, please find the details of ${partyName(client)} below.`,
  ];
  if (listed.length && input.attached) sections.push({ title: "Attached", lines: listed, numbered: true });
  if (input.links) sections.push({ title: "Download links (valid for 7 days)", lines: input.links.split("\n").filter(Boolean), numbered: true });

  // Filing date and ARN of each return sent
  const itemIds = [...new Set(docs.map((d) => d.itemId).filter((id): id is string => !!id))];
  const filings = await filingLines(itemIds);
  if (filings.length) sections.push({ title: "Filing details", lines: filings });

  const details = input.details
    .map((f) => [DETAIL_FIELDS[f], (input.client[f] as string | null)?.trim()] as const)
    .filter(([, v]) => !!v);
  if (details.length) sections.push({ title: "Your details as per our records", lines: details.map(([k, v]) => `${k}: ${v}`) });

  if (input.logins.length) {
    sections.push({
      title: "Portal logins (please keep these confidential)",
      lines: input.logins.map((l) => `${l.title} – User ID: ${l.username || "—"}, Password: ${l.password}`),
    });
  }

  if (input.statement) {
    const { from, to, bills } = input.statement;
    const title = `Statement of bills (${rangeLabel(from, to)})`;
    if (bills.length === 0) {
      sections.push({ title, lines: ["No bills were issued in this period."] });
    } else {
      const total = bills.reduce((s, b) => s + b.total, 0);
      sections.push({
        title,
        table: {
          head: ["Bill no.", "Date", "Particulars", "Amount"],
          rows: bills.map((b) => [b.billNumber, formatIndianDate(b.billDate), b.description.split("\n")[0].slice(0, 60), formatRupees(b.total)]),
          right: [3],
          total: ["Total", "", "", formatRupees(total)],
        },
      });
    }
  }

  return {
    greetingName: client.contactPerson,
    paragraphs,
    sections,
    after: [input.note ?? "", "Please feel free to contact us for any clarification."],
  };
}
