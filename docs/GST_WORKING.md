# GST working

Compliance → **GST working**. The firm's sales/ITC working for every GST
client, month by month (or quarter by quarter for QRMP clients), built only
from the return files downloaded from the GST portal. **No figure is typed
in**: to correct one, upload the corrected file.

## Which files, and what is taken from each

| File (portal) | Where to download | Figures taken |
|---|---|---|
| GSTR-1 JSON (`returns_…_R1_…_offline_others_0.zip`) | Returns Dashboard → GSTR-1 → **Download** → Generate JSON | B2B (incl. reverse charge), B2C (B2CL + B2CS), credit notes and debit notes **separately**, tax free (nil, exempt, non-GST), exports (EXPWP/EXPWOP, SEZ, deemed exports), advances, by IGST/CGST/SGST/cess |
| GSTR-1 / IFF PDF | GSTR-1 → **View** → Download PDF | Amendments (the JSON has only the amended values, not the difference), ARN and date; cross-check of the JSON |
| GSTR-1A PDF | GSTR-1A → **View GSTR-1A** → Download PDF (the portal has no 1A JSON) | Every 1A row; credit and debit notes come netted in the PDF, so they show as one net figure in *Credit notes* |
| GSTR-3B PDF | GSTR-3B → **Download** | 3.1(a)–(e), 4A(1)–(5), 4B(1)–(2), 4C, 4D(2), ARN and date |
| GSTR-2B JSON (`returns_R2B_…json`, quarterly `R2BQ`) | GSTR-2B → **Download** → Generate JSON | ITC available other than reverse charge (after supplier credit notes), reverse charge, ITC not available, ITC rejected |

A large 2B comes as a **summary file** (`…_summary.json`, with the number of
parts) and **part files** (`…_1.json`, `…_2.json`). The totals are taken from
the summary; the app checks that every part is uploaded too.

A quarterly (QRMP) client's quarter = IFF month 1 + IFF month 2 + the
quarter's GSTR-1 (each file covers its own month). Missing IFFs are only
noted (no IFF may have been filed); the quarterly 3B and 2B (`R2BQ`) cover the
whole quarter.

If only the PDF of a GSTR-1/IFF is uploaded, its figures are used, with credit
and debit notes netted. If only the JSON is uploaded and it has amendments,
the working asks for the PDF.

## Uploading

- **All clients at once**: GST working → *Upload returns for all clients*.
  Choose files, ZIPs or **RARs**, choose a folder, or drop a whole folder
  (e.g. `GST RETURNS/<client>/<month>/…`). Each file goes to the client with
  its **GSTIN** (or TAN) and to the **period in the file itself**.
- **One client**: Compliance → Clients → the client → *Upload returns* (same
  table), or the period's own window (Files).

Before anything is uploaded, the table shows for every file what was read
(e.g. *Net ₹1,91,04,221.42 · tax ₹34,38,761.66*) and leaves unticked:

- a file of another GSTIN, or of a GSTIN no client has;
- a file in a folder named after another month (`Apr 26` holding an April
  2025 return);
- the same file twice (by its content, whatever its name).

Files are uploaded oldest first. A filed return's PDF **marks its period
filed** with the ARN and date printed on it (completed by and checked by the
person uploading; Admin can change it in the period), unless something locks
it (earlier period not filed, RCM line pending…). After a batch, periods that
were waiting for an earlier one are filed in order. A GSTR-1A PDF marks the
GSTR-1A filed.

Files uploaded before this feature: open the client's working and click
**Read their figures**; the app reads them in the browser and files their
periods the same way.

## The working (firm's format)

Rows: GSTR 1 (B2B, B2C, amendments, credit notes, debit notes, tax free,
exports, net sales), GSTR 1A (same), total net after GSTR 1A, GSTR 3B sales
(3.1(a) + (b) + (c) + (e)) and the difference; RCM output (3.1(d)) and input
(4A(2) + 4A(3)) and the difference; input other than RCM (4A(1) + 4A(4) +
4A(5)), reversal (4B), net ITC, allowable ITC as per 2B and the difference;
ineligible ITC (4D(2) against 2B *ITC not available*) and ITC rejected in 2B.
Columns: taxable value, IGST, CGST, SGST, cess (only when there is any), total
tax and total value, for the year's **Total** and every month or quarter.

On screen one column is shown at a time (*Show*); **Excel** and **PDF** have
them all. *Email the working* sends both to the client from the firm's Gmail.

## Checks

Shown under each period, in the Excel's *Checks* sheet and on the last PDF
page:

- **Difference**: GSTR-1 (+1A) vs 3B sales, RCM output vs input, ITC claimed
  vs 2B (more or less), ineligible ITC vs 2B, head by head.
- **Missing**: a file not uploaded for a period that is over.
- **Check**: GSTR-1 JSON and PDF that don't agree, a PDF that doesn't add up
  to its own total, 3B tables that couldn't be read, 2B part files missing,
  late filing (filing date against the due date; IFF due on the 13th), and
  **swings**: sales, ITC or credit notes more than 50% away from the average
  of the last 3 periods (Admins and Partners can change the 50%).

**Needs attention this month** lists every client's period ending in the month
with anything above, differences first, largest first. **Files uploaded**
shows, for the year so far, which files each client still lacks.

## Sign-off

A reviewer (GST team, Admins, Partners) ticks **Mark checked** on each period.
A period with a difference needs a remark saying why it is fine. The figures
at the time are kept: if a later upload changes them, the period shows
*Checked before the figures changed: check again*.

## Reconciliation tab and periods

The figures of each GSTR-1 and GSTR-3B period (used by Compliance →
Reconciliation and Ask Claude) are now filled from the uploaded files and
can't be typed in the period's window.

## Storage and cost

Only totals are kept in the database (a few hundred bytes a file; a few MB a
year for the firm). The files themselves are in Cloudflare R2 as before (JSON
compressed about 4×). Reading happens in the browser; nothing is paid for.

## For developers

- Reading files (pure, used in the browser and tests): `src/lib/gst-read/`
  (`sales.ts` GSTR-1/IFF/1A JSON and PDF, `gstr3b.ts`, `gstr2b.ts`,
  `pdf-lines.ts` turns pdf.js text into lines and leaves out the rotated
  FILED/FINAL watermark); the working and checks: `src/lib/gst-read/working.ts`.
- Browser: `src/components/compliance/gst-file.ts` (pdf.js, ZIP),
  `return-detect.ts` (ZIP/RAR, folders), `return-upload.tsx`, `gst-working.tsx`.
- Server: `src/lib/gst-working.ts` (periods, exceptions, files, item figures,
  filing from uploads), `src/lib/gst-working-export.ts` (Excel, PDF), API
  `src/app/api/compliance/gst-working/*`, `clients/lookup`, and the `gst`
  field on `documents` uploads (checked against the client's GSTIN and the
  period's work and months).
- Tables: `ComplianceDocument.gst` / `gstMonth`, `GstWorkingCheck`,
  `ComplianceSetting`; doc kind `GSTR2B_JSON`. Migration
  `20261101000000_add_gst_working`.
