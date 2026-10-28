import axios from "axios";
import type { SheetItem } from "./types";
import type { GstRead } from "@/lib/gst-read";

// Uploads a file straight to Cloudflare R2: the browser works out its SHA-256
// (so a file already stored isn't sent again), gzips JSON and CSV files (they
// shrink about 10×), asks the server for a signed upload link, PUTs the file
// and then records it. If the browser won't send a gzipped file (CORS), it
// is sent as is. A GST return added to a period is read for its figures
// first (see gst-file.ts); the server may then mark the period filed.

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  json: "application/json",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

const COMPRESSIBLE = ["application/json", "text/csv"];

// Whether a file of this name can be kept (the server takes these types only)
export function canStore(fileName: string) {
  return (fileName.split(".").pop()?.toLowerCase() ?? "") in CONTENT_TYPES;
}

async function sha256Hex(data: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gzip(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

const RETURN_KINDS = ["RETURN_PDF", "RETURN_JSON", "GSTR1A_PDF", "GSTR1A_JSON", "GSTR2B_JSON"];

export interface UploadResult {
  item: SheetItem | null;
  // "Marked filed (ARN …)" when the upload filed the period
  filed: string | null;
}

export async function uploadComplianceFile(
  file: File,
  target: {
    clientId: string;
    itemId?: string | null;
    kind: string;
    docType?: string | null;
    financialYear?: number | null;
    // Already read (Upload documents); otherwise read here for return files of a period
    gst?: GstRead | null;
  }
): Promise<UploadResult> {
  if (target.gst === undefined && target.itemId && RETURN_KINDS.includes(target.kind)) {
    const { readGstFile } = await import("./gst-file");
    target = { ...target, gst: await readGstFile(file) };
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[extension] ?? file.type;
  const original = await file.arrayBuffer();
  const sha256 = await sha256Hex(original);
  const canGzip = COMPRESSIBLE.includes(contentType) && typeof CompressionStream !== "undefined";

  const send = async (gzipped: boolean) => {
    const body = gzipped ? await gzip(original) : original;
    const meta = {
      ...target,
      fileName: file.name.slice(-150),
      contentType,
      size: body.byteLength,
      sha256,
      gzipped,
    };
    const { data: link } = await axios.post("/api/compliance/documents/upload-url", meta);
    if (!link.alreadyStored) {
      const response = await fetch(link.url, {
        method: "PUT",
        body,
        headers: { "Content-Type": contentType, ...(gzipped && { "Content-Encoding": "gzip" }) },
      });
      if (!response.ok) throw new Error("The file could not be uploaded to storage. Try again");
    }
    return meta;
  };

  let meta;
  try {
    meta = await send(canGzip);
  } catch (error) {
    // "Failed to fetch": the bucket's CORS policy doesn't allow the
    // Content-Encoding header, so send the file uncompressed instead
    if (!canGzip || !(error instanceof TypeError)) throw error;
    meta = await send(false);
  }
  const { data } = await axios.post("/api/compliance/documents", meta);
  return { item: data.item, filed: data.filed ?? null };
}
