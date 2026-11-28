import type { Metadata } from "next";
import { packForToken } from "@/lib/desk-links";
import { SuspenseForm } from "@/components/desk/suspense-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Please explain these bank entries", robots: { index: false, follow: false } };

// /s/<token> – the client's phone page for bank entries MVC could not identify (no sign-in; the link is the key).
export default async function SuspensePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await packForToken(token).catch(() => null);
  if (!found) {
    return (
      <main className="mx-auto max-w-xl p-6 text-center">
        <h1 className="text-xl font-semibold">This link has expired</h1>
        <p className="mt-2 text-muted-foreground">Please ask MVC &amp; Company for a new link.</p>
      </main>
    );
  }
  return <SuspenseForm token={token} pack={found.pack} answered={found.answered} />;
}
