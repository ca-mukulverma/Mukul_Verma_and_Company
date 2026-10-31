import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import { pageLines, readGstJson, readGstPdf, type GstRead, type TextPiece } from "../../src/lib/gst-read/index";
import type { FileDescription, FileFormat, OfficeApi, ReturnType } from "./api";

// Reading, packing and uploading a downloaded return, the same way the
// browser does it in the app (src/components/compliance/upload.ts and
// gst-file.ts): figures read with lib/gst-read, SHA-256 of the original,
// JSON gzipped, upload-url → PUT to R2 → document.

// The app keeps up to 15 MB per file, after compression
const MAX_BYTES = 15 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  json: "application/json",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};
const COMPRESSIBLE = ["application/json", "text/csv"];

export const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

export function contentTypeOf(name: string): string | null {
  return CONTENT_TYPES[extensionOf(name)] ?? null;
}

export function sha256Hex(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

export async function pdfLines(data: Uint8Array, maxPages = 30): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js keeps the buffer, so give it its own copy
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, isEvalSupported: false }).promise;
  const lines: string[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      lines.push(...pageLines(content.items.filter((i): i is TextPiece & typeof i => "str" in i)));
    }
  } finally {
    await doc.destroy();
  }
  return lines;
}

// The figures of a GST return file; null when it isn't one the app reads
export async function readFigures(name: string, data: Uint8Array): Promise<GstRead | null> {
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith(".json")) return readGstJson(JSON.parse(new TextDecoder().decode(data)), name);
    if (lower.endsWith(".pdf")) return readGstPdf(await pdfLines(data));
    if (lower.endsWith(".zip")) {
      // A portal ZIP holds one return file
      const zip = await JSZip.loadAsync(data);
      const inner = Object.values(zip.files).filter((f) => !f.dir && /\.(json|pdf)$/i.test(f.name));
      if (inner.length !== 1) return null;
      return readFigures(inner[0].name, await inner[0].async("uint8array"));
    }
  } catch {
    // Damaged, protected or another kind of file
  }
  return null;
}

export interface LocalFile {
  name: string;
  data: Uint8Array;
}

// The portal sends JSON inside a ZIP. A ZIP of JSON files is opened and each
// JSON is kept on its own (gzipped, like the app's Upload documents does);
// anything else is kept as it came.
export async function unpack(file: LocalFile): Promise<LocalFile[]> {
  if (extensionOf(file.name) !== "zip") return [file];
  try {
    const zip = await JSZip.loadAsync(file.data);
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    if (!entries.length || !entries.every((f) => /\.json$/i.test(f.name))) return [file];
    return Promise.all(entries.map(async (f) => ({ name: f.name.split("/").pop()!, data: await f.async("uint8array") })));
  } catch {
    return [file];
  }
}

export interface UploadTarget {
  returnType: ReturnType;
  month: string;
  format: FileFormat;
  // false: don't read figures (one part of a return in several parts)
  readFigures: boolean;
}

export interface UploadResult {
  description: FileDescription;
  created: boolean;
  filed: string | null;
}

export async function uploadFile(api: OfficeApi, jobId: string, file: LocalFile, target: UploadTarget): Promise<UploadResult> {
  const contentType = contentTypeOf(file.name);
  if (!contentType) throw new Error(`${file.name}: the app doesn't keep this kind of file`);
  const gst = target.readFigures ? await readFigures(file.name, file.data) : null;
  const gzipped = COMPRESSIBLE.includes(contentType);
  const body = new Uint8Array(gzipped ? gzipSync(file.data) : file.data);
  if (body.byteLength > MAX_BYTES) throw new Error(`${file.name} is larger than 15 MB`);

  const description: FileDescription = {
    returnType: target.returnType,
    month: target.month,
    format: target.format,
    fileName: file.name.slice(-150),
    contentType,
    size: body.byteLength,
    sha256: sha256Hex(file.data),
    gzipped,
    gst,
  };
  const link = await api.uploadUrl(jobId, description);
  if (!link.alreadyStored) {
    const response = await fetch(link.url!, {
      method: "PUT",
      body: new Blob([body]),
      headers: { "Content-Type": contentType, ...(gzipped && { "Content-Encoding": "gzip" }) },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`${file.name}: storage answered ${response.status}`);
  }
  const saved = await api.document(jobId, description);
  return { description, created: saved.created, filed: saved.filed };
}
