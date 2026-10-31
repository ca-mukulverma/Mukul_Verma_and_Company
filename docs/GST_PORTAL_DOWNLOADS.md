# GST portal downloads

Compliance → **GST portal** downloads clients' GST returns from the real GST
portal and saves each file into the client's period, exactly as if a staff
member had uploaded it: standard file name, figures read for the
[GST working](GST_WORKING.md), and a filed return's PDF marks the period
filed.

It doesn't use a GSP or the GST API. A small **helper program** on an office
Windows PC opens the portal in a normal, visible browser and fills in the
saved username and password. **A person always types the captcha and OTP**:
the helper never reads, solves or skips them.

## How one download works

One job = one client = one portal login:

1. Staff queue the client, months, returns and file types in the app.
2. The helper takes the job, opens the portal and fills in the login. The
   PC beeps and the app shows an amber banner: *Go to the helper PC: type the
   captcha and OTP for …*.
3. Someone at the PC types the captcha (and OTP, if asked). The helper does
   the rest:
   - **GSTR-1 JSON first**: it clicks *Generate JSON file to download* for
     each month (an earlier request of the client is reused, never asked for
     twice);
   - while the portal prepares the JSON, it downloads the **PDFs**, the
     **GSTR-2B JSON** and the **GSTR-2B Excel** of every month;
   - then it collects the GSTR-1 JSON;
   - logs out.
4. The job ends as **Done** (months with nothing to download, e.g. a
   quarterly filer's middle month, are listed as *not available* in the
   log), **Partly done** (some files saved, some real errors) or **Failed**.

Files go to the client's GSTR-1 or GSTR-3B period that holds the month
(GSTR-2B goes with GSTR-3B). A file with no matching period is kept with the
client, without figures. They are saved as the staff member who queued the
job, so the normal team permissions apply.

## GSTR-1 JSON timing

The portal takes about **20 minutes** to prepare GSTR-1 JSON. The helper
checks after `JSON_READY_MINUTES` (20), then every
`JSON_CHECK_EVERY_MINUTES` (3), keeping the session alive in between, up to
`JSON_MAX_WAIT_MINUTES` (45). Anything still not ready shows under *GSTR-1
JSON waiting to be collected* and is collected by the client's next download
without asking the portal again. If the portal has dropped an old request,
the helper asks again once.

A large GSTR-1 comes in several parts (*File 1*, *File 2* …). Every part is
saved, but without figures (one part is not the whole return); upload the
GSTR-1 PDF for the figures, or check them in the working.

## One-time setup

1. **Vercel** → the project → Settings → Environment Variables: add
   `GST_HELPER_KEY` (Production), a random value of at least 32 characters,
   e.g. from `openssl rand -hex 32`. Redeploy. Without it the helper routes
   answer 503.
2. **On the office PC** (Windows):
   1. Install **Node.js 22 LTS** from nodejs.org, and Git.
   2. Clone this repository, then in a terminal:

      ```
      cd helper
      npm install
      npx playwright install chromium
      copy .env.example .env
      ```

   3. Edit `helper\.env`: `PORTAL_URL` (the office app's address),
      `GST_HELPER_KEY` (the same value as in Vercel) and `HELPER_NAME` (e.g.
      `OFFICE-PC-1`). The other settings can stay as they are.
   4. Check the portal steps once (see
      [Checking the portal steps](#checking-the-portal-steps)).
3. **Each client's GST login**: Clients → the client → **Credentials**, with
   **GST** in the title (e.g. "GST portal"). Titles that mention e-way bill or
   e-invoice are skipped. Without a saved login the helper still opens the
   portal and staff type the username and password too (the app shows *no GST
   login saved: staff type it*).

## Daily use

1. Compliance → **GST portal**: tick the clients, choose the financial year
   and months (*All months* ticks those that are over), the returns
   (GSTR-1, GSTR-3B, GSTR-2B) and the files (PDF, JSON, Excel for GSTR-2B),
   and **Queue**. Up to 50 clients and 24 months at a time; a client that
   already has a download queued or running can't be queued again.
2. When the amber banner shows, go to the helper PC and type the captcha and
   OTP. Nothing else needs to be clicked.
3. The list shows each job's status, files saved, progress or error, and a
   **Log**. **Cancel** stops a job at its next step; **Run again** queues a
   finished one again.

The bar at the top is green when the helper was seen in the last 30
minutes, amber otherwise. The tab refreshes every 15 seconds only while a
job is queued or running, and only while someone is using the app.

## Running the helper at startup

`npm start` (in `helper`) keeps it running: during `ACTIVE_DAYS` and
`ACTIVE_HOURS` (default Monday–Saturday, 10:00–20:00, the PC's clock) it asks
the app for a job every `POLL_SECONDS` (60) and starts the next job at once
after one finishes; outside those hours it sleeps without calling the app.
**Ctrl+C** finishes the current job first; press it again to stop at once.
`npm run once` runs one job, if any, and stops.

To start it when the PC starts, either:

- **Startup folder**: make `start-gst-helper.cmd` containing

  ```
  cd /d C:\path\to\repo\helper
  npm start
  ```

  and put a shortcut to it in the Startup folder (Win+R → `shell:startup`).
- **Task Scheduler**: Create Task → *At log on* → action *Start a program*:
  `cmd.exe`, arguments `/c npm start`, *Start in* `C:\path\to\repo\helper`.
  Tick *Run only when user is logged on*: the browser window must be visible
  for the captcha.

**Database cost**: each poll is a small query, so while the helper is active
the Neon database stays awake (see [NEON_USAGE.md](NEON_USAGE.md)). Keep
`ACTIVE_HOURS` to office hours; a larger `POLL_SECONDS` (e.g. 300) saves a
little more but jobs then wait longer to start. Nothing runs at night.

## Checking the portal steps

Every portal-specific detail (addresses, field ids, button and link texts,
drop-down options, messages) is in **`helper/src/portal/selectors.ts`**. It
was written from the portal's usual layout and **has not been tested
against a live login**. Check it before first use and whenever the portal
changes:

- `npm run inspect` opens the login page with the Playwright Inspector. Log
  in by hand, go to the Returns Dashboard, and use **Pick locator** on each
  drop-down, button and link named in `selectors.ts`.
- `npm run record` records your clicks as code (Playwright codegen); compare
  it with the recipes in `selectors.ts`.

Prefer the text staff see on screen over CSS ids. Also check against a real
login, and change the settings in `.env` to match:

- how long GSTR-1 JSON really takes to be ready (`JSON_READY_MINUTES`);
- how long its download links stay;
- how soon the portal logs out an idle session (`JSON_CHECK_EVERY_MINUTES`
  must be shorter).

`npm test` (in `helper`) runs a whole job against a mock portal; it checks
the helper's logic, not the real portal.

## Security

- Keep the helper PC locked when unattended, with **BitLocker** on: `.env`
  holds the helper key, and the browser is logged in to clients' GST
  accounts while a job runs.
- `helper/.env` is never committed (it is in `.gitignore`).
- If `GST_HELPER_KEY` leaks, set a new value in Vercel and in `helper\.env`,
  and redeploy. The old key stops working at once.
- The helper key can only claim jobs staff queued and save files to those
  jobs' clients. A client's password is sent to the helper only when its
  job starts.
- Client passwords are still stored **in plain text** in the `Credential`
  table. Encrypting them at rest is recommended as a follow-up.
- Each client gets a fresh browser context, so no cookies or sessions are
  shared between clients.

## Troubleshooting

| What you see | What to do |
|---|---|
| Amber bar: helper not seen | Start the helper on the PC (`npm start`); check it's within `ACTIVE_DAYS` / `ACTIVE_HOURS` and that `PORTAL_URL` is right |
| Helper says *Wrong helper key* (401) | `GST_HELPER_KEY` in `.env` differs from Vercel |
| Helper says *not set up on the server* (503) | `GST_HELPER_KEY` is missing in Vercel or shorter than 32 characters; redeploy after setting it |
| *Nobody completed the login within 10 minutes* | Nobody typed the captcha / OTP; **Run again** when someone is at the PC (or raise `LOGIN_WAIT_MINUTES`) |
| *The helper stopped responding* | The helper was closed or the PC slept during a job; **Run again** |
| *The Returns Dashboard has no … in its list*, *No file came from the portal*, or a timeout on a button | The portal's layout changed: check `selectors.ts` with `npm run inspect` |
| *The GST portal session expired* | The portal logged out (idle, or logged in elsewhere); **Run again** |
| *You are not on the team for this work* | The person who queued the job isn't on the GSTR-1 / GSTR-3B team; someone on the team queues it |
| *This file is for GSTIN …, not this client's* | The client's GSTIN in the app is wrong, or the wrong login is saved under Credentials |
| *Not available: …* in a Done job | Nothing to download for that period (not filed yet, or a quarterly filer's middle month). Not an error |

## For developers

- Tables: `GstPortalJob`, `GstJsonRequest` (migration
  `20261108000000_add_gst_portal_downloads`). Helper last seen:
  `ComplianceSetting` key `gstHelperSeen`, written at most every 5 minutes.
- Staff API: `src/app/api/compliance/gst-portal` (GET, POST) and
  `…/gst-portal/[id]` (PATCH cancel / retry); screen:
  `src/components/compliance/gst-portal.tsx`.
- Helper API: `src/app/api/gst-helper` (`claim`, `jobs/[id]/status`,
  `upload-url`, `document`, `json-requests`, `finish`), shared code in
  `src/lib/gst-helper.ts`. The key is sent in `X-GST-Helper-Key`; SHA-256
  digests are compared with `timingSafeEqual`. A cancelled job answers 409
  `{ cancelled: true }`; every finished job answers 409. A job with no
  heartbeat for 30 minutes is failed at the next claim.
- Files are recorded with `recordComplianceUpload()`
  (`src/lib/compliance-upload.ts`), the same function behind
  `POST /api/compliance/documents`.
- The helper (`helper/`) imports `src/lib/gst-read` directly (relative
  imports only). The app's `tsconfig.json` excludes `helper`.
