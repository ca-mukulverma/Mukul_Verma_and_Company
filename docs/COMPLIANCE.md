# Compliance

The **Compliance** section (sidebar → Compliance) runs the firm's recurring
statutory work: GSTR-1, GSTR-3B, TDS payments, TDS returns with Form 16/16A,
advance tax, ITR and any other regular work you add. It replaces the Excel
tracker: every client's status is on one sheet, staff update it with a click,
reminders go out from the same sheet, and finished returns go to billing on
their own.

It is kept separate from **Tasks**, which stay for occasional work.

## In one picture

```
Setup (once)                 Every day (automatic)            Staff, on the sheet
────────────                 ─────────────────────            ───────────────────
Work types + teams     ──►   07:00 IST: next periods     ──►  Remind (WhatsApp / email)
Clients + their works        appear in the sheets             Tick "Data received"
Fees (nil / non-nil)         Locks worked out                 Mark filed + figures
Monthly RCM / TDS            TDS returns without              Attach PDF / JSON
Past periods                 challans → "Not required"        Form 16/16A steps
                             Each person's daily               │
                             digest lists their work          ▼
                                                     Completed ──► Draft bill with the
                                                                   suggested fee ──►
                                                                   billing manager ──►
                                                                   Admin (as today)
```

## Who can do what

| | Admin, Partner | Team member of a work | Other staff |
|---|---|---|---|
| See all sheets, clients, files, reconciliation | ✔ | ✔ | ✔ |
| Update a work's items (data received, filed, files, steps, reminders) | ✔ | ✔ (that work) | Only works that have no team |
| Email files to a client | ✔ | ✔ | ✔ |
| Add monthly RCM / TDS payments of a client | ✔ | ✔ | ✔ |
| Enter past periods | ✔ | ✔ (that work) | Only works that have no team |
| Add works to clients, change fees, change GST frequency | ✔ | | |
| Setup: work types, teams, due dates, files needed, billing | ✔ | | |
| See fees | ✔ | | |
| See Claude's notes and the "Ask Claude" buttons | ✔ | | |

The checks are made on the server, not only hidden on screen.

## First-time setup (Admin / Partner)

1. **Cloudflare R2** for files. One-time steps are under
   [One-time setup: Cloudflare R2](#one-time-setup-cloudflare-r2). Until then,
   everything works except uploading and emailing files.
2. **Compliance → Setup**: for each work, tick its **team** (the 2–3 staff who
   do it this quarter), check the **due date**, the **files needed** to
   complete it, whether it is **billed**, and its **default fees**.
3. **Compliance → Clients**: tick clients (use *Select all shown* and the
   filter) and click **Add work**. Tick every work to add (e.g. GSTR-1,
   GSTR-3B and TDS together), the frequency (GST: monthly or quarterly), the
   **first period to track** and each work's fee. For one client, works it
   already has show ticked and greyed out.
4. For clients who pay **rent, transport, legal fees** etc. under RCM, or
   deduct **TDS on fixed payments**, open the client and add them under
   **Monthly RCM and TDS payments** (see [RCM and fixed TDS](#rcm-and-fixed-tds-never-missed)).
5. Optionally enter **past periods** so the full history is in one place.

The work types that come with the app:

| Work | Frequency | Due date (default) | Completed when | Billed |
|---|---|---|---|---|
| GSTR-1 | Monthly / quarterly | 11th of next month; quarterly 13th | Filed + PDF + JSON | No |
| GSTR-3B | Monthly / quarterly | 20th of next month; quarterly 22nd or 24th (from the GSTIN's state) | Filed + PDF + all RCM lines done | Yes |
| TDS Payment | Monthly | 7th of next month; March: 30 April | Challans entered, or "No TDS" | No |
| TDS Return 24Q | Quarterly | 31 Jul, 31 Oct, 31 Jan, 31 May | Filed with figures; Q4 also Form 16 requested, attached and emailed | Yes |
| TDS Return 26Q | Quarterly | same | Filed with figures + Form 16A requested, attached and emailed | Yes |
| Advance Tax | Quarterly | 15 Jun, 15 Sep, 15 Dec, 15 Mar | Filed (paid) | No |
| Income Tax Return | Yearly | 31 July after the year | Filed + PDF | Yes |

All of these can be changed in Setup, and new works (PF, ESI, GSTR-9, ROC…)
added with **Add work**. *Show in the sheet (days before)* controls how early
a period appears (default 7 days before it ends).

**Government extension:** change the due day in Setup, and change it back
afterwards. Periods that already appeared keep their date.

## The sheets

There are three sheets, made to work like the old Excel tracker:

- **GST sheet** – one month. Columns: Reminder · Data recd · GSTR-1 · 1A ·
  RCM · GSTR-3B · Tax payable · Files · Status. Quarterly (QRMP) clients show
  in the quarter's last month, marked *Qtr*.
- **TDS sheet** – one quarter. Columns: Reminder · Month 1 · Month 2 · Month 3 ·
  24Q · 26Q (with the Form 16/16A steps under each) · Files · Status.
- **Other work** – one work (Advance Tax, ITR, anything added) and one period.

Everything is done **on the sheet**:

- **Click any cell** to open its small window: mark filed, enter TDS figures,
  confirm RCM / TDS lines, add challans, attach files, do the Form 16/16A
  steps, see history. Nothing else needs to be opened.
- **Data recd**: one tick marks GSTR-1 and GSTR-3B of the row together. An
  *Undo* appears for a few seconds.
- **Reminder**: the chat icon sends a reminder for that row; the date and count
  fill in by themselves.
- **Header buttons**: *Remind all with data pending*, and for ticked rows
  *Remind selected* and *Data received*.
- **Filter buttons** above the sheet, each with its count: Data not received,
  To file, Filed – files pending, Overdue, Locked, Completed; **My clients**
  (clients you manage) on top of any of them; and search by name or GSTIN. Your
  last filter on each sheet is remembered on your device.
- The **header row and client column stay in view** while the sheet scrolls.
- The GST, TDS and Other work tabs show how many items are **overdue**.
- In a cell's window, the everyday steps come first; GSTR-1A and the fee are
  under **More options**.
- A link with `?tab=…&month=YYYY-MM&item=<id>` opens a sheet on that period
  with the item's window open (used by *My work → Today*).

Colours (the key is shown above each sheet): **grey** pending · **yellow**
data received · **blue** filed, files or steps still pending · **green**
completed · **red** overdue · 🔒 locked (hover to see why).

Sheets load only when opened and there is no constant refreshing, so the
database can sleep when nobody is using it.

## Statuses

```
Pending → Data received → Filed → Completed
                    (or Not required: TDS return of a quarter without challans)
```

- **Filed** asks for the filing date, ARN/acknowledgement (token / RRR number
  for TDS returns), *Nil return* and the figures.
- **Completed** is set by the app as soon as everything listed under
  *Completed when* above is done. Billable work then goes to billing.
- A filed item that is still waiting shows *"Filed · files pending"* and says
  exactly what is missing.
- **Not filed yet** sets a filed item back. **Reopen** sets a completed item
  back to filed; if its bill is still a draft, the draft is removed and a new
  one is made when it is completed again.

## Locks

| Work | Can't be filed until |
|---|---|
| GSTR-1 | **every earlier GSTR-1 is Completed**, and the **previous GSTR-3B is Filed** |
| GSTR-3B | **this period's GSTR-1 is Filed**, the **previous GSTR-3B is Filed**, and **every RCM line is confirmed or skipped** |

A **TDS return is not locked**. Its window warns when a TDS payment month of
the quarter is not closed or a month has no challans (e.g. "TDS payment not
closed for Jun 2026; No challans paid for May 2026"). It can still be filed;
the warning is kept in its history ("Filed with a warning: …").

- Filed is enough to open the next period, but the earlier item **stays on the
  sheet as "files pending" until it is Completed**.
- For quarterly filers "previous" means the previous quarter.
- Periods before a client's first tracked period don't lock anything. Past
  periods you enter do count.

## RCM and fixed TDS (never missed)

On a client (Compliance → Clients → *Monthly RCM and TDS payments*) add each
regular payment once:

| Field | Example (RCM) | Example (TDS) |
|---|---|---|
| Type | RCM (checked in GSTR-3B) | TDS (checked in the TDS payment) |
| Category / section | Rent – unregistered landlord | 194I(b) |
| Paid to | Mr Sharma | Mr Sharma |
| Fixed amount per month | ₹50,000 (empty if it varies, e.g. transport) | ₹50,000 |
| Rate | 18% → ₹9,000 | 10% → ₹5,000 |
| From month | Aug 2026 | Jul 2026 |

Every GSTR-3B (RCM) and every TDS payment month (TDS) then gets a line for it,
including open periods older than this month when the payment is added late.
**A GSTR-3B can't be marked filed, and a TDS month can't be closed, until each
line is confirmed with its amount or skipped with a reason.** Reasons are
chosen from a list (Not paid this month, Paid by the client directly, Payee
changed, Agreement ended / no longer paid, Other) with optional details; who
confirmed or skipped each line is shown next to it. Skipping with *Agreement
ended* can also stop the payment from that period. For quarterly 3B the fixed
amount is taken for the months of the quarter. The RCM column of the GST sheet
shows how many lines are done (e.g. 1/2).

Removing a payment stops it from this month; months already done keep their
lines. Past periods never get lines and are not checked.

## Completed by and checked by

When a return is marked filed (and when a TDS payment month is closed) the
window asks:

- **Completed by**: the person signed in. Only Admin can choose someone else;
  the change is kept in the history.
- **Checked by**: **Self** is chosen already; pick the colleague who checked it
  if someone else did.

Both show on the item ("Completed by Ramesh · checked by Suresh" or
"self-checked"). Admins and Partners see, on the Overview, how many filings
each person completed in the last 90 days and how many were self-checked.
Past periods don't ask for these.

## TDS step by step

1. **Each month**: open the month's cell, confirm/skip the TDS lines, add the
   challans (section, amount, date, BSR code, challan no.), then **Close month
   (TDS paid)**. With nothing to pay: **No TDS this month**.
2. **After the quarter**: once all three months are closed,
   - a return **without challans** of its kind is marked **Not required**
     automatically (24Q looks at section 192 challans, 26Q at all others). No
     return is filed and nothing is billed. If a challan is added later, it
     opens again.
   - a return **with challans** opens. Mark it filed with the token number and
     the figures (TDS deducted, deposited, deductees, challans).
3. **Form 16 / 16A** (26Q every quarter; 24Q Form 16 after Q4), in the same
   item, no separate task:
   1. *Mark requested* (date and TRACES request number)
   2. *Add Form 16/16A* (attach the downloaded files; several at once)
   3. *Email Form 16A* to the client (address filled from the client)
4. The moment the email goes, the return is **Completed** and its bill goes to
   the billing manager. Until then it shows the steps left (`req ✓ · file ·
   mail`) under its cell.

## GSTR-1A

Upload the GSTR-1A PDF (Upload documents, or the GSTR-1 item's window): it marks
the GSTR-1A filed with its ARN and date and its figures go into the GST
working. It can also be ticked by hand inside the GSTR-1 item. The sheet shows
it in the **1A** column, the reconciliation adds it to GSTR-1, and there is no
separate fee.

## Files

- Attach files from the cell window: **Return PDF**, **Return JSON** (GST
  JSON from the portal wherever available), **Challan**, **Form 16/16A**,
  **Other**. Client-level files go under the client's **Files**.
- **Upload documents** (Compliance → Clients → a client): choose or drop all
  of the client's PDFs, JSONs, ZIPs, RARs or a whole folder together. ZIPs and
  RARs (and ZIPs inside them) are opened and each file inside is read on its
  own. For each file the app reads:
  - GST returns (GSTR-1/IFF JSON and PDF, GSTR-1A PDF, GSTR-3B PDF, GSTR-2B
    JSON): GSTIN, period, ARN, filing date and **all the figures** of the GST
    working (see [GST_WORKING.md](GST_WORKING.md)); a filed return's PDF marks
    its period filed;
  - TDS: Form 27A / provisional receipt (TAN, 24Q/26Q, quarter, token
    number), Form 16A and Form 16 (TAN, quarter or year), challan 281 (TAN;
    the month is taken as the one before the deposit date, so check it);
  - otherwise the file name (e.g. `GSTR3B_…_102024.pdf`).

  Each file goes to the party's GSTIN in it (see
  [Parties with GSTINs in several states](#parties-with-gstins-in-several-states))
  and to the period in it, and is **uploaded straight away**: periods in the
  sheet only get the file (their status is changed in the sheet, or filed by a
  return's PDF); a past period that doesn't exist yet is saved as completed
  with the ARN and filing date read from the file, and removed again if none
  of its files could be uploaded. The GST working on the same page updates.

  A table lists every file with the return found, whether the **GSTIN / TAN
  matches**, the work, file type, period and where it went. Files that need a
  look are **not** uploaded but left highlighted and unticked: another
  party's GSTIN or TAN, a folder of another month, the same file twice, a
  period guessed from the file name (e.g. a challan) or a file that wasn't
  recognised. Fix the row (work, type, period), tick it and **Upload**.
  Scanned PDFs can't be read and are placed by hand. Password-protected ZIPs
  (e.g. from TRACES) can't be opened; they can be kept as they are as a
  client file.
- **Standard file names**: every file of a period, and every typed client
  document, is saved under one name whatever it was called on the computer,
  e.g. `CITY MOTORS - GSTR-3B - Sep 2026.pdf`, `CITY MOTORS - GSTR-1 JSON - Sep
  2026.json`, `CITY MOTORS - Form 16A - Q2 FY 2026-27.pdf`, `CITY MOTORS - PAN
  card.pdf`. A second file of the same name gets " (2)". Downloads and emails
  use these names. Files added to the client's Files without a type keep
  their own name (`src/lib/document-names.ts`).
- **Search** (client Files, Documents tab, Send to Client): type any words in
  any order, e.g. `3b sep`, `gstr1 json 2026`, `form 16a q2`; dashes, spaces
  and full month names don't matter. The chips above the client's Files show
  one file type at a time. The client list also matches every word and GSTIN /
  PAN.
- Files go **straight from the browser to Cloudflare R2**, not through the app
  server, so even large JSON files upload quickly.
- To save space: **JSON and CSV are compressed** in the browser (about 10×
  smaller) and the **same file uploaded twice is stored once**. Up to 15 MB per
  file after compression. Neon only keeps a small row per file.
- **How client emails look** (reminders, documents, GST working, Send to
  Client, bills): one professional layout (`src/lib/email-layout.ts`) with the
  firm's name at the top, "Dear <contact person>" (the responsible person for
  reminders sent to them), the content with numbered lists and tables, "Thanking
  you, Yours sincerely" and a signature with the address, phone and email from
  Billing → Company profiles (CA Mukul Verma for MVC, B Edge for B Edge), and a
  short confidentiality note. Subjects read e.g. `GSTR-3B for Sep 2026 – CITY
  MOTORS | CA Mukul Verma`. Fill in the company profiles so the signature
  carries the full contact details.
- **Email in one click**: tick files (in the cell window or the client's Files)
  and click *Email*. Any staff member can. Files go from the company's billing
  Gmail; if they are larger than about 18 MB together, the email carries
  download links valid for 7 days instead.
- A file can't be removed from a completed period; reopen it first (past periods excepted).

## Parties with GSTINs in several states

A party registered for GST in more than one state has one GSTIN per state,
each with its own returns. On the party's page (Compliance → Clients), Admins
and Partners click **GSTIN of another state**, enter the GSTIN (it must have
the party's PAN) and optionally track its GSTR-1 and GSTR-3B from a month with
the party's frequency and fees. Each GSTIN then has:

- its own row in the GST sheet (the GSTIN shows under the name), periods,
  locks, due dates (by its state), RCM lines, GST working and bills;
- a button with its state at the top of the party's page to switch to it; in
  the client list it is shown under the party (`↳ Maharashtra`).

**Upload documents** on any of the party's GSTINs takes the files of all of
them at once: each file goes to the GSTIN in it. A file with a GSTIN of the
party's PAN that isn't added yet shows *Add Maharashtra GSTIN to this party*;
one click adds it and uploads its files. The owner's name and contacts are
copied to a new GSTIN; **Edit client** can keep them the same on all of the
party's GSTINs.

## Editing a client

**Edit client** on a client's page in Compliance → Clients (or the pencil next
to a client in the list) opens the same details as Clients → Edit: name,
email, GSTIN, PAN/TAN and other numbers, phone numbers and the responsible
person, connector and Tally ledger, address and notes. Admins and Partners can
edit clients, as in Clients.

## Reminders

From a row's chat icon, the header buttons, or for ticked rows:

- **WhatsApp (free)**: the app prepares one message per client (covering all
  its pending work, e.g. "GSTR-1 & GSTR-3B for Sep 2026"). Then either:
  - **Open each chat**, choosing where (remembered on each device):
    *WhatsApp Web* opens in a window on the right half of the screen, reused
    for every chat, so the app stays in view: press Enter there, click *Open
    WhatsApp* here for the next one. *WhatsApp app on this computer* opens the
    desktop app. *Phone* opens the WhatsApp app on a phone.
  - **Send all automatically** with the firm's browser extension (Chrome or
    Edge on a computer, with WhatsApp Web logged in): it opens each chat in
    WhatsApp Web, presses Send, waits 8–15 seconds and moves on, showing
    Sent / Not sent for each client. *Stop* stops it. It sends at most 150 a
    day from one computer.

  The app records that the reminder was prepared (it can't see delivery).

  **Installing the extension** (once per computer): in the reminder window
  after preparing messages, click *download it*, unzip, open
  `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**,
  **Load unpacked** and pick the unzipped folder, then reload the app. The
  download is set up for the address the app was opened from. **Note**:
  WhatsApp's terms don't allow automated sending. Keeping to known clients,
  the pause between messages and the daily limit keeps the risk low, but a
  number can still be restricted; use the firm's WhatsApp Business number,
  not a personal one.
- **Email (free)**: sent straight away from the company's billing Gmail (MVC
  work from the MVC mailbox, B Edge work from B Edge's), shown as
  *Reminder-CA Mukul Verma* or *Reminder-B Edge*. Files emailed to a client
  show as *Document-CA Mukul Verma* or *Document-B Edge*.

Only clients whose work is still **Pending** or **Data received** are
included; once data is received or the return is filed, the client drops out
of the next "remind all".

The message is set per work in Setup and can be changed before sending.
`{client}`, `{work}`, `{period}`, `{due}`, `{taxPayable}` (the tax payable
entered on GSTR-3B / TDS payment, e.g. "Tax payable: ₹12,340.") and `{firm}`
are filled in per client. A 10-digit Indian number gets +91 automatically.

**Who gets it:** the client's **responsible person** (the owner unless the
client form says someone else, e.g. the accountant): their WhatsApp number and
email. Tick *Also send to the owner* in the reminder window to send to the
owner as well. There is no fallback: when the responsible person has no
WhatsApp number, the sheet shows "⚠ No WhatsApp number" under the client and
the reminder is not sent on WhatsApp.

**Gmail limit:** a free Gmail account sends about 500 emails a day, shared with
bill emails. The Overview shows today's count, and a reminder run that would
go over is refused with a message to send the rest tomorrow.

## Billing

- Only works ticked **Bill this work** in Setup are billed (by default
  GSTR-3B, TDS returns and ITR; not GSTR-1, payments or advance tax).
- Every billable period becomes **its own bill**, created **only when the
  period is Completed** (for TDS: after Form 16/16A is emailed).
- The fee is suggested in this order: a fee set on that period (cell window,
  Admin/Partner) → the client's **nil / non-nil** fee → the work's default
  nil / non-nil fee. *Nil return* ticked at filing decides which.
- The bill is a normal **draft** in Billing with the fee filled in and a remark
  saying where it came from (e.g. "Suggested fee ₹1,500 (client's non-nil
  fee)"). The billing manager chooses GST / Non-GST and confirms or changes the
  amount, then Admin gives final approval, exactly as in docs/BILLING.md.
  Billing managers are notified.
- Past periods are never billed.

## Reconciliation (free, no AI)

Compliance → **Reconciliation**:

- **Problems in GST returns of a month**, for all clients: 3B taxable value or
  tax different from GSTR-1 (+1A), ITC claimed above GSTR-2B, RCM paid less than
  the RCM lines.
- **One client's year**: a table per period with GSTR-1 (+1A) vs 3B taxable
  value and tax, ITC claimed vs GSTR-2B, RCM lines vs RCM paid, cash paid and
  totals; and a TDS table with challans paid vs TDS deposited in each return.

GST figures are read from the uploaded return files (they can't be typed in);
the full working in the firm's format, with Excel and PDF, is on each
client's page ([GST_WORKING.md](GST_WORKING.md)). TDS figures are entered
when marking returns filed. It is plain arithmetic done by the app, always
live and free.

## Overview and notifications

- **Overview** shows, for each work, overdue, due in 7 days, data pending, data
  received, files pending and done this month (periods in the sheet only; past
  periods entered for history don't count). The user's own works come first.
- **Every day at about 11:58** (the daily job in `vercel.json`) the app
  creates the coming periods and settles TDS returns without challans. What is
  due in 3 days, overdue and waiting for files in each person's works goes into
  their **daily digest**, one notification that also lists their tasks and
  billing work. The same list is always on **My work → Today**.

## Past periods, frequency changes, stopping

- **Past periods** (client → *Past periods (with return PDF and JSON)*):
  choose the work and a range of months; one row per month or quarter that is
  over, each with filing date, ARN, nil, Completed / Not required and its
  return PDF and JSON. **Saving a row completes it**; a missing PDF or JSON
  shows as a tag ("PDF missing"), and files can be added or removed later.
  To add a whole folder of downloads at once, use **Upload documents** (see
  [Files](#files)): each file is read for its period. A period saved only for
  a file upload that then failed is removed again, and the tick next to a
  period shows only when its required PDF / JSON is there (a warning sign
  otherwise). No RCM/TDS check,
  no reminders, no bills, and no completed/checked by.
- **After a registration**: completing a task whose title is a registration
  (GST, company, partnership, LLP, TAN…) asks *Start compliance for this
  client?*: tick the works, Monthly or Quarterly (QRMP), and the first period.
  Any completed task of a client has a *Start compliance* button too. Monthly
  RCM/TDS payments are added on the client's compliance page as usual.
- **Monthly ↔ quarterly GST** (client → Edit on GSTR-1 or GSTR-3B): choose the
  first period of the new frequency. GSTR-1 and GSTR-3B change together;
  earlier periods keep the old frequency. A period already in the sheet can't
  be changed this way.
- **Stop** a work for a client: no new periods; existing ones stay.

## Claude: what it does, at zero extra cost

Nothing in this app calls Claude or any paid AI service. There is no Anthropic
API key anywhere, so the app can't create an AI bill. Claude is used only
through the firm's existing **Claude Pro** plan:

| What | Where | Cost |
|---|---|---|
| Reconciliation tables and checks | In the app, plain code | ₹0 |
| **Ask Claude** buttons (Admin/Partner): firm summary on Overview, per client on Clients and Reconciliation | Opens claude.ai with the question ready (or copy it); answered on your Pro plan | ₹0 extra |
| Questions about your data in the Claude app | Claude reads the database through the Neon connector, read-only | ₹0 extra |
| **Claude's notes** on the Overview (Admin/Partner only) | A scheduled Claude Code task on your Pro plan writes short notes into the `ComplianceNote` table | ₹0 extra |

Limits that come with ₹0: Claude's notes arrive daily, not live; the nightly
review and your own chats share the Pro usage allowance; and answers to "Ask
Claude" open in your Claude app, not inside this app.

### Claude settings, step by step

**A. Privacy (do this first)**

1. claude.ai → your name (bottom left) → **Settings** → **Privacy**.
2. Turn **off** *Help improve Claude* (use of chats for model training).
3. Settings → **Usage** (or Billing): make sure **Extra usage** is **off**.
   With it off, reaching the Pro limit only means waiting; it never charges.
4. Don't paste client passwords, portal logins or full PAN/Aadhaar lists into
   chats; the database connection gives Claude what it needs.

**B. Let Claude read the data (for "Ask Claude" and your own questions)**

1. claude.ai → Settings → **Connectors** → add **Neon**, and sign in to Neon.
2. On Neon's permission screen, choose **read-only** access and only the
   office project, if those options are shown.
3. In a chat, ask "List the tables in my office database" to check it works,
   then ask it to change something harmless (for example "update one row") and
   confirm it refuses or can't. If it can write, disconnect and reconnect with
   read-only access.
4. The **Ask Claude** buttons now open questions that Claude answers from the
   data.

**C. Nightly notes on the Overview (optional)**

The notes need a database login that can **read the compliance tables and add
notes, nothing else**. Run this once in the Neon SQL editor (Neon console →
the project → SQL Editor), with a strong password of your own:

```sql
CREATE ROLE claude_notes WITH LOGIN PASSWORD 'choose-a-long-password';
GRANT USAGE ON SCHEMA public TO claude_notes;
GRANT SELECT ON "ComplianceWorkType", "ClientCompliance", "ComplianceItem",
  "ComplianceObligationLine", "ClientObligation", "TdsChallan",
  "ComplianceReminder", "ComplianceNote" TO claude_notes;
GRANT SELECT ("id", "contactPerson", "companyName", "gstin") ON "Client" TO claude_notes;
GRANT INSERT ON "ComplianceNote" TO claude_notes;
```

Then:

1. In Neon, copy the connection string for the `claude_notes` login.
2. In Claude Code on the web (claude.ai/code), open the environment's settings,
   add it as a secret named `CLAUDE_NOTES_DATABASE_URL`, and allow network
   access to your Neon host (`*.neon.tech`).
3. Create a scheduled task (daily, e.g. 06:30) with this prompt:

   > Connect with `psql "$CLAUDE_NOTES_DATABASE_URL"`. Look only at compliance
   > items changed in the last day and GST returns of the current and previous
   > month. For each client with something worth a partner's attention
   > (mismatch between GSTR-1 (+1A) and GSTR-3B figures, ITC claimed above
   > GSTR-2B, RCM lines not paid, TDS deposited different from challans,
   > overdue work, items filed but waiting for files for more than 5 days),
   > insert one short note:
   > `INSERT INTO "ComplianceNote" (id, "clientId", body) VALUES (gen_random_uuid()::text, '<client id>', '<note>');`
   > Write at most 15 notes, one or two sentences each, in plain English. Don't
   > change anything else.

4. If scheduled tasks aren't included in your plan, run the same prompt by
   hand in Claude Code whenever you want fresh notes.

The notes show on the Overview for Admins and Partners only.

## One-time setup: Cloudflare R2

About 15 minutes. The free plan includes 10 GB, and downloads are free,
which is several years of return PDFs.

1. **Account**: go to dash.cloudflare.com, sign up with the firm's email, and
   turn on two-step login (My Profile → Authentication).
2. **Turn on R2**: left menu → **R2 Object Storage** → enable. Cloudflare may
   ask for a card or PayPal even for the free plan; Indian cards may need
   international/online transactions turned on in the bank app. Nothing is
   charged within the free allowance.
3. **Two buckets**: `mvc-compliance-docs` (live site) and
   `mvc-compliance-docs-preview` (test deployments). For both: location
   *Automatic* (or Asia-Pacific), storage class **Standard** (not *Infrequent
   Access*, which has retrieval fees), and **public access off** (no r2.dev
   link, no custom domain).
4. **CORS** (lets the app upload): each bucket → Settings → **CORS Policy** →
   Edit. For `mvc-compliance-docs`:

   ```json
   [
     {
       "AllowedOrigins": ["https://mvcompany.vercel.app"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["Content-Type", "Content-Encoding"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Use your own domain instead if the app runs on one. For the preview bucket
   use `"AllowedOrigins": ["*"]` (it only ever holds test files).
   Keep `Content-Encoding` in `AllowedHeaders`: JSON and CSV files are sent
   gzipped, and without it the browser blocks them ("Failed to fetch"). The
   app then falls back to sending them uncompressed, so they still upload,
   just larger.
5. **Access key**: R2 → **Manage R2 API Tokens** → **Create API token** →
   permission **Object Read & Write**, applied to **those two buckets only**.
   Copy the **Access Key ID**, **Secret Access Key** and your **Account ID**
   (the secret is shown once).
6. **Vercel** → the project → Settings → **Environment Variables**:

   | Name | Production | Preview |
   |---|---|---|
   | `R2_ACCOUNT_ID` | account ID | same |
   | `R2_ACCESS_KEY_ID` | access key ID | same |
   | `R2_SECRET_ACCESS_KEY` | secret | same |
   | `R2_BUCKET` | `mvc-compliance-docs` | `mvc-compliance-docs-preview` |

   Never put `NEXT_PUBLIC_` in front of these. Then redeploy. The Overview's
   "File storage is not set up" warning disappears.
7. Optional: Cloudflare → **Notifications**, add a usage alert for R2 at about
   8 GB if offered.

## Costs

| Item | Cost |
|---|---|
| Neon | Small tables (tens of MB a year); files are not in Neon. Sheets load only when opened. Within the free plan |
| Vercel | One more daily job; no extra functions running in the background |
| Cloudflare R2 | Free up to 10 GB, then about ₹1.3 per GB a month |
| WhatsApp reminders | Free (link method) |
| Email reminders and files | Free (existing Gmail accounts, about 500 emails a day shared with bills) |
| Claude | ₹0 extra (Pro plan; no API key in the app) |

## Not included yet

- Reading TDS return figures from files (GST figures are read; see
  [GST_WORKING.md](GST_WORKING.md)).
- GSTR-2B against the Tally purchase register.
- Importing the old Excel tracker (a column-matching import can be added when
  the sheet is available).
- More than one mobile number / email per client (the client master's are used).
- WhatsApp delivery status when chats are opened by hand (the extension shows
  whether Send was pressed, not whether the message was delivered).

## For developers

- Rules (access, item creation, locks, completion, billing): `src/lib/compliance.ts`;
  periods and due dates: `src/lib/compliance-periods.ts`; sheets:
  `src/lib/compliance-sheet.ts`; reconciliation: `src/lib/compliance-reco.ts`;
  storage: `src/lib/r2.ts`; emails: `src/lib/compliance-email.ts`; reading
  uploaded returns: `src/components/compliance/return-detect.ts`; GST working:
  see [GST_WORKING.md](GST_WORKING.md#for-developers); WhatsApp:
  `src/components/compliance/whatsapp-send.ts` and the extension in
  `public/whatsapp-extension` (`__APP_ORIGIN__` is filled in on download).
- API: `src/app/api/compliance/*`; daily job: `src/app/api/cron/compliance`
  (uses `CRON_SECRET`, runs at 01:30 UTC); page: `src/app/dashboard/compliance`;
  components: `src/components/compliance/*`.
- Tables: `ComplianceWorkType`, `ComplianceTeamMember`, `ClientCompliance`,
  `ComplianceItem` (unique per client + work + period start), `ComplianceEvent`,
  `ComplianceDocument`, `ClientObligation`, `ComplianceObligationLine`,
  `TdsChallan`, `ComplianceReminder`, `ComplianceNote`. Migration
  `20261029000000_add_compliance` also adds the default work types.
- A party's other-state GSTINs are `Client` records with `parentClientId` set
  to the party's main record (migration `20261102000000_add_client_gst_registrations`),
  added by `POST /api/compliance/clients/[id]/registrations`; state names:
  `src/lib/gst-states.ts`. Everything else treats them as ordinary clients.
- Items are created by the daily job (previous, current and next period, once
  each should appear) and when a sheet is opened (that period, up to next
  month). Creating is idempotent.
- Environment variables: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; email uses the billing mailbox settings
  (`BILLING_EMAIL_PASSWORD`, `BEDGE_BILLING_EMAIL_PASSWORD`).
