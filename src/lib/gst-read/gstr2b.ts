import { addHeads, Gstr2bRead, Heads, subHeads } from "./types";

// GSTR-2B JSON from the portal. A large 2B comes as a summary file (with "fc",
// the number of part files) and part files holding the documents; the totals
// are only in the summary (or in the single file of a small 2B).

/* eslint-disable @typescript-eslint/no-explicit-any */
const section = (s: any): Heads | null =>
  s && typeof s === "object" ? { taxable: 0, igst: s.igst ?? 0, cgst: s.cgst ?? 0, sgst: s.sgst ?? 0, cess: s.cess ?? 0 } : null;

export function isGstr2bJson(data: any): boolean {
  const d = data?.data ?? data;
  return !!d && /^(0[1-9]|1[0-2])20\d{2}$/.test(d.rtnprd ?? "") && typeof d.gstin === "string" && ("itcsumm" in d || "docdata" in d);
}

export function readGstr2bJson(data: any, fileName: string): Gstr2bRead {
  const d = data.data ?? data;
  const summary = d.itcsumm;
  const part: Gstr2bRead["part"] = summary && !d.docdata && typeof d.fc === "number" ? "summary" : summary ? "whole" : "part";
  const partNo = part === "part" ? Number(fileName.match(/_(\d+)\.json$/i)?.[1] ?? NaN) : NaN;
  const avl = summary?.itcavl ?? {};
  // Credit notes received ("othersup") reduce the ITC available
  const available = summary
    ? subHeads(addHeads(section(avl.nonrevsup), section(avl.isdsup), section(avl.imports)), addHeads(section(avl.othersup)))
    : null;
  const unavl = summary?.itcunavl ?? {};
  const rej = summary?.itcRejected ?? {};
  const rtnprd: string = d.rtnprd;
  return {
    form: "GSTR2B",
    source: "JSON",
    gstin: String(d.gstin).toUpperCase(),
    month: `${rtnprd.slice(2)}-${rtnprd.slice(0, 2)}`,
    quarterly: /R2BQ/i.test(fileName),
    arn: null,
    filedAt: d.gendt && /^\d{2}-\d{2}-\d{4}$/.test(d.gendt) ? `${d.gendt.slice(6)}-${d.gendt.slice(3, 5)}-${d.gendt.slice(0, 2)}` : null,
    part,
    fileCount: typeof d.fc === "number" ? d.fc : null,
    partNo: Number.isFinite(partNo) ? partNo : null,
    available,
    rcm: summary ? addHeads(section(avl.revsup)) : null,
    unavailable: summary ? addHeads(...Object.values(unavl).map(section)) : null,
    rejected: summary ? addHeads(...Object.values(rej).map(section)) : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
