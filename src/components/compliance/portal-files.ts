// Files fetched from the GST portal (gst-portal.tsx) go to the client's
// Upload documents box (return-upload.tsx), so they are read, placed and
// saved exactly as if staff had dropped them there. Handed over in order:
// the next file is read only once the one before is done. The answer says,
// per file read (a ZIP gives the files inside), whether it was uploaded.

export interface PortalSaved {
  name: string;
  ok: boolean;
  // Uploaded: "Marked filed (ARN …)" or null; not: why it waits or failed
  message: string | null;
}

type Handler = (files: File[]) => Promise<PortalSaved[]>;

let handler: Handler | null = null;
let chain: Promise<unknown> = Promise.resolve();

// Upload documents registers itself while it is on the page
export function onPortalFiles(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

// null: no Upload documents box on this page
export function sendPortalFiles(files: File[]): Promise<PortalSaved[] | null> {
  const to = handler;
  if (!to) return Promise.resolve(null);
  const done = chain.then(() => to(files));
  chain = done.catch(() => undefined);
  return done;
}
