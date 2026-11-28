import type { Metadata } from "next";
import { Download } from "lucide-react";
import { getDownloadLink } from "@/lib/desk-links";
import { releasesFor } from "@/lib/desk-updates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Download Gudakesa Desk", robots: { index: false, follow: false } };

// /get/<token> – a personal download link made by Admin (Control Centre → Download links). No sign-in.
export default async function GetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await getDownloadLink(token).catch(() => null);
  const rel = link ? (await releasesFor(link.code).catch(() => []))[0] : undefined;
  if (!link || !rel) {
    return (
      <main className="mx-auto max-w-xl p-6 text-center">
        <h1 className="text-xl font-semibold">This download link has expired</h1>
        <p className="mt-2 text-muted-foreground">Please ask MVC &amp; Company for a new link.</p>
      </main>
    );
  }
  const until = new Date(link.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Hello {link.person}</h1>
      <p className="mt-2">MVC &amp; Company has sent you the accounting software.</p>
      <div className="mt-6 rounded-xl border p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Gudakesa Desk {rel.version}</h2>
        {rel.notes && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{rel.notes}</p>}
        <a
          href={`/api/public/desk-get/${token}`}
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-3 text-base font-semibold text-white"
        >
          <Download className="mr-2 h-5 w-5" /> Download for Windows
        </a>
        <p className="mt-2 text-xs text-muted-foreground">This link is only for you and works until {until}.</p>
      </div>
      <h3 className="mt-6 font-semibold">How to install (2 minutes)</h3>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        <li>Use the Windows PC on which TallyPrime is used.</li>
        <li>Open the downloaded file <b>GudakesaDesk_Setup_{rel.version}.exe</b>. If Windows asks, click <b>More info → Run anyway</b>.</li>
        <li>Click <b>Install</b>. No administrator password is needed.</li>
        <li>Open <b>Gudakesa Desk</b> from the Start menu. MVC will give you the key and your user ID.</li>
      </ol>
    </main>
  );
}
