import JSZip from "jszip";
import { GstRead, pageLines, readGstJson, readGstPdf, TextPiece } from "@/lib/gst-read";

// Reads the figures of a GST return file in the browser (see lib/gst-read):
// JSON files are parsed, PDFs are read as text lines with pdf.js.

export async function pdfLines(data: ArrayBuffer | Uint8Array, maxPages = 30): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data) }).promise;
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

export async function readGstBytes(name: string, data: ArrayBuffer): Promise<GstRead | null> {
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith(".json")) return readGstJson(JSON.parse(new TextDecoder().decode(data)), name);
    if (lower.endsWith(".pdf")) return readGstPdf(await pdfLines(data));
    if (lower.endsWith(".zip")) {
      // A portal ZIP holds one return file
      const zip = await JSZip.loadAsync(data);
      const inner = Object.values(zip.files).filter((f) => !f.dir && /\.(json|pdf)$/i.test(f.name));
      if (inner.length !== 1) return null;
      return readGstBytes(inner[0].name, await inner[0].async("arraybuffer"));
    }
  } catch {
    // Not a return this app reads (damaged, protected or another kind of file)
  }
  return null;
}

export async function readGstFile(file: File): Promise<GstRead | null> {
  if (!/\.(json|pdf|zip)$/i.test(file.name)) return null;
  return readGstBytes(file.name, await file.arrayBuffer());
}
