import { GstRead } from "./types";
import { isGstr1Json, isSalesPdf, readGstr1Json, readSalesPdf } from "./sales";
import { isGstr3bPdf, readGstr3bPdf } from "./gstr3b";
import { isGstr2bJson, readGstr2bJson } from "./gstr2b";

export * from "./types";
export { pageLines, type TextPiece } from "./pdf-lines";

// Reads a GST return file: the parsed JSON, or the text lines of a PDF.
// null: not a GST return this app reads figures from.
export function readGstJson(data: unknown, fileName: string): GstRead | null {
  if (isGstr2bJson(data)) return readGstr2bJson(data, fileName);
  if (isGstr1Json(data)) return readGstr1Json(data, fileName);
  return null;
}

export function readGstPdf(lines: string[]): GstRead | null {
  if (isGstr3bPdf(lines)) return readGstr3bPdf(lines);
  if (isSalesPdf(lines)) return readSalesPdf(lines);
  return null;
}
