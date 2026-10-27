import { gunzipSync, gzipSync } from "zlib";
import { BillingEntity, BillType, Prisma, TallyExport } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GST_STATES, billTotals } from "@/lib/bill-document";
import { MVC_GST_STATE_CODE } from "@/lib/bill-formats";
import { BillingAccess } from "@/lib/billing";
import { billTypesOf } from "@/lib/billing-constants";
import { billShowsGstin, clientLedger } from "@/lib/connectors";

// Tally import file (XML) of sales vouchers, one file per billing entity,
// since each entity is a separate company in Tally.
//
// Each voucher carries REMOTEID = the bill's id, so Tally recognises it again:
// - a bill not sent before goes as ACTION="Create"
// - an approved bill edited after it was sent goes as ACTION="Alter"
// - a bill cancelled after it was sent goes as ACTION="Cancel"
// Bills cancelled before they were ever sent are not sent at all.

export const TALLY_DEFAULTS = {
  voucherType: "Sales",
  salesLedger: "Professional Fees",
  cgstLedger: "Output CGST",
  sgstLedger: "Output SGST",
  igstLedger: "Output IGST",
  roundOffLedger: "Round Off",
};

export interface TallyLedgers {
  company: string;
  voucherType: string;
  salesLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
  roundOffLedger: string;
}

export function tallyLedgers(entity: BillingEntity | null, fallbackName: string): TallyLedgers {
  return {
    company: entity?.tallyCompany || entity?.name || fallbackName,
    voucherType: entity?.tallyVoucherType || TALLY_DEFAULTS.voucherType,
    salesLedger: entity?.tallySalesLedger || TALLY_DEFAULTS.salesLedger,
    cgstLedger: entity?.tallyCgstLedger || TALLY_DEFAULTS.cgstLedger,
    sgstLedger: entity?.tallySgstLedger || TALLY_DEFAULTS.sgstLedger,
    igstLedger: entity?.tallyIgstLedger || TALLY_DEFAULTS.igstLedger,
    roundOffLedger: entity?.tallyRoundOffLedger || TALLY_DEFAULTS.roundOffLedger,
  };
}

// Bills waiting to be sent to Tally for one series
export function pendingTallyWhere(type: BillType): Prisma.BillWhereInput {
  return {
    type,
    billNumber: { not: null },
    OR: [
      { status: "approved", tallyExportedAt: null },
      { tallyExportedAt: { not: null }, tallyNeedsUpdate: true },
    ],
  };
}

const tallyBillInclude = {
  client: {
    select: {
      id: true,
      contactPerson: true,
      companyName: true,
      gstin: true,
      tallyLedgerName: true,
      connectorId: true,
      connector: { select: { id: true, name: true, tallyLedgerName: true } },
    },
  },
  connector: { select: { name: true } },
  reissuedFrom: { select: { billNumber: true } },
} satisfies Prisma.BillInclude;

type TallyBill = Prisma.BillGetPayload<{ include: typeof tallyBillInclude }>;

// The party ledger in Tally: the one fixed at final approval (the connector's
// for a connector's client), else the client's (or its Tally name), or the
// name entered under "Other"
export function partyLedgerName(bill: Pick<TallyBill, "client" | "billToName" | "tallyLedgerName">) {
  if (bill.tallyLedgerName) return bill.tallyLedgerName;
  const client = bill.client;
  if (!client) return bill.billToName || "";
  return clientLedger(client);
}

// The client's GSTIN, used for place of supply and IGST vs CGST + SGST
function partyGstin(bill: Pick<TallyBill, "client" | "billToGstin">) {
  return bill.client ? bill.client.gstin : bill.billToGstin;
}

// The GSTIN sent to Tally, which makes the voucher B2B in GSTR-1: not for a
// connector's client unless the bill shows it (then it is B2C)
function reportedGstin(bill: TallyBill) {
  return billShowsGstin(bill, bill.client?.connectorId ?? null) ? partyGstin(bill) : null;
}

// What the voucher says: the work, the client (and GSTIN when shown), the
// bill number, the connector and the bill a reissue replaces
export function voucherNarration(bill: TallyBill) {
  const client = bill.client ? bill.client.companyName || bill.client.contactPerson : bill.billToName;
  const gstin = reportedGstin(bill);
  const connector = bill.connector?.name ?? (bill.billNumber ? null : bill.client?.connector?.name) ?? null;
  return [
    bill.description.replace(/\s*\n\s*/g, "; "),
    client ? `Client: ${client}${gstin ? ` (GSTIN ${gstin})` : ""}` : null,
    bill.billNumber ? `Bill no. ${bill.billNumber}` : null,
    connector ? `Via connector: ${connector}` : null,
    bill.reissuedFrom?.billNumber ? `Reissue of bill no. ${bill.reissuedFrom.billNumber}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name: string, value: string | number) {
  return `<${name}>${typeof value === "number" ? value.toFixed(2) : escapeXml(value)}</${name}>`;
}

// Tally dates are YYYYMMDD; bills are dated in Indian time
function tallyDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date).replace(/-/g, "");
}

// Tally: debit amounts are negative with ISDEEMEDPOSITIVE Yes, credits positive
function ledgerEntry(ledger: string, amount: number, debit: boolean, isParty = false) {
  return [
    "<ALLLEDGERENTRIES.LIST>",
    tag("LEDGERNAME", ledger),
    tag("ISDEEMEDPOSITIVE", debit ? "Yes" : "No"),
    ...(isParty ? [tag("ISPARTYLEDGER", "Yes")] : []),
    tag("AMOUNT", debit ? -amount : amount),
    "</ALLLEDGERENTRIES.LIST>",
  ].join("");
}

export function voucherAction(bill: Pick<TallyBill, "status" | "tallyExportedAt">) {
  if (!bill.tallyExportedAt) return "Create";
  return bill.status === "cancelled" ? "Cancel" : "Alter";
}

function voucherXml(bill: TallyBill, ledgers: TallyLedgers, entity: BillingEntity | null) {
  const action = voucherAction(bill);
  const party = partyLedgerName(bill);
  const fee = bill.amount !== null ? Number(bill.amount) : 0;
  const date = tallyDate(bill.billDate ?? bill.createdAt);
  const head = `<VOUCHER REMOTEID="${escapeXml(bill.id)}" VCHTYPE="${escapeXml(ledgers.voucherType)}" ACTION="${action}" OBJVIEW="Accounting Voucher View">`;

  if (action === "Cancel") {
    return [
      head,
      tag("DATE", date),
      tag("VOUCHERTYPENAME", ledgers.voucherType),
      tag("VOUCHERNUMBER", bill.billNumber ?? ""),
      tag("NARRATION", `Cancelled bill no. ${bill.billNumber}`),
      "</VOUCHER>",
    ].join("");
  }

  // The same GST, round off and total as on the bill
  const gstin = partyGstin(bill);
  // Every bill in a Tally series has its type
  const { taxLines, roundOff, total } = billTotals(bill.type as BillType, fee, entity?.stateCode || null, gstin || null);
  const entries: string[] = [];
  let gstTags: string[] = [];
  if (bill.type === "GST") {
    for (const line of taxLines) {
      const ledger = line.label.startsWith("CGST")
        ? ledgers.cgstLedger
        : line.label.startsWith("SGST")
          ? ledgers.sgstLedger
          : line.label.startsWith("IGST")
            ? ledgers.igstLedger
            : ledgers.igstLedger;
      entries.push(ledgerEntry(ledger, line.amount, false));
    }
    const clientState = gstin?.slice(0, 2);
    const stateName = (clientState && GST_STATES[clientState]) || GST_STATES[entity?.stateCode || MVC_GST_STATE_CODE] || null;
    const reported = reportedGstin(bill);
    gstTags = [
      ...(reported ? [tag("PARTYGSTIN", reported)] : []),
      ...(stateName ? [tag("STATENAME", stateName), tag("PLACEOFSUPPLY", stateName)] : []),
    ];
  }
  // Rounding up is credited to the round off ledger, rounding down debited
  if (roundOff) entries.push(ledgerEntry(ledgers.roundOffLedger, Math.abs(roundOff), roundOff < 0));

  return [
    head,
    tag("DATE", date),
    tag("VOUCHERTYPENAME", ledgers.voucherType),
    tag("VOUCHERNUMBER", bill.billNumber ?? ""),
    tag("REFERENCE", bill.billNumber ?? ""),
    tag("PARTYLEDGERNAME", party),
    ...gstTags,
    tag("NARRATION", voucherNarration(bill)),
    tag("PERSISTEDVIEW", "Accounting Voucher View"),
    ledgerEntry(party, total, true, true),
    ledgerEntry(ledgers.salesLedger, fee, false),
    ...entries,
    "</VOUCHER>",
  ].join("");
}

export function buildTallyXml(bills: TallyBill[], ledgers: TallyLedgers, entity: BillingEntity | null) {
  const vouchers = bills.map((bill) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${voucherXml(bill, ledgers, entity)}</TALLYMESSAGE>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ENVELOPE>",
    "<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
    "<BODY><IMPORTDATA>",
    `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${tag("SVCURRENTCOMPANY", ledgers.company)}</STATICVARIABLES></REQUESTDESC>`,
    `<REQUESTDATA>${vouchers.join("\n")}</REQUESTDATA>`,
    "</IMPORTDATA></BODY>",
    "</ENVELOPE>",
  ].join("\n");
}

export async function loadPendingTallyBills(type: BillType) {
  return prisma.bill.findMany({
    where: pendingTallyWhere(type),
    include: tallyBillInclude,
    orderBy: [{ billDate: "asc" }, { sequence: "asc" }],
  });
}

export class TallyExportConflict extends Error {}

// Exports kept per series, as many as the Tally tab lists; older files are
// deleted when a new one is made
export const TALLY_EXPORTS_KEPT = 10;

// The XML file of an export; it is stored gzipped (XML shrinks about 10x)
export function tallyExportXml(tallyExport: Pick<TallyExport, "xml" | "xmlGzip">) {
  return tallyExport.xmlGzip ? gunzipSync(tallyExport.xmlGzip) : Buffer.from(tallyExport.xml ?? "", "utf8");
}

// Builds the XML for everything waiting in a series, records the export and
// marks the bills as sent, all in one transaction. Returns null when nothing
// is waiting.
export async function createTallyExport(type: BillType, userId: string) {
  const [bills, entity] = await Promise.all([
    loadPendingTallyBills(type),
    prisma.billingEntity.findUnique({ where: { type } }),
  ]);
  if (bills.length === 0) return null;

  const ledgers = tallyLedgers(entity, type);
  const xml = buildTallyXml(bills, ledgers, entity);
  const newCount = bills.filter((b) => !b.tallyExportedAt).length;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const tallyExport = await tx.tallyExport.create({
      data: { type, xmlGzip: gzipSync(xml), newCount, updateCount: bills.length - newCount, createdById: userId },
    });
    // Only bills still waiting are marked; if someone else exported them in
    // the meantime the counts differ and everything is rolled back
    const { count } = await tx.bill.updateMany({
      where: { id: { in: bills.map((b) => b.id) }, ...pendingTallyWhere(type) },
      data: { tallyExportedAt: now, tallyNeedsUpdate: false, tallyExportId: tallyExport.id },
    });
    if (count !== bills.length) throw new TallyExportConflict("These bills were just exported by someone else");

    const older = await tx.tallyExport.findMany({
      where: { type },
      orderBy: { createdAt: "desc" },
      skip: TALLY_EXPORTS_KEPT,
      select: { id: true },
    });
    if (older.length > 0) {
      await tx.tallyExport.deleteMany({ where: { id: { in: older.map((e) => e.id) } } });
    }
    return tallyExport;
  });
}

// GST and the Non-GST series belong to MVC; B Edge bills to B Edge
export function tallyTypesFor(access: BillingAccess): BillType[] {
  return billTypesOf(access.manages);
}

const TALLY_FILE_LABELS: Record<BillType, string> = {
  GST: "GST",
  NON_GST: "NonGST",
  NON_GST_HV: "NonGST-HV",
  NON_GST_VLA: "NonGST-VLA",
  BEDGE: "BEdge",
};

export function tallyFileName(type: BillType, date: Date) {
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/[^0-9]+/g, "-");
  return `Tally-${TALLY_FILE_LABELS[type]}-${stamp}.xml`;
}
