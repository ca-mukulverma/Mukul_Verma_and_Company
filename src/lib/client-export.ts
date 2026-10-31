import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { clientPhones } from "@/lib/client-contacts";
import { formatIndianDate } from "@/lib/billing-constants";
import { STATUS_LABELS } from "@/lib/compliance";
import { monthKey, periodLabel } from "@/lib/compliance-periods";
import {
  FREQUENCY_LABELS,
  LOGIN_COLUMNS,
  PAYMENT_COLUMNS,
  SETUP_COLUMNS,
  SHEETS,
  trackFromFor,
} from "@/lib/client-extras";

// Client details as an Excel file (Admin, Partner): every client, or the ones
// picked, with their compliance setup, TDS/RCM payments and (Admin only)
// logins. The sheets carry the import's headings, so the whole file can be
// uploaded again in Clients → Import from Excel.

export const MAX_EXPORT_CLIENTS = 10000;
// Keeps the history file within what one response can carry
export const MAX_HISTORY_ROWS = 40000;

type Column = { key: string; header: string; width: number };

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: readonly Column[], textKeys: string[] = []) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  for (const key of ["gstin", ...textKeys]) sheet.getColumn(key).numFmt = "@";
  return sheet;
}

const clientCells = (client: { contactPerson: string; companyName: string | null; gstin: string | null }) => ({
  client: client.companyName || client.contactPerson,
  contactPerson: client.contactPerson,
  gstin: client.gstin ?? "",
});

const amount = (value: { toString(): string } | null) => (value === null ? null : Number(value.toString()));

export async function buildClientExport(
  ids: string[] | null,
  downloadedBy: string,
  options: { includeLogins: boolean }
): Promise<Buffer> {
  const clients = await prisma.client.findMany({
    where: ids ? { id: { in: ids } } : {},
    include: {
      manager: { select: { name: true } },
      connector: { select: { name: true } },
      parentClient: { select: { contactPerson: true, companyName: true } },
      _count: { select: { tasks: true } },
      ...(options.includeLogins && { credentials: { orderBy: { createdAt: "asc" as const } } }),
      complianceSubscriptions: {
        where: { active: true },
        include: { workType: { select: { name: true } } },
        orderBy: { workType: { sortOrder: "asc" } },
      },
      obligations: { where: { active: true }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] },
    },
    orderBy: [{ companyName: "asc" }, { contactPerson: "asc" }],
  });

  // Periods of the tracked works, to tell where each one is up to
  const items = await prisma.complianceItem.findMany({
    where: { clientId: { in: clients.map((c) => c.id) } },
    select: { clientId: true, workTypeId: true, periodStart: true, status: true, historical: true },
  });
  const itemsOf = new Map<string, typeof items>();
  for (const item of items) {
    const key = `${item.clientId}|${item.workTypeId}`;
    itemsOf.set(key, [...(itemsOf.get(key) ?? []), item]);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MV Company";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Clients", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    // Same headings as the import template
    { header: "Contact Person*", key: "contactPerson", width: 26 },
    { header: "Company Name", key: "companyName", width: 32 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "Address", key: "address", width: 40 },
    { header: "Tally Ledger Name", key: "tallyLedgerName", width: 28 },
    { header: "Notes", key: "notes", width: 36 },
    // Also read by the import
    { header: "Other phones", key: "otherPhones", width: 32 },
    { header: "PAN", key: "pan", width: 12 },
    { header: "TAN", key: "tan", width: 12 },
    { header: "CIN / LLPIN", key: "cin", width: 24 },
    { header: "Udyam number", key: "udyamNumber", width: 22 },
    { header: "IEC", key: "iec", width: 12 },
    { header: "Responsible person", key: "responsibleName", width: 22 },
    { header: "Responsible phone", key: "responsiblePhone", width: 16 },
    { header: "Responsible email", key: "responsibleEmail", width: 28 },
    { header: "Connector", key: "connector", width: 22 },
    // For reference only
    { header: "Registration of", key: "parent", width: 28 },
    { header: "Type", key: "type", width: 11 },
    { header: "Guest access till", key: "accessExpiry", width: 14 },
    { header: "Managed by", key: "manager", width: 20 },
    { header: "Tasks", key: "tasks", width: 8 },
    { header: "Added on", key: "createdAt", width: 12 },
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  for (const key of ["phone", "gstin", "otherPhones", "responsiblePhone"]) sheet.getColumn(key).numFmt = "@";

  for (const client of clients) {
    const phones = clientPhones(client);
    const responsible = !client.ownerIsResponsible;
    const row = sheet.addRow({
      contactPerson: client.contactPerson,
      companyName: client.companyName ?? "",
      email: client.email ?? "",
      phone: phones[0]?.number ?? client.phone ?? "",
      gstin: client.gstin ?? "",
      address: client.address ?? "",
      tallyLedgerName: client.tallyLedgerName ?? "",
      notes: client.notes ?? "",
      otherPhones: phones
        .slice(1)
        .map((p) => `${p.number} (${p.label}${p.whatsapp ? ", WhatsApp" : ""})`)
        .join("; "),
      pan: client.pan ?? "",
      tan: client.tan ?? "",
      cin: client.cin ?? "",
      udyamNumber: client.udyamNumber ?? "",
      iec: client.iec ?? "",
      responsibleName: responsible ? client.responsibleName ?? "" : "Owner",
      responsiblePhone: responsible ? client.responsiblePhone ?? "" : "",
      responsibleEmail: responsible ? client.responsibleEmail ?? "" : "",
      connector: client.connector?.name ?? "",
      parent: client.parentClient ? client.parentClient.companyName || client.parentClient.contactPerson : "",
      type: client.isGuest ? "Guest" : "Permanent",
      accessExpiry: client.isGuest && client.accessExpiry ? formatIndianDate(client.accessExpiry) : "",
      manager: client.manager.name,
      tasks: client._count.tasks,
      createdAt: formatIndianDate(client.createdAt),
    });
    row.alignment = { vertical: "top", wrapText: true };
  }

  if (options.includeLogins) {
    const logins = addSheet(workbook, SHEETS.logins, LOGIN_COLUMNS, ["username", "password"]);
    for (const client of clients) {
      for (const login of client.credentials ?? []) {
        logins.addRow({ ...clientCells(client), title: login.title, username: login.username, password: login.password });
      }
    }
  }

  const setup = addSheet(workbook, SHEETS.setup, [...SETUP_COLUMNS, { key: "since", header: "Tracked since", width: 13 }], [
    "trackFrom",
    "trackTill",
  ]);
  setup.getCell(1, SETUP_COLUMNS.length + 1).note = "For reference only; not read on import.";
  setup.getCell("F1").note = "The first period still to be done. Earlier periods are not added on import.";
  for (const client of clients) {
    for (const sub of client.complianceSubscriptions) {
      if (sub.endPeriod && sub.endPeriod < sub.startPeriod) continue;
      setup.addRow({
        ...clientCells(client),
        work: sub.workType.name,
        frequency: FREQUENCY_LABELS[sub.frequency],
        trackFrom: trackFromFor(sub, itemsOf.get(`${client.id}|${sub.workTypeId}`) ?? []),
        trackTill: sub.endPeriod ? monthKey(sub.endPeriod) : "",
        feeNil: amount(sub.feeNil),
        feeNonNil: amount(sub.feeNonNil),
        since: monthKey(sub.startPeriod),
      });
    }
  }

  const payments = addSheet(workbook, SHEETS.payments, PAYMENT_COLUMNS, ["fromMonth", "toMonth"]);
  for (const client of clients) {
    for (const ob of client.obligations) {
      payments.addRow({
        ...clientCells(client),
        kind: ob.kind,
        category: ob.category,
        payee: ob.payee,
        fixedAmount: amount(ob.fixedAmount),
        ratePercent: amount(ob.ratePercent),
        fromMonth: monthKey(ob.fromMonth),
        toMonth: ob.toMonth ? monthKey(ob.toMonth) : "",
      });
    }
  }

  const info = workbook.addWorksheet("About");
  info.columns = [{ width: 18 }, { width: 80 }];
  info.addRows([
    ["Downloaded on", formatIndianDate(new Date(), "medium")],
    ["Downloaded by", downloadedBy],
    ["Clients", ids ? `${clients.length} selected` : `All ${clients.length}`],
    ["", ""],
    ["Logins", options.includeLogins ? "Included. This file has passwords: keep it safe and delete it after use." : "Not included"],
    ["", ""],
    ["Import again", "Upload this file in Clients → Import from Excel. On the Clients sheet the columns from Contact Person to"],
    ["", "Connector are imported; the ones after are for reference. Every client comes back as a permanent client."],
    ["", "Clients already in the app (same GSTIN, email or phone) are skipped, with their logins and compliance."],
    ["Compliance setup", "Each work is tracked again from 'Track from': the first period that was still open. Change it if needed."],
    ["", "Periods from then until now are added as Pending."],
    ["Not included", "Documents, compliance history (a separate download), client history and bills."],
  ]);
  info.getColumn(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Every period of the clients' compliance works, as a record (not imported)
export async function countComplianceHistory(ids: string[] | null) {
  return prisma.complianceItem.count({ where: ids ? { clientId: { in: ids } } : {} });
}

export async function buildComplianceHistoryExport(ids: string[] | null, downloadedBy: string): Promise<Buffer> {
  const items = await prisma.complianceItem.findMany({
    where: ids ? { clientId: { in: ids } } : {},
    include: {
      client: { select: { contactPerson: true, companyName: true, gstin: true } },
      workType: { select: { name: true, sortOrder: true } },
      completedBy: { select: { name: true } },
    },
    orderBy: [{ periodStart: "asc" }],
    take: MAX_HISTORY_ROWS,
  });
  // Client, then work, then period
  items.sort(
    (a, b) =>
      (a.client.companyName || a.client.contactPerson).localeCompare(b.client.companyName || b.client.contactPerson) ||
      a.workType.sortOrder - b.workType.sortOrder ||
      a.workType.name.localeCompare(b.workType.name) ||
      a.periodStart.getTime() - b.periodStart.getTime()
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MV Company";
  workbook.created = new Date();
  const money = { numFmt: "#,##0.00" };
  const sheet = addSheet(workbook, SHEETS.history, [
    { key: "client", header: "Client", width: 30 },
    { key: "contactPerson", header: "Contact person", width: 22 },
    { key: "gstin", header: "GSTIN", width: 18 },
    { key: "work", header: "Work", width: 22 },
    { key: "period", header: "Period", width: 14 },
    { key: "dueDate", header: "Due date", width: 12 },
    { key: "status", header: "Status", width: 14 },
    { key: "dataReceived", header: "Data received", width: 13 },
    { key: "filedAt", header: "Filed on", width: 12 },
    { key: "arn", header: "ARN / acknowledgement", width: 24 },
    { key: "nil", header: "Nil", width: 6 },
    { key: "taxPayable", header: "Tax payable", width: 13 },
    { key: "fee", header: "Fee", width: 11 },
    { key: "filedBy", header: "Filed by", width: 18 },
    { key: "past", header: "Entered as past period", width: 12 },
  ], ["arn"]);
  sheet.getColumn("taxPayable").numFmt = money.numFmt;
  sheet.getColumn("fee").numFmt = money.numFmt;

  for (const item of items) {
    sheet.addRow({
      ...clientCells(item.client),
      work: item.workType.name,
      period: periodLabel(item.frequency, item.periodStart),
      dueDate: formatIndianDate(item.dueDate),
      status: STATUS_LABELS[item.status],
      dataReceived: item.dataReceivedAt ? formatIndianDate(item.dataReceivedAt) : "",
      filedAt: item.filedAt ? formatIndianDate(item.filedAt) : "",
      arn: item.arn ?? "",
      nil: item.isNil === null ? "" : item.isNil ? "Yes" : "No",
      taxPayable: amount(item.taxPayable),
      fee: amount(item.fee),
      filedBy: item.completedBy?.name ?? "",
      past: item.historical ? "Yes" : "",
    });
  }

  const info = workbook.addWorksheet("About");
  info.columns = [{ width: 18 }, { width: 80 }];
  info.addRows([
    ["Downloaded on", formatIndianDate(new Date(), "medium")],
    ["Downloaded by", downloadedBy],
    ["Periods", String(items.length)],
    ["", ""],
    ["Note", "A record of every period. It is not read by the import; the Compliance setup sheet of the client export is."],
  ]);
  info.getColumn(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
