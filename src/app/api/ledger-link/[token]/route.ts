import { NextResponse } from "next/server";
import { downloadUrl } from "@/lib/r2";
import { readShare } from "@/lib/tally-debtors";

export const dynamic = "force-dynamic";

// GET /api/ledger-link/[token] – the ledger PDF sent on WhatsApp (no sign-in:
// the link itself is the key). Works for 7 days; Redis only.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await readShare(token);
  if (!share) {
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link expired</title></head>` +
        `<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:32rem;margin:auto"><h2>This link has expired</h2>` +
        `<p>Ledger links work for 7 days. Please ask us for a new copy of the ledger.</p></body></html>`,
      { status: 410, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.redirect(await downloadUrl(share.key, share.fileName, 600), { status: 302, headers: { "Cache-Control": "no-store" } });
}
