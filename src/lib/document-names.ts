import { ComplianceDocKind, ComplianceFrequency } from "@prisma/client";
import { financialYearLabel, quarterOf } from "@/lib/compliance-periods";
import { fyLabel } from "@/lib/client-documents";

// Every compliance file is saved under one standard name, whatever it was
// called on the computer it came from, so staff never rename files and the
// client receives tidy names:
//   CITY MOTORS - GSTR-3B - Sep 2026.pdf
//   CITY MOTORS - GSTR-1 JSON - Sep 2026.json
//   CITY MOTORS - Form 16A - Q2 FY 2026-27.pdf
//   CITY MOTORS - PAN card.pdf, CITY MOTORS - ITR acknowledgement - FY 2025-26.pdf
// Files added to the client's own Files without a type keep their name.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function filePeriodLabel(frequency: ComplianceFrequency, start: Date) {
  if (frequency === "MONTHLY") return `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  if (frequency === "YEARLY") return `FY ${financialYearLabel(start)}`;
  return `Q${quarterOf(start)} FY ${financialYearLabel(start)}`;
}

// What the file is, e.g. "GSTR-3B", "GSTR-2B JSON", "TDS Payment challan"
function fileWhat(kind: ComplianceDocKind, workName: string, originalBase: string) {
  switch (kind) {
    case "RETURN_PDF":
      return workName;
    case "RETURN_JSON":
      return `${workName} JSON`;
    case "GSTR1A_PDF":
      return "GSTR-1A";
    case "GSTR1A_JSON":
      return "GSTR-1A JSON";
    case "GSTR2B_JSON":
      return "GSTR-2B JSON";
    case "CHALLAN":
      return `${workName} challan`;
    case "CERTIFICATE":
      return /24Q/i.test(workName) ? "Form 16" : "Form 16A";
    default:
      return `${workName} - ${originalBase}`;
  }
}

const clean = (text: string) =>
  text
    .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

function splitName(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? { base: fileName.slice(0, dot), ext: fileName.slice(dot + 1).toLowerCase() } : { base: fileName, ext: "" };
}

function join(parts: string[], ext: string) {
  const name = parts.map(clean).filter(Boolean).join(" - ");
  const suffix = ext ? `.${ext}` : "";
  return name.slice(0, 150 - suffix.length).trim() + suffix;
}

export function standardFileName(input: {
  party: string;
  originalName: string;
  kind: ComplianceDocKind;
  // A period's file
  item?: { workName: string; frequency: ComplianceFrequency; periodStart: Date } | null;
  // A client file with a type (PAN card, ITR acknowledgement …)
  docTypeLabel?: string | null;
  // Start year of the financial year, for yearly client documents
  financialYear?: number | null;
}): string {
  const { base, ext } = splitName(input.originalName);
  if (input.item) {
    const what = fileWhat(input.kind, input.item.workName, base);
    return join([input.party, what, filePeriodLabel(input.item.frequency, input.item.periodStart)], ext);
  }
  if (input.docTypeLabel) {
    return join([input.party, input.docTypeLabel, input.financialYear ? fyLabel(input.financialYear) : ""], ext);
  }
  return input.originalName;
}

// "… - Sep 2026.pdf" → "… - Sep 2026 (2).pdf" when the period already has a
// file of that name (e.g. two challans)
export function uniqueFileName(name: string, taken: string[]) {
  if (!taken.includes(name)) return name;
  const { base, ext } = splitName(name);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext ? `.${ext}` : ""}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
