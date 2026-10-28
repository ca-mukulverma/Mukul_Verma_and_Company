import JSZip from "jszip";
import { monthFromFileName } from "./old-period-files";
import { pdfLines, readGstBytes } from "./gst-file";
import type { GstRead } from "@/lib/gst-read";

// Works out what an uploaded return is from its contents, so staff only
// confirm: GST portal JSON carries the GSTIN and period ("fp" in GSTR-1,
// "ret_period" in GSTR-3B); GST and TDS PDFs are read as text. The file name
// is the fallback. ZIPs and RARs are opened and each file inside is read on
// its own. GST returns are also read for their figures (lib/gst-read).

export type ReturnFound = "GSTR1" | "GSTR1A" | "GSTR3B" | "GSTR2B" | "TDS_RETURN" | "TDS_CERTIFICATE" | "TDS_CHALLAN";

export interface Detected {
  found: ReturnFound | null;
  format: "PDF" | "JSON" | "OTHER";
  // "2024-10"; for a quarter, a month in it
  month: string | null;
  // Read from the file name or worked out from a payment date, so worth a look
  monthGuessed: boolean;
  gstin: string | null;
  tan: string | null;
  // TDS return form: "24Q", "26Q", "27Q", "27EQ"
  formNo: string | null;
  arn: string | null;
  filedAt: string | null;
  // GST returns: the figures read from the file
  gst: GstRead | null;
}

export interface FileToPlace {
  file: File;
  // The ZIP or RAR it came out of
  from: string | null;
  // Folders it was in ("GST RETURNS/City Motors/Apr 26"), for the period check
  folder: string;
  error?: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/;
const TAN = /\b[A-Z]{4}\d{5}[A-Z]\b/;
const TDS_FORM = /\b(24Q|26Q|27Q|27EQ)\b/;

const pad = (n: number) => String(n).padStart(2, "0");
const monthIndex = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

// Financial year start (2024 for "2024-25" or "2024-2025") and an FY month → "2025-01"
function fyMonth(fyStart: number, month: number) {
  return `${month >= 4 ? fyStart : fyStart + 1}-${pad(month)}`;
}

// "20/11/2024", "20-11-2024", "20-Nov-2024" → "2024-11-20"
function dateFrom(text: string | undefined) {
  const m = text?.match(/(\d{1,2})[/.-](\d{1,2}|[A-Za-z]{3})[a-z]*[/.-](20\d{2})/);
  if (!m) return null;
  const month = /\d/.test(m[2]) ? Number(m[2]) : monthIndex(m[2]);
  if (month < 1 || month > 12 || Number(m[1]) < 1 || Number(m[1]) > 31) return null;
  return `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`;
}

function fromName(name: string): Pick<Detected, "found" | "gstin"> {
  const lower = name.toLowerCase();
  const found: ReturnFound | null = /gstr[-_ ]?3b|(?<![a-z0-9])r3b/.test(lower)
    ? "GSTR3B"
    : /gstr[-_ ]?1a|(?<![a-z0-9])r1a/.test(lower)
      ? "GSTR1A"
      : /gstr[-_ ]?1(?![0-9])|(?<![a-z0-9])r1(?![0-9a-z])/.test(lower)
        ? "GSTR1"
        : /16a/.test(lower)
          ? "TDS_CERTIFICATE"
          : /27a|24q|26q|27q/.test(lower)
            ? "TDS_RETURN"
            : null;
  // "_" counts as a word character, so no \b here
  return { found, gstin: name.toUpperCase().match(/(?<![0-9A-Z])\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z](?![0-9A-Z])/)?.[0] ?? null };
}

function fromJson(text: string, name: string): Partial<Detected> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const gstin = typeof data.gstin === "string" ? data.gstin.toUpperCase() : null;
  const mmyyyy = (v: unknown) => (typeof v === "string" && /^(0[1-9]|1[0-2])20\d{2}$/.test(v) ? `${v.slice(2)}-${v.slice(0, 2)}` : null);
  if (mmyyyy(data.ret_period) && ("sup_details" in data || "itc_elg" in data || "inward_sup" in data || "intr_ltfee" in data)) {
    return { found: "GSTR3B", gstin, month: mmyyyy(data.ret_period) };
  }
  if (mmyyyy(data.fp)) {
    return { found: fromName(name).found === "GSTR1A" ? "GSTR1A" : "GSTR1", gstin, month: mmyyyy(data.fp) };
  }
  return { gstin };
}

async function pdfText(file: File) {
  return (await pdfLines(await file.arrayBuffer(), 2)).join(" ").replace(/\s+/g, " ");
}

const GST_FOUND: Record<GstRead["form"], ReturnFound> = { GSTR1: "GSTR1", IFF: "GSTR1", GSTR1A: "GSTR1A", GSTR3B: "GSTR3B", GSTR2B: "GSTR2B" };

function fromGstPdf(text: string): Partial<Detected> | null {
  // The return named first is the form's own title
  const titles: [ReturnFound, RegExp][] = [
    ["GSTR3B", /GSTR\s*-?\s*3B/i],
    ["GSTR1A", /GSTR\s*-?\s*1A/i],
    ["GSTR1", /GSTR\s*-?\s*1(?![0-9A-Z])/i],
  ];
  const first = titles
    .map(([found, re]) => ({ found, at: text.search(re) }))
    .filter((t) => t.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (!first) return null;

  const fy = text.match(/Year\s*:?\s*(20\d{2})\s*-\s*(?:20)?\d{2}/i);
  const months = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
  const period = text.match(new RegExp(`Period\\s*:?\\s*${months}(?:\\s*(?:-|–|to)\\s*${months})?`, "i"));
  // A quarter is found by its last month
  const month = fy && period ? fyMonth(Number(fy[1]), monthIndex(period[2] ?? period[1])) : null;
  return {
    found: first.found,
    gstin: text.match(GSTIN)?.[0] ?? null,
    month,
    arn: text.match(/ARN\s*:?\s*([A-Z]{2}\d{8}[0-9A-Z]{5,7})\b/)?.[1] ?? null,
    filedAt: dateFrom(text.match(/(?:Date\s+of\s+ARN|ARN\s+Date)\s*:?\s*(\S+)/i)?.[1]),
  };
}

function fromTdsPdf(text: string): Partial<Detected> | null {
  const tan = text.match(TAN)?.[0] ?? null;
  const formNo = text.match(TDS_FORM)?.[1] ?? null;
  const fyStart = (() => {
    const fy = text.match(/(?:Financial\s+Year|F\.?\s?Y\.?)\s*:?\s*(20\d{2})\s*-\s*(?:20)?\d{2}/i);
    if (fy) return Number(fy[1]);
    const ay = text.match(/Assessment\s+Year\s*:?\s*(20\d{2})\s*-\s*(?:20)?\d{2}/i);
    return ay ? Number(ay[1]) - 1 : null;
  })();
  const quarter = Number(text.match(/\bQuarter\s*:?\s*Q?([1-4])\b|\bQ([1-4])\b/i)?.slice(1).find(Boolean) ?? 0);
  const quarterMonth = fyStart && quarter ? fyMonth(fyStart, [4, 7, 10, 1][quarter - 1]) : null;

  if (/FORM\s*(?:NO\.?)?\s*16\s*A\b/i.test(text)) {
    return { found: "TDS_CERTIFICATE", tan, formNo: formNo ?? "26Q", month: quarterMonth };
  }
  if (/FORM\s*(?:NO\.?)?\s*16\b/i.test(text)) {
    // Form 16 is issued once a year, with the 24Q of the last quarter
    return { found: "TDS_CERTIFICATE", tan, formNo: "24Q", month: fyStart ? `${fyStart + 1}-01` : null };
  }
  if (/27\s*A\b|Provisional\s+Receipt|Token\s+(?:No|Number)/i.test(text) && formNo) {
    return {
      found: "TDS_RETURN",
      tan,
      formNo,
      month: quarterMonth,
      arn: text.match(/(?:Token|Receipt)\s+(?:No\.?|Number)\s*:?\s*(\d{15})\b/i)?.[1] ?? text.match(/\b\d{15}\b/)?.[0] ?? null,
      filedAt: dateFrom(text.match(/(?:Date\s+of\s+(?:Filing|Receipt)|Receipt\s+Date|Filing\s+Date)\s*:?\s*(\S+)/i)?.[1]),
    };
  }
  if (/ITNS\s*281|Challan/i.test(text) && tan) {
    // TDS is paid the month after it is deducted
    const paid = dateFrom(text.match(/(?:Date\s+of\s+Deposit|Tender\s+Date|Payment\s+Date|Date\s+of\s+Payment)\s*:?\s*(\S+)/i)?.[1]);
    let month: string | null = null;
    if (paid) {
      const [y, m] = paid.split("-").map(Number);
      month = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
    }
    return { found: "TDS_CHALLAN", tan, month, monthGuessed: true };
  }
  return null;
}

export async function detectReturn(file: File): Promise<Detected> {
  const lower = file.name.toLowerCase();
  const format = lower.endsWith(".pdf") ? "PDF" : lower.endsWith(".json") ? "JSON" : "OTHER";
  // A GST return from the portal: everything comes from the file itself
  const gst = format === "OTHER" ? null : await readGstBytes(file.name, await file.arrayBuffer());
  if (gst) {
    return { found: GST_FOUND[gst.form], format, month: gst.month, monthGuessed: false, gstin: gst.gstin, tan: null, formNo: null, arn: gst.arn, filedAt: gst.filedAt, gst };
  }
  let read: Partial<Detected> = {};
  try {
    if (format === "JSON") read = fromJson(await file.text(), file.name);
    else if (format === "PDF") {
      const text = await pdfText(file);
      read = fromGstPdf(text) ?? fromTdsPdf(text) ?? {};
    }
  } catch {
    // Unreadable (scanned, protected or damaged): the file name is all there is
  }
  const named = fromName(file.name);
  const nameMonth = monthFromFileName(file.name);
  return {
    found: read.found ?? named.found,
    format,
    month: read.month ?? nameMonth,
    monthGuessed: read.month ? read.monthGuessed === true : nameMonth !== null,
    gstin: read.gstin ?? named.gstin,
    tan: read.tan ?? null,
    formNo: read.formNo ?? null,
    arn: read.arn ?? null,
    filedAt: read.filedAt ?? null,
    gst: null,
  };
}

const MIME: Record<string, string> = { pdf: "application/pdf", json: "application/json", zip: "application/zip" };
const baseName = (path: string) => path.split("/").pop() ?? path;
const dirName = (path: string) => path.split("/").slice(0, -1).join("/");
const join = (a: string, b: string) => [a, b].filter(Boolean).join("/");

export interface InputFile {
  file: File;
  // Folders it was in, when a folder was chosen or dropped
  folder?: string;
}

async function unrar(data: ArrayBuffer): Promise<{ name: string; data: Uint8Array }[]> {
  const { createExtractorFromData } = await import("node-unrar-js");
  const wasmBinary = await (await fetch(new URL("node-unrar-js/esm/js/unrar.wasm", import.meta.url))).arrayBuffer();
  const extractor = await createExtractorFromData({ wasmBinary, data });
  const out: { name: string; data: Uint8Array }[] = [];
  for (const f of extractor.extract().files) {
    if (!f.fileHeader.flags.directory && f.extraction) out.push({ name: f.fileHeader.name.replace(/\\/g, "/"), data: f.extraction });
  }
  return out;
}

// Every file to place: ZIPs and RARs (and ZIPs inside them) are opened
export async function expandFiles(files: InputFile[], depth = 0, from: string | null = null): Promise<FileToPlace[]> {
  const out: FileToPlace[] = [];
  for (const { file, folder = "" } of files) {
    const lower = file.name.toLowerCase();
    const archive = lower.endsWith(".zip") ? "zip" : lower.endsWith(".rar") ? "rar" : null;
    if (!archive || depth > 2) {
      out.push({ file, from, folder });
      continue;
    }
    try {
      const entries: { name: string; data: Blob | Uint8Array }[] = [];
      if (archive === "zip") {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        for (const entry of Object.values(zip.files)) {
          if (!entry.dir) entries.push({ name: entry.name, data: await entry.async("blob") });
        }
      } else {
        entries.push(...(await unrar(await file.arrayBuffer())));
      }
      const inner: InputFile[] = [];
      for (const entry of entries) {
        const name = baseName(entry.name);
        if (entry.name.startsWith("__MACOSX/") || name.startsWith(".")) continue;
        const extension = name.split(".").pop()?.toLowerCase() ?? "";
        inner.push({ file: new File([entry.data as BlobPart], name, { type: MIME[extension] ?? "" }), folder: join(folder, dirName(entry.name)) });
      }
      if (!inner.length) out.push({ file, from, folder, error: `The ${archive.toUpperCase()} is empty` });
      else out.push(...(await expandFiles(inner, depth + 1, from ?? file.name)));
    } catch (error) {
      const locked = error instanceof Error && /encrypt|password/i.test(error.message);
      out.push({
        file,
        from,
        folder,
        error: locked ? `Password-protected ${archive.toUpperCase()}: it can't be opened here, only kept as it is` : `This ${archive.toUpperCase()} couldn't be opened`,
      });
    }
  }
  return out;
}

const FOLDER_MONTH = /(?:^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s._'-]*(20\d{2}|\d{2})(?![0-9])/i;

// The month a folder is named after ("Apr 26", "April 2026", "Sep-26"), if any
export function monthFromFolder(folder: string): string | null {
  for (const part of folder.split("/").reverse()) {
    const m = part.match(FOLDER_MONTH);
    if (!m) continue;
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase()) + 1;
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  return null;
}
