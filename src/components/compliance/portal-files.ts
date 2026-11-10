// Files fetched from the GST portal (gst-download-queue.tsx) go to the
// client's Upload documents box (return-upload.tsx) when it is on the page
// for that party, so any that need a look stay in its table to fix. Without
// it, the queue saves them itself (return-save.ts). Handed over in order:
// the next file is read only once the one before is done. The answer says,
// per file read (a ZIP gives the files inside), whether it was uploaded.

export interface PortalSaved {
  name: string;
  ok: boolean;
  // Uploaded: "Marked filed (ARN …)" or null; not: why it waits or failed
  message: string | null;
}

type Handler = (files: File[]) => Promise<PortalSaved[]>;

let handler: { clientIds: string[]; take: Handler } | null = null;
let chain: Promise<unknown> = Promise.resolve();

// Upload documents registers itself, with the party's registrations, while
// it is on the page
export function onPortalFiles(clientIds: string[], take: Handler) {
  const mine = { clientIds, take };
  handler = mine;
  return () => {
    if (handler === mine) handler = null;
  };
}

// null: no Upload documents box for this client on the page
export function sendPortalFiles(clientId: string, files: File[]): Promise<PortalSaved[] | null> {
  const to = handler;
  if (!to || !to.clientIds.includes(clientId)) return Promise.resolve(null);
  const done = chain.then(() => to.take(files));
  chain = done.catch(() => undefined);
  return done;
}
