# Sending bills straight into Tally (design, for approval)

Today the billing manager downloads one Tally XML file per billing entity
(Billing → Tally) and imports each file in TallyPrime by hand. This design
replaces that with one click in the app, on the PC where Tally runs. Nothing
is written in code until this document is approved.

Agreed so far (16 Nov 2026; TallyPrime release 7.1):

- **Option A: a browser extension** on the Tally PC (like the GST and
  WhatsApp extensions) carries the bills from the app into Tally.
- **Only on a click.** Nothing is ever sent to Tally automatically.
- **One Tally company for MVC work:** *Mukul Verma & Co.* holds the bills of
  MVC & Company (GST), CA Mukul Verma, CA Harsh Verma and Verma Law
  Associates. **B Edge** gets its own Tally later; until then it stays on the
  XML download.
- **Number series as in the app** (see *Number series* in BILLING.md). The
  series used in Tally so far are not carried on.
- **Non-GST bills are recorded in Mukul Verma & Co.'s books**, with every
  line marked *Non-GST*.

## How the Tally company is kept today

From a read-only extract of *Mukul Verma & Co.* (1 Apr – 31 Oct 2026,
1,099 sales vouchers):

| Area | In Tally |
|---|---|
| GST | One registration, Madhya Pradesh |
| Voucher type | One, **Sales**, for every bill; numbering *Automatic (Manual Override)* |
| Entry mode | **Accounting Invoice** (no stock items) |
| Service ("item") | Each service has its own **income ledger** under *Sales Accounts*, in sub-groups (Gst, Income Tax Returns, Statutory & Tax Audits, Certification, …), about 124 ledgers |
| Line description | The income ledger line carries a description, e.g. ledger *Gst Return Monthly*, description "GST Return - June 26" |
| Services per bill | One (1,096 of 1,099 bills) |
| Tax ledgers | `CGST`, `SGST`, `IGST` (Duties & Taxes), `Round Off` (Indirect Expenses) |
| Narration | Client name, a tab, then the work |
| Party ledgers | Group *Sundry Debtor*, with sub-groups by who brings the client; bill-wise mostly off |
| Bills without GST | 328 already, in the same Sales voucher type |

## What the voucher will look like

One voucher per bill, in the same form as the bills entered by hand:

```
Voucher type   Sales                      (MVC & Company, GST)
               Sales - CA Mukul Verma     (non-GST)
               Sales - CA Harsh Verma     (non-GST)
               Sales - VLA                (non-GST)
Mode           Accounting Invoice (Invoice Voucher View)
No. / date     the app's bill number and bill date
Party          the client's (or connector's) Tally ledger      Dr  total
Income ledger  the service ledger, with the line description   Cr  fee
CGST + SGST    in-state GST bills / IGST for other states      Cr  tax
Round Off      if the total is rounded                         Cr/Dr
Narration      client name <tab> work description
```

- **GST bills** (MVC & Company): CGST 9% + SGST 9%, or IGST 18% when the
  client's GSTIN is from another state, as on the printed bill. The party's
  GSTIN, state and place of supply go with the voucher.
- **Non-GST bills** (CA Mukul Verma, CA Harsh Verma, VLA): no tax lines; the
  income line is marked **Non-GST**, so it is not shown as a taxable supply
  with zero tax. Before go-live one sample bill of each kind is entered and
  GSTR-1 in Tally is checked.
- Voucher numbering is sent by the app. Since each name has its own voucher
  type, the same number in two series doesn't clash.
- Each voucher keeps the bill's id (REMOTEID), as now, so an edited bill
  **alters** its voucher and a cancelled bill **cancels** it.

## Service → income ledger

Today the app sends every fee to one ledger ("Professional Fees"). Instead:

- **Billing → Tally → Services**: the list of income ledgers the billing
  manager can pick. It starts with **all 124 income ledgers** of *Mukul Verma
  & Co.* (agreed 16 Nov 2026); ledgers can be hidden, added or renamed there
  later, or read again from Tally by the extension, so names always match.
- **Searchable picker.** Wherever a ledger is chosen (the amount screen, the
  bill, Billing → Tally), the field is a search box: typing any part of the
  name ("gst", "audit", "itr") narrows the list at once; the ledger's Tally
  group is shown beside it, and the ledgers used most recently come first.
- **Defaults, always changeable.**
  - Compliance bills get their work type's ledger filled in, e.g. GSTR-1/3B
    → *Gst Return Monthly*, description "GST Return - June 26".
  - The billing manager or Admin can change the ledger and the description
    on any bill (*Tally ledger* in the bill's menu, or *Set ledger* on the
    Tally tab). On a bill already in Tally the change makes it *Tally update
    due*, and the next send alters the voucher.
  - The default ledger of each work type is set, and can be changed at any
    time, in Billing → Tally → Services; a change applies to bills made
    afterwards.
- **Other bills** (tasks, logged work) have no default: the billing manager
  picks the ledger where the amount is entered; the description defaults to
  the bill's description.
- A bill can't be sent to Tally without an income ledger; the *Send to Tally*
  screen lists those bills first.

The mapping sheet (*Tally_service_ledger_mapping.xlsx*) lists every income
ledger, how often it was used this year and its usual descriptions. For now
all ledgers are shown; billing will update the sheet later, and it can be
uploaded again in Billing → Tally → Services.

## Billing entity settings (Billing → Company profiles)

Each entity already has the Tally company, voucher type and ledger names.
Changes:

- Defaults become `CGST`, `SGST`, `IGST`, `Round Off`; the fixed "Professional
  Fees" sales ledger is replaced by the per-bill income ledger.
- New setting **Send directly to Tally: on/off**. On for the four MVC names,
  all pointing to *Mukul Verma & Co.*; off for B Edge, which keeps the XML
  download until its Tally is set up (then only this setting changes).

## Sending bills (Billing → Tally → Send to Tally)

1. The screen lists the numbered bills waiting for Tally, by entity: new,
   edited (alter) and cancelled (cancel).
2. The billing manager or Admin ticks the bills and sees what will be sent.
3. **Import into Tally**: the extension first checks that TallyPrime is open
   with *Mukul Verma & Co.* loaded, and that every voucher type, party ledger
   and income ledger the bills need exists. If anything is missing, nothing
   is sent and the screen shows an error listing it, e.g. "Voucher type
   'Sales - VLA' does not exist in Mukul Verma & Co. – create it in Tally
   and try again"; after it is created, the same bills are sent with one
   click.
4. Each bill is marked **In Tally** (with the date and who sent it) or
   **Failed** with Tally's reason, e.g. "Ledger 'X' does not exist". Failed
   bills stay waiting; nothing half-done is marked as sent.
5. Missing voucher types and ledgers are reported, never created by the app.

The XML download stays as a fallback.

## On the Tally PC (one time)

- TallyPrime: *F1 → Settings → Connectivity → Client/Server configuration*:
  TallyPrime acts as **Server**, port **9000**; restart Tally.
- The billing team creates the three voucher types in Tally themselves:
  *Sales - CA Mukul Verma*, *Sales - CA Harsh Verma* and *Sales - VLA* (or
  the names set in Company profiles), under *Sales*, numbering *Manual*.
- **The app never creates, changes or deletes anything in Tally except the
  bills it sends.** Voucher types, income ledgers and party ledgers are
  always made by the billing team.
- Install the extension in Chrome on that PC (from the app, as with the
  WhatsApp extension) and sign in to the app.
- Chrome and Tally must both be open when *Import into Tally* is clicked.

## Cost

No running cost: the extension is installed from the app (a Chrome Web Store
listing, if wanted later, is a one-time US$5); a click is a few requests to
the app and the database, during office hours; Tally's import is built into
TallyPrime.

## Still to confirm

- The mapping sheet, updated by billing later (all ledgers shown until then).
- The names of the three new voucher types (the ones above are proposals).

## Build steps

1. **(Done, 17 Nov 2026)** Income ledger per bill: services list, work-type
   defaults, picker on the amount screen; corrected tax ledger defaults.
2. **(Done, 17 Nov 2026)** Voucher in the Accounting Invoice form above,
   per-entity voucher type, Non-GST lines; the XML download uses it, so it
   can be tested by importing the file by hand.
3. Extension: talk to Tally, check ledgers, send, report back per bill.
4. *Send to Tally* screen, results and history; B Edge setting.
