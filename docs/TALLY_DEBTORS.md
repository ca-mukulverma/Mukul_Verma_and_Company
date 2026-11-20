# Debtors from Tally

**Debtors** (menu → Office → Debtors) shows the **Sundry Debtors** ledgers of
each firm, **MVC** and **B Edge**. Each firm's ledgers come from its own Tally
company, and each company can be kept on its own Tally PC. Choose **MVC**,
**B Edge** or **Both** at the top, then **Recovery** or **Ledgers**:

- **Ledgers:** the ledgers under the groups as made in Tally, with group totals,
  the client or connector each belongs to and the last receipt. The same party
  has a separate ledger in each firm.
- **A ledger:** shown as in Tally's Ledger Vouchers (Date, Particulars, Vch
  Type, Vch No., Debit, Credit, Opening Balance, Current Total, Closing
  Balance; narration on request). It can be downloaded as **PDF** or **Excel**
  in the same layout, with no letterhead, or sent on **WhatsApp** as a link to
  the PDF that works for 7 days.
- **Recovery:** see below.

Each client's page has a **Ledger** tab. It shows the client's MVC ledger and
B Edge ledger separately, each with its own PDF, Excel and WhatsApp. A
connector's client is pointed to the connector's ledger instead, because that
ledger holds other clients' bills too.

**Who sees it:** Admin, and the partners switched on in Settings →
Permissions → **Debtors** (both firms). Every download and send is kept with
who did it, under the firm.

## Recovery

All figures are for a month you choose, for each firm separately, worked out
from the synced Tally ledgers. Entries go back to April of the previous
financial year, so past months are there from the first day.

| Figure | What it is |
|---|---|
| Dues at the start | Debit balances of the debtors on the 1st (credit balances are shown as advances) |
| Billed | Debits from Sales vouchers in the month |
| Received | Credits from Receipt vouchers |
| TDS | Credits whose other ledger is a TDS ledger (e.g. a journal to *TDS Receivable*). **Counted as recovered.** |
| Credit notes and other adjustments | Other credits (credit notes, journals, write-offs). Not counted as recovered. |
| **Recovery %** | (received + TDS) ÷ (dues at the start + billed) |
| Old dues recovered | How much of the dues at the start was collected (payments taken against the oldest bills first) |
| Dues now and their age | Debit balances at month end (or today), by age: 0–30, 31–90, 91–180, 181–365 days, over 1 year. Payments are taken against the oldest bills first, because bill-wise details are mostly off in Tally. |
| Days to collect | Dues now ÷ billing of the last 90 days × 90 |

Below the summary:

- the **last 12 months** (billed and recovered, with the recovery %);
- the figures **by Tally group**. These are the groups right under Sundry
  Debtors, i.e. by who brings the client;
- **whom to chase**: the dues, oldest money first. A party is shown in red when
  nothing has been received for 60 days or more. Each row shows when its
  ledger was last sent, and has a one-click WhatsApp button;
- **WhatsApp follow-ups**: the ledgers sent in the month, and how many of
  those parties paid (received or TDS) within 15 days.

**Both** shows the two firms' month summaries side by side.

On the 1st of each month (or the next day or two, if the daily job missed it),
Admin gets last month's recovery for both firms as a notification.

## The update time

Every Debtors screen shows each firm's **"Tally data as of …"** in large
type, with that firm's **Refresh now**:

- **green**: every scheduled update so far has come;
- **red**: an update did not come, or failed (Tally PC off, company not open…).
  Entries made in Tally since then are missing;
- the PDF, the Excel and the WhatsApp message carry the same time.

Before a download or a send from data that is not green, the app asks the user
to refresh first, or to confirm.

## How the data gets here

Each firm's Tally PC sends that firm's data. The **MV Company Tally** Chrome
extension (`public/tally-extension`, **version 1.2.0** or later, the same one
used to send bills into Tally) does this:

- **at 11:30 am, 1:00 pm, 4:00 pm and 7:00 pm IST**. If the PC was off at
  that time, it sends once as soon as it is on;
- **on Refresh now** for that firm. The PC checks every 30 seconds and then
  reads Tally, usually within 1–3 minutes;
- a **failed** update (Tally closed, company not loaded) is **not tried again
  on its own**. The screen turns red with the reason; press Refresh now once
  Tally is ready.

**How MVC's data is told from B Edge's:** Admin connects a PC *for a firm*
and enters that firm's company name as it appears in Tally. Every read the
extension makes names that company, so Tally answers from that company only.
Staff can keep other companies open and work in them on the same PC, and those
are never read. The firm's company must stay **loaded** in Tally, not shut. The
key the PC gets is the firm's own, so the app knows whose data arrives. One PC
can be connected for both firms if both companies are kept there.

The extension only *reads* from Tally (Export requests): the Sundry Debtors
group and the groups under it, their ledgers with closing balances, and those
ledgers' lines in the vouchers. **No other ledger leaves the PC.** Cancelled
and optional vouchers are left out.

### Setting it up (Admin, once per Tally PC)

1. TallyPrime: F1 → Settings → Connectivity → "TallyPrime acts as" **Server**
   (or Both), port 9000. Keep the firm's company loaded.
2. Chrome on that PC: open **Debtors** and use **Download the Tally
   extension**. Unzip it, then go to chrome://extensions → Developer mode →
   **Load unpacked** → `mvc-tally`. To update an older copy, replace the files
   and press the reload button on it.
3. On that PC, open **Debtors** → **Tally PCs** → the firm's box (MVC or
   B Edge). Enter the **company name exactly as in Tally**, check the port,
   then press **Connect this PC**. The first update runs at once.
4. Keep Chrome and TallyPrime running there in office hours.

**Connect again** makes a new key for that firm, and its old key stops at
once. Changing a firm's company name removes the old company's debtors from
the app; the page asks first. **Disconnect** stops that firm's updates; its
data already here stays.

## Cost

- **Neon:** one row per debtor ledger per firm (its lines as JSON), a few MB in
  all. The 30-second checks, key checks, update times and Refresh now requests
  are served from **Redis**, so they never wake the database. Only an update (4
  a day per firm, in office hours) and opening Debtors read or write it. An
  update writes only the ledgers that changed (by hash). Recovery figures are
  worked out on request and kept in Redis for 10 minutes.
- **Cloudflare R2:** a WhatsApp PDF (about 100 KB) is kept 7 days. The daily
  job (`ledger-share-cleanup`) deletes older ones.

## For developers

| Part | Where |
|---|---|
| Tally PC → app (key `mvct_…`, one per firm) | `GET /api/tally-sync/poll`, `POST /api/tally-sync/{plan,upload,commit,error}` |
| Pages | `/dashboard/debtors?firm=MVC\|BEDGE\|BOTH&view=recovery\|ledgers&month=YYYY-MM`, `/dashboard/debtors/[id]` (`?send=whatsapp`), client page → Ledger tab |
| APIs | `/api/debtors` (both firms), `/status?entity=` (Redis only), `/refresh` `{entity}`, `/connect` (Admin), `/recovery?entity=&month=`, `/[id]`, `/[id]/file`, `/[id]/share`, `/api/clients/[id]/ledger`, `/api/ledger-link/[token]` (public, 7 days) |
| Code | `src/lib/tally-debtors.ts` (server), `src/lib/tally-recovery.ts` (recovery figures), `src/lib/tally-debtors-shared.ts`, `src/lib/tally-ledger-files.ts` (PDF / Excel), `src/components/debtors/*`, `public/tally-extension/background.js` (end of file) |
| Tables | `TallyDebtorSync` (one row per firm, `Company` enum), `TallyDebtorLedger` (unique per firm + name), `TallyLedgerEvent`; `User.canViewDebtors` |
| Daily job steps | `ledger-share-cleanup`, `recovery-report` |
| Test | `tests/tally-debtors/e2e.test.mjs`: two Tally PCs (two Chromiums with the extension) beside two stand-in TallyPrimes, the app on a test database |
