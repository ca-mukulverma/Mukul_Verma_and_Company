import JSZip from "jszip";

// Downloads one of the app's browser extensions (served from public/<folder>)
// as a ZIP to load unpacked, with this app's address filled in by `fill`
export async function downloadExtensionZip(
  folder: string,
  files: string[],
  zip: { root: string; fileName: string },
  fill: (name: string, text: string) => string
) {
  const archive = new JSZip();
  for (const name of files) {
    const response = await fetch(`/${folder}/${name}`);
    if (!response.ok) throw new Error("The extension files couldn't be loaded");
    archive.file(`${zip.root}/${name}`, fill(name, await response.text()));
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await archive.generateAsync({ type: "blob" }));
  link.download = zip.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
