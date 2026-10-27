# Send to Client

When a client asks for something (their last ITR, filed GST returns, a bank
loan file, their PAN, a portal login), staff send it in one click instead of
hunting for files and typing an email.

Open a client and click **Send to Client**. It is also in the ⋮ menu (or the
**Send** button) on the client list.

## How it works

1. **Pick what the client asked for** from the list of ready-made requests.
2. The app **picks the files and details** for that client:
   - return PDFs, challans and Form 16/16A from the compliance sheet for the
     period (last month, last quarter, last financial year … — change the
     period if needed);
   - registrations (PAN card, GST certificate …) and yearly papers (ITR,
     computation, financials …) from the client's **Documents** tab, for the
     latest years (change the number of years if needed);
   - details such as GSTIN, PAN, TAN, CIN, Udyam number and address, written
     into the email;
   - portal logins (Admin only);
   - bill copies and a statement of bills (billing managers and partners who
     see the Billing List).
3. A **Not found** box lists anything the request wanted that isn't there
   (e.g. "Computation of income: not uploaded for FY 2024-25", "GSTR-1 Aug
   2026: not filed yet"). Send the rest, or add the missing file first.
4. Untick anything not wanted, or click **Show all files of the client** to
   add more. **Pick files myself** starts with nothing ticked.
5. Check the address (any address can be used, up to 5), add a message if
   needed, and click **Send**.

The email lists the files, the filing date and ARN of each return sent, the
details and logins chosen, and the message. Files over 18 MB together go as
download links valid for 7 days. Bills are always attached as PDFs.

Every email is listed under **Recently sent** on the same page (who sent
what, to whom, when), marked **Third party** when it went to an address that
isn't the client's own email or the responsible person's email, and
**Logins** when it carried portal passwords. A return's own history shows
"Sent to client", and a Form 16/16A emailed this way ticks that step on the
compliance sheet as usual.

## Who it comes from

The company's mailbox, under the documents name:

| | Shows as |
|---|---|
| MVC | Document-CA Mukul Verma |
| B Edge | Document-B Edge |

Files of B Edge work go from B Edge's mailbox; everything else from MVC's.
**From** can be changed before sending. Emails count towards Gmail's ~500 a
day, shared with bills and reminders (see docs/BILLING.md).

## Who can do what

| | Admin | Partner | Other staff |
|---|---|---|---|
| Send files and details to any address | ✔ | ✔ | ✔ |
| Send bill copies / statement of bills | ✔ | Billing List partners | |
| Send portal logins (only to the client's own email) | ✔ | | |
| Edit, add or switch off requests | ✔ | | |
| Add documents to a client | ✔ | ✔ | ✔ |
| Remove a client document | ✔ | ✔ | the person who added it |

The checks are made on the server. Requests that include portal logins don't
appear for anyone but Admin.

## The client's Documents tab

Open a client → **Documents**. Choose the document, the financial year for
yearly ones, the file(s), and **Upload**. Files go to the same Cloudflare R2
storage as compliance files (see docs/COMPLIANCE.md); until R2 is set up,
nothing can be uploaded or sent.

- **Registrations** (kept once): PAN card, TAN allotment, GST certificate,
  Udyam, Shop & Establishment, IEC, PF, ESIC, Professional Tax, cancelled
  cheque, other.
- **Company**: incorporation certificate, MOA/AOA, partnership/LLP deed, and
  yearly AOC-4 and MGT-7.
- **Income tax** (yearly): ITR acknowledgement, ITR form, computation,
  26AS, AIS, TIS, tax audit report, advance tax and self-assessment
  challans, 143(1) intimation, refund/order.
- **GST** (yearly): GSTR-9, GSTR-9C, LUT.
- **Financials** (yearly): balance sheet & P&L, audit report, other.

Aadhaar is deliberately not a document type: sharing Aadhaar copies is
restricted, so it is kept off email.

Return files of each period stay on the compliance sheet; Send to Client
picks them from there.

The client form now also has **PAN, TAN, CIN/LLPIN, Udyam number and IEC**
(checked for the right format).

## Portal logins

Logins are the ones under the client's **Credentials** tab. A login is
matched to a portal by its title, so name them clearly: "GST portal",
"Income Tax", "TRACES", "MCA", "EPFO", "ESIC". Admin can tick any login,
matched or not. Passwords go in the email body, only to the client's own
email address; the app refuses to send them anywhere else and asks Admin to
confirm before sending.

## The ready-made requests

| Category | Requests |
|---|---|
| GST | GST registration certificate and details · Filed GST returns for a period · GST returns for a financial year · GSTR-9 / 9C · GST challans · LUT acknowledgement |
| Income tax | Latest ITR · ITRs for the last 3 years · Form 26AS / AIS / TIS · Tax audit report · Advance tax and self-assessment tax challans · Intimation u/s 143(1) and refund |
| TDS | TDS returns filed · TDS challans · Form 16 / 16A |
| Financials & company | Balance sheet and P&L · Audit report · Company documents · ROC filings (AOC-4, MGT-7) |
| Registrations | PAN card · Udyam / MSME certificate · Other registrations |
| Packs | Bank loan pack · Visa / travel pack · Tender pack · Vendor / KYC pack |
| Details | Client profile · Portal logins (Admin) |
| Billing | Statement of bills · Copy of bill |

Bills have no payment record in the app, so the statement lists the bills
issued in the period with their totals; it doesn't show what is outstanding.

### Changing them (Admin)

**Send to Client → Edit requests** (or Clients → `/dashboard/clients/requests`):

- switch a request **On/Off**;
- **Edit** its name, category, default period, number of years, and what it
  picks (compliance works and their files, client document types, details,
  portal logins, bill copies, statement);
- **Reset** a built-in request to how it came;
- **Add request** for your own packs (e.g. "Loan file for HDFC"), and remove
  them later.

Built-in requests can be switched off but not removed. New built-in requests
added in later versions appear on their own.
