import JSZip from "jszip";

// Downloads one of the app's browser extensions (served from public/<folder>)
// as a ZIP to load unpacked, with this app's address filled in by `fill`
// (which may also throw to refuse files that don't belong together). Every
// file is fetched afresh: a copy the browser kept from an older version would
// put old code next to a new manifest.
export async function downloadExtensionZip(
  folder: string,
  files: string[],
  zip: { root: string; fileName: string },
  fill: (name: string, text: string) => string
) {
  const archive = new JSZip();
  for (const name of files) {
    const response = await fetch(`/${folder}/${name}?fresh=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("The extension files couldn't be loaded");
    archive.file(`${zip.root}/${name}`, fill(name, await response.text()));
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await archive.generateAsync({ type: "blob" }));
  link.download = zip.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
