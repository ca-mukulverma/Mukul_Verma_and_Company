# Billing

This is the agreed design for the billing section. It replaces the current
process: work is posted in the WhatsApp billing group, copied into a Google
Sheet and then entered in Tally. In the new process, the app holds every bill
from the moment the work is done until it is exported to Tally.

PDF and Word bills use the firm's approved formats (see *Bill formats*
below).

## Companies and billing entities

Every task and every work entry belongs to one of two companies:

- **MVC** (default)
- **B Edge**: a separate company with its own brand. It works for the same
  clients as MVC.

On the task form there is a **Company: MVC / B Edge** choice. After the task is
created, only the person who created it or an Admin can change it. Tasks show
the company as a badge.

A bill is issued by one of five billing entities. Each entity has its own
number series and its own Tally company:

| Bill type | Issued by | Applies to | GST | Number format | Last number used before go-live |
|---|---|---|---|---|---|
| GST | MVC & Company | MVC work | Yes (tax invoice) | `26-27/0218` | `26-27/0217` (14 Oct 2026) |
| Non-GST | CA Mukul Verma | MVC work | No | `2026-27/26986` | `2026-27/26985` (15 Oct 2026) |
| Non-GST | CA Harsh Verma | MVC work | No | `HV/2026-27/1` | – |
| Non-GST | Verma Law Associates | MVC work | No | `VLA/2026-27/1` | – |
| B Edge | B Edge | B Edge work | No (always) | `BE/26150` | `BE/26149` (30 Sep 2026) |

For MVC work, the MVC billing manager or Admin chooses GST or Non-GST and,
for Non-GST, whose name the bill is raised in: CA Mukul Verma, CA Harsh
Verma or Verma Law Associates. They choose it on the bill, or in the *Enter
amount* window while entering the fee. B Edge bills are always non-GST.

Admin edits each entity's profile in **Billing → Company profiles**: name,
address, phone, email, PAN, bank details, signatory and a note for the bottom
of the bill. MVC & Company also has GSTIN, GST state code and SAC code. The
profiles start with only the names above. They are used in Tally; PDF and
Word bills print the approved formats instead.

GST on a GST bill:
- **CGST 9% + SGST 9%** when the client's GSTIN is from the firm's state.
- **IGST 18%** when the client's GSTIN is from another state.
- A client without a GSTIN is treated as being in the firm's state.
- Until the state code is filled in, the bill shows a single "GST @ 18%" line.

### Number series

- All series restart at **1** on **1 April** each year, with no
  leading zeros except the GST series, which keeps its four digits:
  `27-28/0001`, `2027-28/1`, `HV/2027-28/1`, `VLA/2027-28/1`, `BE/1`. B Edge numbers carry no year, so the
  same B Edge number recurs in different financial years. The financial
  year is stored with every bill to tell them apart.
- On go-live day, Admin sets the **next number** for each series in Settings,
  so bills made by hand until launch are taken into account.
- A bill gets its number only at **Admin final approval**. That keeps the
  series free of gaps. A numbered bill is never deleted. If cancelled, it
  stays in the list marked *Cancelled*.

## Where bills come from

| Source | How the draft bill is created | Who can create it |
|---|---|---|
| App task | Automatically when the task is marked completed | (automatic) |
| Direct work entry | "Log work done" form: company, client, description, date, remark | Anyone |
| B Edge work entry | Same form with company = B Edge | Anyone |

Work done without a task is recorded on **Billing → Log work** by anyone.
The form asks for the company (MVC or B Edge), the client, what was done,
the date and an optional remark. It becomes a draft bill for the billing
manager, exactly like a completed task. Admin and the company's billing
managers are notified of every work entry; the form also lists the partners,
and the ones ticked under **Also notify partners** are notified too.

- **Several at once:** *Add another* adds a row (client, work, date; the new
  row starts with the previous row's client and date). Each row becomes its
  own bill; the remark and partners apply to all of them, and everyone is
  sent one notification for the lot (`POST /api/bills` with `items`).
- **Log again:** in *My entries*, *Log again* fills the form with that
  entry's company, client and work, dated today, for monthly work.
- **Already logged?** While the work is typed, the form looks for the same
  party's bills of the last 60 days with the same work, months and years
  included, so a new month is not a repeat (`/api/bills/duplicates`,
  `src/lib/bill-similarity.ts`). It shows them in amber (work, date, who
  logged it, stage; never amounts) and the work can still be logged.
- *My entries* says where each bill is in plain words ("With Rahul for the
  amount", "With Admin for final approval", "Billed") and how long it has
  waited there.

**New client?** Admins and partners see **Add new client** at the end of
the client search (in *Log work* and in a bill's *Edit details*). It asks
for the contact person, firm name, email or phone, address and GSTIN, saves
the client in the client master and selects it for the bill.

**Not a saved client?** In the client search, choose **Other – enter the
name** (the last entry). Type the name the bill is made out to, and
optionally the address and GSTIN. The same option is in a bill's *Edit
details*, so a billing manager or Admin can add the name later, for
example on a bill from a task created without a client.
- The bill, the PDF/Word file and the Tally voucher use the entered name,
  address and GSTIN.
- In Tally, the party ledger is that name, and it must exist in Tally.
- The name is kept on the bill only; no client record is created.

**Tasks that are not billed.** When a completed task's bill reaches the
billing manager, the bill shows **No billing** (in Drafts, Awaiting
amount, Amount entered and Not billable). The billing manager or Admin
gives an optional reason, and the task and its bill are deleted
completely, with the task's comments. The client's history keeps a line
that the work was done without billing, and the Admins, the task's
creator and its assignees are notified. For task bills, No billing
replaces *Not billable*; work logged directly keeps *Not billable*.

**The amount setter can stop a bill.** When a bill is sent to someone for the
amount and they feel the work should not be billed, they click **Not
billable** (next to *Enter amount* and *Send back*) and say why. The bill is
set aside as Not billable, and Admin and the billing managers are notified
with the reason; they can **Reopen** it if they disagree.

Each task or work entry becomes **one bill**. Bills are never combined.

Bills never show expenses. They show the professional fee only, plus GST on
GST bills.

## Making it quick

- **Plain stages.** Statuses say whose turn it is: *New – to bill*, *With
  partner for amount*, *Amount in – to approve*, *With Admin for final
  approval*, *Billed*. Each waiting bill shows how many days it has been at
  its stage: amber from 2 days, red from 3 (overdue, as in the red alert).
- **Longest-waiting first.** The work lists (the billing manager's stages,
  *Awaiting my amount*, *Final approval*) show the oldest first; *All*, *My
  entries* and the Billing List show the newest first.
- **GST / Non-GST chosen for you.** A new MVC bill takes the type of the
  client's last bill (not cancelled or not billable), also when a client is
  chosen later in *Edit details*. The billing manager can still change it.
- **Earlier fees.** *Enter amount* lists up to four earlier fees of the same
  party and company, similar work first (`/api/bills/:id/fee-hints`); a
  click fills the fee in. The billing managers and the person the bill was
  sent to for the amount see these.
- **Many bills at once.** In *New – to bill*, *Sent back* and *With
  partners*, the billing manager ticks bills (or *Select all*) and sets
  GST / Non-GST for all of them, or sends them all to one partner or Admin
  for the amount; that person gets one notification (`/api/bills/bulk`
  with `set_type` / `request_amount`).
- **Remark when sending for the amount.** *Send for amount* (one bill or
  many) takes an optional remark. It goes into the notification and the
  history, and is shown on the bill's card while it awaits the amount
  (`amountRequestNote`; replaced the next time the bill is sent).
- **Amounts straight in the list.** In *Awaiting my amount*, each bill has a
  fee box; *Save all* saves every amount typed. *Enter amount* still opens
  the full window with the earlier fees.
- **From the notification to the bill.** The "awaiting your amount"
  notification opens that bill's *Enter amount* window.
- **Approve & email.** On *Final approval*, Admin can number the bills and
  open the email window for them in one step (up to 30), or use *Email to
  parties* on the message shown after approving.
- **Tally due.** The *Billing settings* button and its *Tally export* item
  show how many numbered bills are still to be sent (or sent again) to
  Tally.
- **Tabs.** *Change requests* appears only while a request is waiting. The
  company tabs also show, in grey, how many bills are with partners for
  the amount.
- **Search** finds bills by bill number and fee too, for the billing
  managers and in the Billing List.
- **Filters are remembered** on each device for the billing manager's lists.

## Roles and visibility

| Permission | Granted to | Can see / do |
|---|---|---|
| Admin | Admin role | Everything. Gives final approval and approves edit/cancel/reissue requests |
| MVC billing manager | Selected Partner(s)/Admin | All MVC bills and amounts. Sets GST/Non-GST, enters or requests amounts, approves, requests edit/cancel/reissue, exports |
| B Edge billing manager | Selected Partner(s)/Admin | Same as above, but only for B Edge bills |
| Billing List viewer | Partner(s) Admin allows | The Billing Lists Admin ticks for them (GST – MVC & Company, each Non-GST name, B Edge; all by default): amounts, bill numbers, downloads and emailing those bills to clients. Can't change bills, approve or export to Tally |
| Amount setter | Admin, or a Partner Admin has allowed to enter amounts, that a bill is sent to | Only the bills sent to them. Enters the amount, sends the bill back with a remark, or marks it Not billable with a reason |
| Everyone else | Executives, consultants and the other Partners | Can log work done. Never sees amounts, bill numbers or the Billing List |

Amounts are removed **on the server** for anyone without permission. Hiding them
on screen is not enough, because the data can be read from the browser.

## Bill workflow

```
Draft (task completed / direct work / B Edge work)
  │  MVC: billing manager selects GST (MVC & Company) or Non-GST (CA Mukul Verma)
  │  B Edge: automatically B Edge, non-GST
  ▼
Awaiting amount ── billing manager enters it, or sends it to an allowed Partner/Admin
  │                 who enters it or sends it back with a remark
  │
  ├─ entered by the billing manager or Admin ─────────────────────┐
  ▼                                                               │
Amount entered by someone else (GST calculated automatically:     │
  CGST+SGST in-state, IGST otherwise)                             │
  ▼                                                               │
Billing manager approval (one bill or several selected at once)   │
  ▼  ◄────────────────────────────────────────────────────────────┘
Admin final approval ──► bill number + bill date assigned ──► Billing List
  (one or several at once; or "Return" to the billing manager with a remark)
```

**Sent back and returned bills are marked on the bill.** When the person
asked for the amount sends a bill back, or Admin returns it at final
approval, the bill keeps who did it, when, the comment and how many times it
has gone back (`returnKind`, `returnRemark`, `returnedAt`, `returnedById`,
`returnCount`). While the bill is still where it was sent back to (Draft
after a send-back, Amount entered after Admin's return), its card shows a red
**Sent back** / **Returned by Admin** badge next to the status and the
comment in full in a red box, and it is listed under the billing manager's
**Sent back** filter (with its count). Once the bill moves on, the comment
stays on it as a quieter "Earlier sent back by …" note, so the partner or
Admin who sees it next knows what was asked for. Every bill dialog (enter or
send for the amount, return, not billable, …) shows the comment too. The
marker is cleared at final approval; earlier comments stay in the history.
Only people who see the amount see the comment, as with the history.
A partner losing permission to enter amounts counts as a send-back.

An amount entered by the company's billing manager or by Admin counts as
the billing manager's approval: the bill goes straight to Admin's final
approval, and its history shows both steps. Only an amount entered by
someone else (a partner the bill was sent to) waits under *Amount entered*
for the billing manager.

When several bills are approved together, they are numbered in order of
work date. A task's bill keeps what the old billing approval did. At final
approval, the task is saved to the client's history and then removed from the
task list. The bill keeps the work description. Approving many bills at once
is a single step: if it fails, none of them is approved and no number is
used.

**Bill history** lists every step taken on a bill. "Created" is shown from
the bill itself (who logged it and when) rather than stored. A year after the
bill date, the nightly cleanup job (`/api/cron/cleanup-notifications`) removes
the steps on the way to the bill (type set, sent for amount, amount entered,
sent back, details or company changed, billing manager approval, returned by
Admin). What happened to the numbered bill stays: final approval, amount
changes, edit/cancel/reissue requests and decisions, and emails.

**Bill date** is the date of Admin final approval. The approval page carries a
notice that bills are dated on approval, so all pending approvals should be
cleared before the end of the month. It also shows how many bills are
waiting. From the 25th of each month, Admin gets a daily reminder at 10:00
(Indian time) while bills are still waiting for final approval. This is the
`/api/cron/billing-reminders` job in `vercel.json`, which uses the same
`CRON_SECRET` as the other scheduled jobs.

### Changes after approval

The billing manager can request an **edit**, **cancellation** or **reissue**
with a reason. Admin approves or rejects the request.

- **Edit**: the bill keeps its number. The fee, work description and work
  date can change. The previous version is kept in the bill's history.
- **Cancel**: the number stays in the series, marked *Cancelled*.
- **Reissue**: the old bill is cancelled and a new number is issued, linked to
  the old bill. A reissue can also change the client and, for MVC, GST or
  Non-GST. The new number then comes from that series.

Only one request per bill can wait for Admin at a time.

### Admin edits the amount

Admin can correct the fee directly, without a request, at any stage after
it is entered: *Amount entered*, *Awaiting final approval* (**Edit amount**
on the bill) and *Approved* (**Edit amount** in the bill's ⋮ menu in the
Billing List). A reason is optional. The bill keeps its number and date;
the history records the old and new amount. The billing managers and the
person who entered the amount are notified.

If the bill was already exported to Tally, it is flagged **Tally update
due** (highlighted in the Billing List), and the next XML export alters or
cancels the voucher in Tally. This also applies when Admin edits the amount
of an exported bill; the notification then says that Tally must be updated.

## Billing List and exports

Only the billing managers (each for their own company), Admin and the
partners Admin allows to see it can see the Billing List. In Settings →
Permissions, turning **Billing List** on for a partner shows a tick box for each
list (GST – MVC & Company, Non-GST – CA Mukul Verma, CA Harsh Verma, Verma Law
Associates, B Edge); the partner sees, downloads, searches and emails only the
ticked ones (all are ticked at first). It can be filtered by series, bill date range, status
(approved/cancelled) and client or work. It shows fee, GST and total per bill,
with the fee totals for each series.

- **Download Excel**: every bill matching the filters on screen (all pages,
  not only the one shown) as an `.xlsx` file for backup: bill number and
  date, series, client and GSTIN, work, fee, CGST/SGST/IGST, round off,
  total, status, reissue links and email status, with a total row for the
  approved bills and a second sheet recording the filters used.
- **PDF and Word** (`.docx`) bills, one at a time from a bill's ⋮ menu, or
  several selected bills as a ZIP of PDFs, a ZIP of Word files, or one
  combined PDF for printing.
- Cancelled bills carry a "CANCELLED" stamp.
- Amounts are printed under "(Rs.)" headings.

### Bill formats (PDF and Word)

Each bill type has the firm's approved format (`src/lib/bill-formats.ts`;
logos, QR codes and font in `assets/bills`): letterhead and logo, "INVOICE",
bill to (name, address, contact person, email, GSTIN), document number and
date, the work done and fee, amount in words and totals, then the signature,
a "Scan & Pay" UPI QR code and the bank details.

| Bill type | Heading and logo | Bank account | QR code (UPI) |
|---|---|---|---|
| GST | M V C & Company, CA logo, PAN and GSTIN | SBI 44402937256 | 44402937256@sbi |
| Non-GST – CA Mukul Verma | CA Mukul Verma, CA logo; UPI, GPay and PhonePe lines | HDFC 50200049069462 | 9165544594@hdfc |
| Non-GST – CA Harsh Verma | CA Harsh Verma, CA logo | AU Bank 2602 2484 1290 8029 | 7000774130@ybl |
| Non-GST – Verma Law Associates | Verma Law Associates, advocate logo | SBI 44404382030 | 8962197740@sbi |
| B Edge | B-Edge Business Consultants LLP format and logo | SBI 43471559687 | 43471559687@sbi |

- GST bills always show CGST @ 9%, SGST @ 9% and IGST @ 18% rows: CGST +
  SGST for a client in Madhya Pradesh or without a GSTIN, IGST for a client
  registered in another state (from the first two digits of its GSTIN).
- All bills except B Edge round the total to whole rupees with a Round Off
  row. B Edge bills show Other Charges and Discount rows ("-").
- The Word file has the same layout as the PDF, in one framed table, so a
  bill can be adjusted by hand.
- To change a format, edit `src/lib/bill-formats.ts`; to change a logo or QR
  code, replace the file in `assets/bills` and run
  `node scripts/build-bill-assets.mjs`.
- **Tally XML**: one file per billing entity, from the **Tally** tab, because
  each entity is a separate company in Tally. In TallyPrime, use
  *Import → Vouchers*.
  - Each bill becomes a sales voucher. The party ledger is debited with the
    total, and the fee ledger and the GST ledgers are credited. GST vouchers
    also carry the party GSTIN and place of supply.
  - When the bill's total was rounded to whole rupees, the difference goes
    to the **Round Off** ledger (credited when rounded up, debited when
    rounded down), so the voucher total equals the bill. Create that ledger
    in each Tally company (e.g. under *Indirect Expenses*), or enter its
    name in *Company profiles*.
  - A voucher's REMOTEID is the bill's id, so Tally recognises it again
    later:
    - a bill not sent before goes as *Create*;
    - an approved bill edited after it was sent goes as *Alter*;
    - a bill cancelled or reissued after it was sent goes as *Cancel* (the
      reissued bill goes as a new *Create*).
  - Bills cancelled before they were ever sent are not sent.
  - Downloading the file marks its bills as sent. The latest 10 files of
    each series are kept (compressed) and can be downloaded again if an
    import has to be repeated; older files are deleted when a new one is
    made. Two people exporting at the same moment cannot both send the
    same bills.
  - **Ledger names:**
    - The Tally company name, voucher type, fee ledger, CGST/SGST/IGST
      ledgers and round off ledger are set per entity in *Company
      profiles*. Until they're set, the defaults are used: the entity's
      name, "Sales", "Professional Fees", "Output CGST/SGST/IGST", "Round
      Off".
    - Each client's party ledger defaults to the client's name. A billing
      manager can change it on the Tally tab when the name in Tally
      differs. Client ledgers must already exist in Tally.

## Emailing bills

Approved bills are emailed to the party from the **Billing List**:

- one bill from its ⋮ menu (*Email to party*), or
- several selected bills with **Email to parties** (up to 30 at a time).

Each party gets **one email** with all of its selected bills attached as PDFs,
whichever entity issued them. MVC and B Edge bills always go in separate
emails. The email uses the same plain, professional layout as every client
email (`src/lib/email-layout.ts`): the firm's name at the top, "Dear <contact
person>", the bills with their dates and amounts in a small table (and the
total when there are several), a request to quote the bill number when
paying, "Thanking you, Yours sincerely" and the signature *CA Mukul Verma*
(MVC) or *B Edge Business Consultants* (B Edge) with the address, phone and
email from the company profile (CA Mukul Verma's profile for MVC), then a
one-line confidentiality note. No logo or images. The bank details are only on the attached bills, not in
the email itself (see *Keeping bill emails out of spam*). Cancelled bills
are never emailed.

Before sending, the window shows each party with the client's saved email
address. Several addresses can be given, separated by commas. For an "Other"
name or a client without an address, type it in; for a saved client it can
also be saved on the client. An optional message is added to every email.
The bill then shows **Emailed** with the date and the address, and the
bill's history records it.

Billing managers, Admin and partners allowed to see the Billing List can
email bills.

### The billing mailboxes

Each company sends from its own Gmail account, which clients can reply to.
MVC bills go from the firm's own long-used mailbox and B Edge bills from
B Edge's own mailbox; mail from an established address is far less likely to
be filed as spam than mail from a new one.

| Bills | From (name shown) | Address | Password setting | Clients write to |
|---|---|---|---|---|
| MVC | Billing-CA Mukul Verma | camukulverma.bhopal@gmail.com | `BILLING_EMAIL_PASSWORD` | replies to the email |
| B Edge | Billing-B Edge | bedgebusinessconsultants@gmail.com | `BEDGE_BILLING_EMAIL_PASSWORD` | replies to the email |

To set up each one:

1. In that Google account, turn on 2-Step Verification, then create an
   **App password** (Google Account → Security → App passwords).
2. On Vercel, add the environment variable from the table with the app
   password, and redeploy. If the mailbox is a different address, also set
   `BILLING_EMAIL_USER` (MVC) or `BEDGE_BILLING_EMAIL_USER` (B Edge).
3. In that Gmail account, turn on IMAP (see *Delivery* below).

A free Gmail account can send about 500 emails a day.

The same mailboxes also send compliance reminders and documents, each under
its own name so clients can tell them apart in their inbox. Replies to any of
them reach the same mailbox.

| Email | MVC shows as | B Edge shows as |
|---|---|---|
| Bills | Billing-CA Mukul Verma | Billing-B Edge |
| Compliance reminders | Reminder-CA Mukul Verma | Reminder-B Edge |
| Documents (Compliance files, Send to Client) | Document-CA Mukul Verma | Document-B Edge |

A client who has saved the mailbox in their contacts may still see their own
contact name instead.

### Replies (Billing → Bill emails, Admin)

- Bill emails always say "For any query …, please reply to this email";
  replies arrive in the mailbox that sent the bill
  (camukulverma.bhopal@gmail.com or bedgebusinessconsultants@gmail.com).
- **Hidden copy**: an address (e.g. the office email) that gets a BCC of
  every bill email.
- The "Clients can reply" switch only appears for a mailbox that clients are
  asked not to write to (one with a separate contact address); neither
  mailbox has one now.

### Keeping bill emails out of spam

The email is sent under a plain name (*Billing-CA Mukul Verma*) with no
separate Reply-To, and without bank account numbers in the body; a Reply-To
that cannot receive mail or is a different Gmail address, a company name on a free Gmail
address, or bank details in an invoice email from a little-known sender all
make spam filters suspicious. So does the usual invoice-email template (a
"Tax Invoice No. …" subject, a letterhead-style layout with a styled table):
fake-invoice spam looks the same, and Gmail files such emails as spam with
"This message is similar to messages that were identified as spam in the
past". Bill emails are therefore plain notes: a "Billing – Bill no. …"
subject, a simple table of the attached bills, and the bank details only on
the bills. A new Gmail account has no
sending history, so for the first weeks after switching to a new mailbox:

- send a few bills to the firm's own addresses and to friendly clients, and
  have them open the email, mark it **Not spam** and add the billing
  address to their contacts;
- avoid sending many emails at once from a new mailbox;
- for the most reliable delivery, use an address on the firm's own domain
  (e.g. Google Workspace) with SPF, DKIM and DMARC set up.

### Delivery: was the email received?

Against every bill, the Billing List's **Emailed** column shows what
happened to its last email:

| Shown | Meaning |
|---|---|
| **Not emailed** | Never emailed |
| **Emailed on 20 Oct 2026** to … | Gmail accepted it and no failure has been reported |
| **Delivery delayed** + reason | The client's mail server isn't accepting it yet; Gmail keeps trying for up to 2 days. Shown as emailed after 3 days without a failure |
| **Not delivered** + reason | It did not reach the client, e.g. the address does not exist, the domain does not exist, the mailbox is full, or it was blocked as spam |

The Email filter has a **Not delivered** option to find these bills. After
correcting the address, use **Email again** from the bill's ⋮ menu. The
person who sent the email and the billing managers are notified of a
failure, and the bill's history keeps the full technical reason.

How it works:

- An email Gmail does not accept at all (wrong app password, daily limit
  reached, Gmail unreachable) is marked *Not delivered* at once.
- A client's server that refuses the email later makes Gmail send a
  "Delivery Status Notification" to the billing mailbox that sent it. The app reads
  these over IMAP with the same app password and matches each one to its
  email by the email's Message-ID. It reads them when someone opens the
  Billing List (at most every 3 minutes), with the **Check delivery**
  button, and once a day (`/api/cron/billing-email-delivery` in
  `vercel.json`). It only reads the mailbox; nothing there is changed.
- **IMAP must be on** in each billing Gmail account: Settings → *See all
  settings* → *Forwarding and POP/IMAP* → **Enable IMAP** → *Save Changes*.
  *Billing → Bill emails* shows when the mailbox was last read and any
  error.
- Email cannot confirm that the client *read* the bill, or that it did
  not land in their spam folder: servers don't report that. *Emailed*
  means it was accepted and no failure came back.

## Connectors

A connector brings clients to the firm, and their clients' fees are collected
from the connector. Billing managers and Admin add connectors in **Billing →
Connectors** (name, mobile, email, Tally ledger name; the ledger defaults to
the name) and see each connector's clients and numbered bills with the fees
per financial year. A client's connector is chosen on the client form and
applies to all of the client's bills.

- The bill is **made out to the client** as usual.
- In Tally it goes to the **connector's ledger**, with the client in the
  narration.
- It is **emailed to the connector** by default; *Also copy the client* adds
  the client's saved email.
- GST bills of a connector's client **don't show the client's GSTIN** and are
  sent to Tally without it, so they count as **B2C**. Ticking *Show the
  client's GSTIN on this bill* (Edit details, before approval) prints it and
  sends it to Tally, so the bill is **B2B**, still in the connector's ledger.
  Place of supply and CGST + SGST / IGST always follow the client's GSTIN.

The ledger and connector are **fixed on the bill at final approval**, so a
later change of the client's connector or ledger doesn't move numbered bills.
Correcting a ledger name in the Tally tab or on the connector also updates
numbered bills not yet sent to Tally.

## Tally ledger on the client

Only billing managers and Admin see the client form's *Tally ledger name*:
pick a name already in use (from clients, connectors and bills) or type a new
one; empty means the client's name. A client added by anyone else is listed as
*New clients without a Tally ledger* in the billing manager's daily reminder
until the ledger is set (in the client form or the Tally tab).

Every Tally voucher's narration has the work, the client (and GSTIN when it is
shown), the bill number, the connector, and for a reissue the bill it replaces.

## Daily reminder and red alert

At **11:58 AM India time every day, Sundays included** (the daily job,
06:28 UTC in `vercel.json`), everyone's pending billing work is listed in
their **daily digest**, one push and in-app notification that also covers
their tasks and compliance work (see `src/lib/daily-digest.ts`). Single
billing notifications (sent for your amount, approved …) still arrive as
they happen. `/api/cron/billing-reminders` still sends the billing-only
reminder when run by hand. The digest lists:

| Who | What is listed |
|---|---|
| Admin and Partners allowed to enter amounts | Bills waiting for their amount |
| Billing managers (each company) | New work to bill, amounts entered waiting for approval, bills to send to Tally, failed bill emails, new clients without a Tally ledger |
| Admin | Bills waiting for final approval (from the 25th with the month-end note), edit/cancel/reissue requests |

Work waiting **more than 3 calendar days** at its stage (counted from when it
reached the stage, or was sent to that person for the amount) is **overdue**:

- Admin gets a push and in-app notification of everyone's overdue work, by
  person.
- A **red alert** at the top of the dashboard and the Billing page shows each
  person their own overdue work, and Admin everyone's.

People with billing work who haven't turned on phone notifications see a
banner asking them to (Settings → Notifications).

## Dashboards

- **Admin and allowed Partners:** "Bills awaiting your amount" for bills sent to them.
- **Admin:** "Awaiting final approval", with the month-end notice.
- **Billing managers:** count of bills at each stage for their company.

## Notifications

Notifications appear in the app and as push notifications. Billing pushes are
sent with high priority so phones show them at once, and tapping one opens the
tab the bill is waiting in. Each time the app is opened it re-registers the
device for push, so a phone whose push address changed keeps getting them.

| Event | Admin | Billing manager | Amount setter |
|---|---|---|---|
| Work logged (plus the partners ticked on the form) | ✔ | ✔ | |
| Sent for amount | | | ✔ |
| Sent back with remark | ✔ | ✔ | |
| Marked not billable by the amount setter | ✔ | ✔ | |
| Task completed (its bill is waiting) | ✔ | ✔ | |
| Amount entered by someone else | ✔ | ✔ | ✔ |
| Amount entered by billing manager/Admin (awaiting final approval) | ✔ | | ✔ |
| Billing manager approved | ✔ | | |
| Admin final approval / rejection | | ✔ | |
| Edit/cancel/reissue requested | ✔ | | |
| Request approved / rejected | | ✔ | |
| Daily 11:58 AM list of pending work | ✔ | ✔ | ✔ |
| Work over 3 days (everyone's) | ✔ | | |
| Amount changed by Admin | | ✔ | ✔ |

For B Edge bills, "billing manager" means the B Edge billing manager.

## Permissions in the app

- **MVC billing manager** is the existing "Can approve billing" switch for
  partners. It now appears as "MVC Billing Manager" in Settings → Permissions.
- **B Edge billing manager** is a new switch on the same page.
- Admins are always billing managers for both companies.
- **Billing List** is a switch on the same page: the partner sees the whole
  Billing List of both companies and can download and email bills.
- **Can enter amounts** is a switch on the same page. Bills can be sent for the
  amount only to active Admins and to Partners with this switch on. Other
  Partners see billing like executives and consultants. Turning the switch off
  sends the bills waiting for that Partner's amount back to the billing
  managers as drafts.

## Clearing billing data (Billing → Clear data, Admin)

For a fresh start, e.g. after testing, Admin can delete all billing data. The
Admin must enter their login password; with a wrong password nothing is
deleted. The page shows how much will be removed first.

- **Removed:** every MVC and B Edge bill at every stage (including numbered
  bills in the Billing List, cancelled and not billable ones), each bill's
  history and email delivery status, edit/cancel/reissue requests and the
  Tally export history.
- **Kept:** number series, company profiles, Tally ledgers, bill email
  settings, users and their billing permissions, clients, tasks and client
  history.
- Completed tasks that are still in the app come back as new draft bills, so
  no work drops out of billing.
- The number series are not changed; Admin sets the next numbers in
  **Number series** afterwards if needed.
- The reset is recorded in the activity log.

## Build stages

1. **(Done)** Company (MVC/B Edge) on tasks, work entry form, bill records,
   permissions, the three number series, sending bills for an amount,
   notifications and dashboard sections.
2. **(Done)** Billing manager and Admin approval, the Billing List, and
   edit/cancel/reissue requests.
3. **(Done)** PDF and Word bills, single or bulk, and the company profiles.
4. **(Done)** Tally XML export.

The old "pending billing" approval on tasks has been replaced by this flow.
Tasks that were waiting under it were carried over as draft bills when the
stage 2 database update was applied.
