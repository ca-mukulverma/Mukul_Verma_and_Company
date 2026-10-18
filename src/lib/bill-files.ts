import JSZip from "jszip";
import { NextResponse } from "next/server";
import { BillDocument, billFileName } from "@/lib/bill-document";
import { renderBillsDocx } from "@/lib/bill-docx";
import { renderBillsPdf } from "@/lib/bill-pdf";

export type BillFileFormat = "pdf" | "docx";

const CONTENT_TYPES: Record<BillFileFormat | "zip" | "xml", string> = {
  xml: "application/xml; charset=utf-8",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
};

export function fileResponse(body: Buffer | Uint8Array, kind: BillFileFormat | "zip" | "xml", fileName: string) {
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": CONTENT_TYPES[kind],
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function renderBill(doc: BillDocument, format: BillFileFormat) {
  return format === "pdf" ? renderBillsPdf([doc]) : renderBillsDocx([doc]);
}

// One file per bill in a ZIP. B Edge numbers repeat across financial years,
// so clashing names get a suffix.
export async function renderBillsZip(docs: BillDocument[], format: BillFileFormat) {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const doc of docs) {
    let name = billFileName(doc, format);
    for (let n = 2; used.has(name); n++) name = billFileName(doc, `${n}.${format}`);
    used.add(name);
    zip.file(name, await renderBill(doc, format));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
