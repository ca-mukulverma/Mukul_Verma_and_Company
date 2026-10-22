# Bill format assets

Images and fonts printed on the PDF bills (see `src/lib/bill-formats.ts`).
They are packed into `src/lib/bill-format-assets.ts` so they ship with the
server code; after changing a file here, run:

```bash
node scripts/build-bill-assets.mjs
```

| File | What it is |
|---|---|
| `ca-logo.png` | CA India logo (MVC & Company, CA Mukul Verma, CA Harsh Verma bills) |
| `advocate-logo.png` | Advocate logo (Verma Law Associates bills) |
| `bedge-logo.png` | B-Edge Business Consultants logo |
| `qr-<type>.png` | UPI "Scan & Pay" QR code of each bill type's account, regenerated black-on-white from the bank's QR |
| `BillSans-*.ttf` | Carlito (metric-compatible with Calibri, the font of the firm's formats), cut down to Latin characters and renamed as the SIL Open Font License requires; see `OFL.txt` |

The UPI IDs in the QR codes:

| Bill type | UPI ID |
|---|---|
| GST (MVC & Company) | 44402937256@sbi |
| NON_GST (CA Mukul Verma) | 9165544594@hdfc |
| NON_GST_HV (CA Harsh Verma) | 7000774130@ybl |
| NON_GST_VLA (Verma Law Associates) | 8962197740@sbi |
| BEDGE (B-Edge Business Consultants LLP) | 43471559687@sbi |
