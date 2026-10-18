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

Admin edits each entity's profile in Settings: name, address, PAN, GSTIN and
state (MVC & Company only), bank details, logo and signatory. For now the
profiles hold only the names above, and the other fields stay empty until
they're filled in.

### Number series

- The **GST** and **Non-GST** series restart on **1 April** each year. The
  financial year is part of the number (`27-28/0001`, `2027-28/...`).
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
Billing manager approval
  ▼
Admin final approval ──► bill number + bill date assigned ──► Billing List
```

**Bill date** is the date of Admin final approval. The approval page carries a
notice that bills are dated on approval, so all pending approvals should be
cleared before the end of the month. It also shows how many bills are
waiting. From the 25th of each month, Admin gets a daily reminder while bills
are still waiting for final approval.

### Changes after approval

The billing manager can request an **edit**, **cancellation** or **reissue**
with a reason. Admin approves or rejects the request.

- **Edit**: the bill keeps its number. The previous version is kept in the bill's history.
- **Cancel**: the number stays in the series, marked *Cancelled*.
- **Reissue**: the old bill is cancelled and a new number is issued, linked to the old bill.

If the bill was already exported to Tally, it is flagged **Tally update
needed**, and the next XML export alters or cancels the voucher in Tally.

## Billing List and exports

Only the billing managers (each for their own company) and Admin can see the
Billing List. It is filtered by bill type, date range, client and status.

- **PDF and Word** (`.docx`) bills, either one at a time or several selected
  bills in a ZIP.
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

## Build stages

1. Company (MVC/B Edge) on tasks, work entry form, bill records,
   permissions, the three number series, sending bills for an amount,
   notifications and dashboard sections.
2. Billing manager and Admin approval, the Billing List, and
   edit/cancel/reissue requests.
3. PDF and Word bills, single or bulk.
4. Tally XML export.

The existing "pending billing" approval on tasks is replaced by this flow.
Tasks already waiting for billing approval are carried over as draft bills.
