import axios from "axios";
import type { WorkType } from "./setup";
import { apiError } from "./types";
import { canStore, uploadComplianceFile } from "./upload";
import { monthLabel } from "@/lib/gst-read/working";
import { panOfGstin, gstState } from "@/lib/gst-states";
import { detectReturn, expandFiles, monthFromFolder, type Detected, type InputFile, type ReturnFound } from "./return-detect";
import type { PortalSaved } from "./portal-files";

// Reading, placing and uploading a party's return files, without any screen:
// Upload documents (return-upload.tsx) shows the rows and lets staff fix the
// ones that need a look; the GST download queue (gst-download-queue.tsx)
// saves files fetched from the GST portal on any page with the same rules.
// Each file is read for its return, GSTIN/TAN, period, ARN and filing date,
// goes to the party's registration with its GSTIN and to the period in the
// file, and is uploaded when nothing in it was guessed.

export type Place =
  | { ok: true; period: string; month: string; itemId: string | null; state: "sheet" | "past" | "new_past"; status: string | null }
  | { ok: false; period: string | null; error: string };

// One of the party's GST registrations (the main record first)
export interface ClientRef {
  id: string;
  name: string;
  gstin: string | null;
  tan: string | null;
  pan: string | null;
  state: string | null;
  subscribed: string[];
}

export interface Row {
  id: number;
  file: File;
  from: string | null;
  folder: string;
  sha: string;
  error?: string;
  detected: Detected | null;
  client: ClientRef | null;
  workTypeId: string;
  kind: string;
  month: string;
  idCheck: "match" | "mismatch" | "none";
  idNote: string | null;
  // A GSTIN of the party's PAN in a state not added yet
  newGstin: string | null;
  // Folder of another month, or the same file twice
  warning: string | null;
  place: Place | null;
  include: boolean;
  upload: "uploading" | "done" | "failed" | null;
  message?: string;
}

const WORK_KIND: Record<ReturnFound, string> = {
  GSTR1: "GSTR1",
  GSTR1A: "GSTR1",
  GSTR3B: "GSTR3B",
  GSTR2B: "GSTR3B",
  TDS_RETURN: "TDS_RETURN",
  TDS_CERTIFICATE: "TDS_RETURN",
  TDS_CHALLAN: "TDS_PAYMENT",
};

export function docKind(d: Detected) {
  if (d.gst) {
    if (d.gst.form === "GSTR2B") return "GSTR2B_JSON";
    if (d.gst.form === "GSTR1A") return d.format === "JSON" ? "GSTR1A_JSON" : "GSTR1A_PDF";
    return d.format === "JSON" ? "RETURN_JSON" : "RETURN_PDF";
  }
  if (d.found === "TDS_CERTIFICATE") return "CERTIFICATE";
  if (d.found === "TDS_CHALLAN") return "CHALLAN";
  if (d.format === "OTHER" || !d.found) return d.format === "OTHER" ? "OTHER" : d.format === "JSON" ? "RETURN_JSON" : "RETURN_PDF";
  if (d.found === "GSTR1A") return d.format === "JSON" ? "GSTR1A_JSON" : "GSTR1A_PDF";
  return d.format === "JSON" ? "RETURN_JSON" : "RETURN_PDF";
}

// Which of the party's registrations a file is for, from the GSTIN or TAN in it
export function matchParty(d: Detected, party: ClientRef[]): Pick<Row, "client" | "idCheck" | "idNote" | "newGstin" | "error"> {
  const main = party[0];
  const several = party.length > 1;
  const none = { client: main, idCheck: "none" as const, idNote: null, newGstin: null };
  if (d.gstin) {
    const gstin = d.gstin.toUpperCase();
    const found = party.find((c) => c.gstin?.toUpperCase() === gstin);
    if (found) return { client: found, idCheck: "match", idNote: several ? `GSTIN of ${found.state ?? found.gstin}` : "GSTIN matches", newGstin: null };
    if (!party.some((c) => c.gstin)) return { ...none, idNote: `GSTIN ${gstin}; the client has no GSTIN saved` };
    const pan = main.pan ?? panOfGstin(main.gstin);
    if (pan && panOfGstin(gstin) === pan) {
      return { client: null, idCheck: "none", idNote: null, newGstin: gstin, error: `GSTIN ${gstin} (${gstState(gstin)}) is this party's, but not added yet` };
    }
    return { client: null, idCheck: "mismatch", idNote: null, newGstin: null, error: `GSTIN ${gstin} is not this party's (${party.map((c) => c.gstin).filter(Boolean).join(", ")})` };
  }
  if (d.tan) {
    const tan = d.tan.toUpperCase();
    const found = party.find((c) => c.tan?.toUpperCase() === tan);
    if (found) return { client: found, idCheck: "match", idNote: "TAN matches", newGstin: null };
    const saved = party.find((c) => c.tan)?.tan;
    if (saved) return { client: null, idCheck: "mismatch", idNote: null, newGstin: null, error: `TAN ${tan} is not this party's (${saved})` };
    return { ...none, idNote: `TAN ${tan}; the client has no TAN saved` };
  }
  return none;
}

// Months a file may be in a folder of: a quarterly 3B or 2B covers three
function monthsCovered(d: Detected): string[] {
  if (!d.month) return [];
  if (!d.gst?.quarterly) return [d.month];
  const [y, m] = d.month.split("-").map(Number);
  return [2, 1, 0].map((back) => {
    const date = new Date(Date.UTC(y, m - 1 - back, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

async function sha256(file: File) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The client's own works first
export function worksFor(workTypes: WorkType[], mine: string[]) {
  const active = workTypes.filter((w) => w.active);
  return [...active.filter((w) => mine.includes(w.id)), ...active.filter((w) => !mine.includes(w.id))];
}

export function workFor(workTypes: WorkType[], d: Detected, mine: string[]) {
  if (!d.found) return "";
  let options = worksFor(workTypes, mine).filter((w) => w.kind === WORK_KIND[d.found!]);
  if (d.formNo && options.some((w) => w.returnType === d.formNo)) options = options.filter((w) => w.returnType === d.formNo);
  return options[0]?.id ?? "";
}

// Where each row goes, asked of each client's returns
export async function checkPlaces(list: Row[]) {
  const places = new Map<number, Place>();
  const asked = list.filter((r) => r.client && r.workTypeId && r.month);
  for (const clientId of new Set(asked.map((r) => r.client!.id))) {
    const mine = asked.filter((r) => r.client!.id === clientId);
    const { data } = await axios.post<{ results: Place[] }>(`/api/compliance/clients/${clientId}/returns`, {
      place: false,
      rows: mine.map((r) => ({ workTypeId: r.workTypeId, month: r.month })),
    });
    mine.forEach((r, i) => places.set(r.id, data.results[i]));
  }
  return places;
}

// Ticked when the file can go in as it is; the rest wait for a look
export const isReady = (row: Row) =>
  !row.error &&
  !!row.client &&
  !row.warning &&
  row.idCheck !== "mismatch" &&
  (!row.workTypeId ? row.kind === "OTHER" : !!row.month && row.place?.ok === true);

// Uploaded without asking: ticked, and nothing in it was guessed
export const isSure = (row: Row) => row.include && !row.detected?.monthGuessed && (!!row.workTypeId || !row.detected?.found);

// Why a file read was not uploaded straight away
export function whyHeld(r: Row) {
  return (
    r.error ??
    r.warning ??
    (r.place && !r.place.ok ? r.place.error : null) ??
    (r.idCheck === "mismatch" ? r.idNote ?? "GSTIN differs" : null) ??
    (r.detected?.monthGuessed ? "month read from the name" : null) ??
    (!r.workTypeId && r.detected?.found ? "no matching work for this client" : null) ??
    "check the file"
  );
}

// Reads files (ZIPs opened) into rows, each matched to the party and placed.
// seen: SHA-256 → name of files already in the list, to flag the same file twice.
export async function readRows(
  inputs: InputFile[],
  opts: { party: ClientRef[]; workTypes: WorkType[]; nextId: () => number; seen?: Map<string, string>; onProgress?: (text: string) => void }
): Promise<Row[]> {
  const { party, workTypes, nextId, onProgress } = opts;
  const seen = opts.seen ?? new Map<string, string>();
  onProgress?.("Opening the files…");
  const expanded = await expandFiles(inputs);
  const fresh: Row[] = [];
  let n = 0;
  for (const { file, from, folder, error } of expanded) {
    onProgress?.(`Reading ${++n} of ${expanded.length}: ${file.name}`);
    const detected = error ? null : await detectReturn(file);
    const sha = await sha256(file);
    let warning: string | null = null;
    const same = seen.get(sha);
    if (same) warning = `Same file as ${same === file.name ? "another one" : same} above`;
    else seen.set(sha, file.name);
    const folderMonth = monthFromFolder(folder);
    if (!warning && detected?.month && folderMonth && !monthsCovered(detected).includes(folderMonth)) {
      warning = `In the folder of ${monthLabel(folderMonth)}, but the file is for ${monthLabel(detected.month)}`;
    }
    const match = detected ? matchParty(detected, party) : null;
    fresh.push({
      id: nextId(),
      file,
      from,
      folder,
      sha,
      error: error ?? (canStore(file.name) ? undefined : "This type of file can't be kept") ?? match?.error,
      detected,
      client: match ? match.client : party[0],
      workTypeId: detected && match?.client ? workFor(workTypes, detected, match.client.subscribed) : "",
      kind: detected ? docKind(detected) : "OTHER",
      month: detected?.month ?? "",
      idCheck: match?.idCheck ?? "none",
      idNote: match?.idNote ?? null,
      newGstin: match?.newGstin ?? null,
      warning,
      place: null,
      include: false,
      upload: null,
    });
  }
  onProgress?.("Finding the periods…");
  const places = await checkPlaces(fresh);
  return fresh.map((row) => {
    const placed = { ...row, place: places.get(row.id) ?? null };
    return { ...placed, include: isReady(placed) };
  });
}

export interface UploadOutcome {
  results: Map<number, PortalSaved>;
  done: number;
  // Periods marked filed from their returns
  filed: number;
  // The whole upload failed (the periods couldn't be found)
  error: string | null;
}

// Uploads rows: periods first (past periods that don't exist yet are
// created), then the files. onRow reports each row's progress.
export async function uploadRows(list: Row[], onRow: (id: number, patch: Partial<Row>) => void = () => undefined): Promise<UploadOutcome> {
  const results = new Map<number, PortalSaved>();
  let done = 0;
  let filed = 0;
  let failure: string | null = null;
  const placeOf = (r: Row) => `${r.client!.id}|${r.workTypeId}|${r.month}`;
  const placed = new Map<string, Place>();
  const uploadedTo = new Set<string>();
  try {
    const forItems = list.filter((r) => r.workTypeId);
    const keys = [...new Set(forItems.map(placeOf))];
    for (const clientId of new Set(keys.map((k) => k.split("|")[0]))) {
      const mine = keys.filter((k) => k.startsWith(`${clientId}|`));
      const { data } = await axios.post<{ results: Place[] }>(`/api/compliance/clients/${clientId}/returns`, {
        place: true,
        rows: mine.map((key) => {
          const same = forItems.filter((r) => placeOf(r) === key);
          const [, workTypeId, month] = key.split("|");
          return {
            workTypeId,
            month,
            arn: same.find((r) => r.detected?.arn)?.detected?.arn ?? null,
            filedAt: same.find((r) => r.detected?.filedAt)?.detected?.filedAt ?? null,
          };
        }),
      });
      mine.forEach((key, i) => placed.set(key, data.results[i]));
    }
    // Oldest first, each period's JSON before its PDF, GSTR-1 before GSTR-3B,
    // so periods complete and get filed in order
    const order = (r: Row) => `${r.client!.id}|${r.month}|${["GSTR1", "IFF", "GSTR1A", "GSTR3B", "GSTR2B"].indexOf(r.detected?.gst?.form ?? "")}|${r.detected?.gst?.source === "JSON" ? 0 : 1}`;
    const uploadedGst = new Set<string>();
    for (const row of [...list].sort((a, b) => order(a).localeCompare(order(b)))) {
      const place = row.workTypeId ? placed.get(placeOf(row)) : null;
      if (place && (!place.ok || !place.itemId)) {
        onRow(row.id, { upload: "failed", message: place.ok ? "No period" : place.error });
        results.set(row.id, { name: row.file.name, ok: false, message: place.ok ? "No period for it" : place.error });
        continue;
      }
      onRow(row.id, { upload: "uploading" });
      try {
        const result = await uploadComplianceFile(row.file, {
          clientId: row.client!.id,
          itemId: place?.ok ? place.itemId : null,
          kind: row.kind,
          gst: place?.ok ? row.detected?.gst ?? null : null,
        });
        if (result.filed?.startsWith("Marked filed")) filed++;
        if (row.detected?.gst) uploadedGst.add(row.client!.id);
        if (row.workTypeId) uploadedTo.add(placeOf(row));
        onRow(row.id, { upload: "done", place: place ?? row.place, message: result.filed ?? undefined });
        results.set(row.id, { name: row.file.name, ok: true, message: result.filed ?? null });
        done++;
      } catch (error) {
        const failed = error instanceof Error && !axios.isAxiosError(error) ? error.message : apiError(error);
        onRow(row.id, { upload: "failed", message: failed });
        results.set(row.id, { name: row.file.name, ok: false, message: failed });
      }
    }
    // Periods locked by an earlier one uploaded later in the batch
    if (uploadedGst.size) {
      const { data } = await axios.post<{ filed: number }>("/api/compliance/gst-working/file", { clientIds: [...uploadedGst] });
      filed += data.filed;
    }
  } catch (error) {
    failure = apiError(error);
    for (const row of list) if (!results.has(row.id)) results.set(row.id, { name: row.file.name, ok: false, message: failure });
  } finally {
    // A past period made for this upload whose files all failed is removed
    // again, so it doesn't show as done without its files
    for (const [key, place] of placed) {
      if (place.ok && place.state === "new_past" && place.itemId && !uploadedTo.has(key)) {
        await axios.delete("/api/compliance/history", { params: { itemId: place.itemId } }).catch(() => undefined);
      }
    }
  }
  return { results, done, filed, error: failure };
}

// Files fetched from the GST portal, saved without Upload documents on the
// page: the sure ones are uploaded; any that would need a look are reported
// (to upload by hand from the client's page)
export async function saveFilesHeadless(files: File[], party: ClientRef[], workTypes: WorkType[]): Promise<PortalSaved[]> {
  let id = 1;
  const rows = await readRows(
    files.map((file) => ({ file, folder: "" })),
    { party, workTypes, nextId: () => id++ }
  );
  const now = rows.filter(isSure);
  const { results } = now.length ? await uploadRows(now) : { results: new Map<number, PortalSaved>() };
  return rows.map(
    (r) =>
      results.get(r.id) ?? {
        name: r.file.name,
        ok: false,
        message: `Not saved: ${whyHeld(r)}. Upload it from the client's page (Compliance → Clients → Upload documents)`,
      }
  );
}
