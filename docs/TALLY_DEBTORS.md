# Debtors from Tally

**Debtors** (menu → Office → Debtors) shows the **Sundry Debtors** ledgers of
*Mukul Verma & Co.* from TallyPrime. They appear under the groups as made in
Tally, with each client's details from the app. Each ledger can be:

- viewed as in Tally's Ledger Vouchers (Date, Particulars, Vch Type, Vch No.,
  Debit, Credit, Opening Balance, Current Total, Closing Balance; narration on
  request);
- downloaded as **PDF** or **Excel** in the same layout, with no letterhead;
- sent on **WhatsApp** as a link to the PDF that works for 7 days.

Each client's page also has a **Ledger** tab. It finds the client's ledger by
the Tally ledger linked to the client (Billing → Tally), or else by the
client's name. A connector's client is pointed to the connector's ledger,
which is not shown there, because it holds other clients' bills too.

**Who sees it:** Admin, and the partners switched on in Settings →
Permissions → **Debtors**. Every download and send is kept with who did it
(shown under the ledger).

## The update time

Every Debtors screen shows **"Tally data as of …"** in large type, with
**Refresh now**:

- **green**: every scheduled update so far has come;
- **red**: an update did not come (Tally PC off, Tally closed…). Entries
  made in Tally since then are missing;
- the PDF, the Excel and the WhatsApp message carry the same time.

Before a download or a send from data that is not green, the app asks the user
to refresh first, or to confirm.

## How the data gets here

The Tally PC sends the data. The **MV Company Tally** Chrome extension
(`public/tally-extension`, version 1.1.0 or later, the same one used to send
bills into Tally) does this:

- **at 11:30 am, 1:00 pm, 4:00 pm and 7:00 pm IST**. If the PC was off at
  that time, it sends as soon as it is on;
- **on Refresh now**, which anyone allowed can press. The PC checks every 30
  seconds and then reads Tally, usually within 1–3 minutes.

It only *reads* from Tally (Export requests): the Sundry Debtors group and the
groups under it, their ledgers with closing balances, and those ledgers' lines
in the vouchers. **No other ledger leaves the PC.** Entries are kept from the
start of the previous financial year to the end of the current one. Cancelled
and optional vouchers are left out.

### Setting it up (Admin, once, on the Tally PC)

1. TallyPrime: F1 → Settings → Connectivity → "TallyPrime acts as" **Server**
   (or Both), port 9000. Open the company *Mukul Verma & Co.*
2. Chrome on that PC: install or update the extension. Open **Debtors** and
   use **Download the Tally extension**. Unzip it, then go to
   chrome://extensions → Developer mode → **Load unpacked** → `mvc-tally`. To
   update an older copy, replace the files and press the reload button on it.
3. Open **Debtors** on that PC → **Tally PC (Admin)** → check the company
   name and port → **Connect this PC**. The first update runs at once.
4. Keep Chrome and TallyPrime (with the company open) running there in
   office hours.

**Connect again** makes a new key, and the old one stops at once. **Disconnect
the Tally PC** stops the updates; the data already here stays. The key is
handed straight to the extension: it is never shown, and the site keeps only
its hash.

## Cost

- **Neon:** one row per debtor ledger (its lines as JSON), a few MB in all.
  The 30-second checks, the key check, the update time and Refresh now
  requests are served from **Redis**, so they never wake the database. Only an
  update (4 a day, in office hours) and opening Debtors read or write it. An
  update writes only the ledgers that changed (by hash).
- **Cloudflare R2:** a WhatsApp PDF (about 100 KB) is kept 7 days. The daily
  job (`ledger-share-cleanup`) deletes older ones. Downloads are made on the
  spot and not stored.

## For developers

| Part | Where |
|---|---|
| Tally PC → app (key `mvct_…`) | `GET /api/tally-sync/poll`, `POST /api/tally-sync/{plan,upload,commit,error}` |
| Pages | `/dashboard/debtors`, `/dashboard/debtors/[id]`, client page → Ledger tab |
| APIs | `/api/debtors` (list), `/status` (Redis only), `/refresh`, `/connect` (Admin), `/[id]`, `/[id]/file`, `/[id]/share`, `/api/clients/[id]/ledger`, `/api/ledger-link/[token]` (public, 7 days) |
| Code | `src/lib/tally-debtors.ts` (server), `src/lib/tally-debtors-shared.ts` (periods, statement, formats), `src/lib/tally-ledger-files.ts` (PDF / Excel), `src/components/debtors/*`, `public/tally-extension/background.js` (end of file) |
| Tables | `TallyDebtorSync` (one row), `TallyDebtorLedger`, `TallyLedgerEvent`; `User.canViewDebtors` |
| Test | `tests/tally-debtors/e2e.test.mjs`: the extension in Chromium, a stand-in TallyPrime, the app on a test database |
