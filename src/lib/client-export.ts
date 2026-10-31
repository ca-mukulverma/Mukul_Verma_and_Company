import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { clientPhones } from "@/lib/client-contacts";
import { formatIndianDate } from "@/lib/billing-constants";

// Client details as an Excel file (Admin, Partner): every client, or the ones
// picked. The first columns carry the same headings as the import template,
// so the "Clients" sheet can be uploaded again in Clients → Import from Excel.

export const MAX_EXPORT_CLIENTS = 10000;

export async function buildClientExport(ids: string[] | null, downloadedBy: string): Promise<Buffer> {
  const clients = await prisma.client.findMany({
    where: ids ? { id: { in: ids } } : {},
    include: {
      manager: { select: { name: true } },
      connector: { select: { name: true } },
      parentClient: { select: { contactPerson: true, companyName: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: [{ companyName: "asc" }, { contactPerson: "asc" }],
  });

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

  const info = workbook.addWorksheet("About");
  info.columns = [{ width: 18 }, { width: 80 }];
  info.addRows([
    ["Downloaded on", formatIndianDate(new Date(), "medium")],
    ["Downloaded by", downloadedBy],
    ["Clients", ids ? `${clients.length} selected` : `All ${clients.length}`],
    ["", ""],
    ["Import again", "The 'Clients' sheet can be uploaded in Clients → Import from Excel. The columns from Contact Person to"],
    ["", "Connector are imported; the ones after are for reference. Every client comes back as a permanent client."],
    ["", "Clients already in the app (same GSTIN, email or phone) are skipped."],
    ["Not included", "Logins and passwords, documents, compliance works, history and bills."],
  ]);
  info.getColumn(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
