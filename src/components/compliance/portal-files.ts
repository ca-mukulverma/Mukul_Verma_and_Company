// Files fetched from the GST portal (gst-portal.tsx) go to the client's
// Upload documents box (return-upload.tsx), so they are read, placed and
// saved exactly as if staff had dropped them there. Handed over in order:
// the next file is read only once the one before is done.

type Handler = (files: File[]) => Promise<void>;

let handler: Handler | null = null;
let chain: Promise<void> = Promise.resolve();

// Upload documents registers itself while it is on the page
export function onPortalFiles(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

// false: no Upload documents box on this page
export function sendPortalFiles(files: File[]): Promise<boolean> {
  const to = handler;
  if (!to) return Promise.resolve(false);
  const done = chain.then(() => to(files));
  chain = done.catch(() => undefined);
  return done.then(() => true);
}
