# Billing

This is the agreed design for the billing section. It replaces the current
process: work is posted in the WhatsApp billing group, copied into a Google
Sheet and then entered in Tally. In the new process, the app holds every bill
from the moment the work is done until it is exported to Tally.

Bill layouts (PDF/Word) and Tally ledger names are placeholders for now and
will be replaced with the firm's own formats later.

## Companies and billing entities

Every task and every work entry belongs to one of two companies:

- **MVC** (default)
- **B Edge**: a separate company with its own brand. It works for the same
  clients as MVC.

On the task form there is a **Company: MVC / B Edge** choice. After the task is
created, only the person who created it or an Admin can change it. Tasks show
the company as a badge.

A bill is issued by one of three billing entities. Each entity has its own
number series and its own Tally company:

| Bill type | Issued by | Applies to | GST | Last number used before go-live |
|---|---|---|---|---|
| GST | MVC & Company | MVC work | Yes (tax invoice) | `26-27/0217` (14 Oct 2026) |
| Non-GST | CA Mukul Verma | MVC work | No | `2026-27/26985` (15 Oct 2026) |
| B Edge | B Edge | B Edge work | No (always) | `BE/26149` (30 Sep 2026) |

For MVC work, the MVC billing manager chooses GST or Non-GST. B Edge bills are
always non-GST.

Admin edits each entity's profile in **Billing → Company profiles**: name,
address, phone, email, PAN, bank details, signatory and a note for the bottom
of the bill. MVC & Company also has GSTIN, GST state code and SAC code. The
profiles start with only the names above.

GST on a GST bill:
- **CGST 9% + SGST 9%** when the client's GSTIN is from the firm's state.
- **IGST 18%** when the client's GSTIN is from another state.
- A client without a GSTIN is treated as being in the firm's state.
- Until the state code is filled in, the bill shows a single "GST @ 18%" line.

### Number series

- All three series restart at **1** on **1 April** each year, with no
  leading zeros except the GST series, which keeps its four digits:
  `27-28/0001`, `2027-28/1`, `BE/1`. B Edge numbers carry no year, so the
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

Each task or work entry becomes **one bill**. Bills are never combined.

Bills never show expenses. They show the professional fee only, plus GST on
GST bills.

## Roles and visibility

| Permission | Granted to | Can see / do |
|---|---|---|
| Admin | Admin role | Everything. Gives final approval and approves edit/cancel/reissue requests |
| MVC billing manager | Selected Partner(s)/Admin | All MVC bills and amounts. Sets GST/Non-GST, enters or requests amounts, approves, requests edit/cancel/reissue, exports |
| B Edge billing manager | Selected Partner(s)/Admin | Same as above, but only for B Edge bills |
| Amount setter | Any Partner/Admin a bill is sent to | Only the bills sent to them. Enters the amount or sends the bill back with a remark |
| Everyone else | — | Can log work done. Never sees amounts, bill numbers or the Billing List |

Amounts are removed **on the server** for anyone without permission. Hiding them
on screen is not enough, because the data can be read from the browser.

## Bill workflow

```
Draft (task completed / direct work / B Edge work)
  │  MVC: billing manager selects GST (MVC & Company) or Non-GST (CA Mukul Verma)
  │  B Edge: automatically B Edge, non-GST
  ▼
Awaiting amount ── billing manager enters it, or sends it to a Partner/Admin
  │                 who enters it or sends it back with a remark
  ▼
Amount entered (GST calculated automatically: CGST+SGST in-state, IGST otherwise)
  ▼
Billing manager approval (one bill or several selected at once)
  ▼
Admin final approval ──► bill number + bill date assigned ──► Billing List
  (one or several at once; or "Return" to the billing manager with a remark)
```

When several bills are approved together, they are numbered in order of
work date. A task's bill keeps what the old billing approval did. At final
approval, the task is saved to the client's history and then removed from the
task list. The bill keeps the work description.

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

If the bill was already exported to Tally, it is flagged **Tally update
needed**, and the next XML export alters or cancels the voucher in Tally
(stage 4).

## Billing List and exports

Only the billing managers (each for their own company) and Admin can see the
Billing List. It can be filtered by series, bill date range, status
(approved/cancelled) and client or work. It shows fee, GST and total per bill,
with the fee totals for each series.

- **PDF and Word** (`.docx`) bills, one at a time from a bill's ⋮ menu, or
  several selected bills as a ZIP of PDFs, a ZIP of Word files, or one
  combined PDF for printing.
- Bills use a standard layout until the firm's own formats are supplied:
  - letterhead, then "TAX INVOICE" (GST) or "BILL";
  - bill to, then bill no., date and place of supply;
  - the work done, the fee and the GST lines;
  - the total in words (lakh/crore), bank details and the signature block.
- Cancelled bills carry a "CANCELLED" stamp.
- The standard PDF fonts have no ₹ sign, so PDFs print amounts as "Rs.".
  Word files use ₹.
- **Tally XML**: one file per billing entity (separate Tally companies). It
  contains the bills not yet exported, plus edits and cancellations. Bills
  are marked as exported to avoid duplicates. Ledger names are set in
  Settings.

## Dashboards

- **Partner/Admin:** "Bills awaiting your amount" for bills sent to them.
- **Admin:** "Awaiting final approval", with the month-end notice.
- **Billing managers:** count of bills at each stage for their company.

## Notifications

Notifications appear in the app and as push notifications.

| Event | Admin | Billing manager | Amount setter |
|---|---|---|---|
| Sent for amount | | | ✔ |
| Sent back with remark | ✔ | ✔ | |
| Amount entered | ✔ | ✔ | ✔ |
| Billing manager approved | ✔ | | |
| Admin final approval / rejection | | ✔ | |
| Edit/cancel/reissue requested | ✔ | | |
| Request approved / rejected | | ✔ | |
| Month-end reminder (from the 25th) | ✔ | | |

For B Edge bills, "billing manager" means the B Edge billing manager.

## Permissions in the app

- **MVC billing manager** is the existing "Can approve billing" switch for
  partners. It now appears as "MVC Billing Manager" in Settings → Permissions.
- **B Edge billing manager** is a new switch on the same page.
- Admins are always billing managers for both companies.
- Bills can be sent to any active Partner or Admin to enter the amount.

## Build stages

1. **(Done)** Company (MVC/B Edge) on tasks, work entry form, bill records,
   permissions, the three number series, sending bills for an amount,
   notifications and dashboard sections.
2. **(Done)** Billing manager and Admin approval, the Billing List, and
   edit/cancel/reissue requests.
3. **(Done)** PDF and Word bills, single or bulk, and the company profiles.
4. Tally XML export.

The old "pending billing" approval on tasks has been replaced by this flow.
Tasks that were waiting under it were carried over as draft bills when the
stage 2 database update was applied.
