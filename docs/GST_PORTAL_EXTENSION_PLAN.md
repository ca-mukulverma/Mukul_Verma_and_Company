# GST portal downloads with a browser extension: plan

Status: **stages 1–3 built, 4 and 5 in part** (Nov 2026; see
[Progress](#progress)), the rest planned. This document is the brief for the sessions that build it. It replaces the helper-PC design that
was built and then removed (see [Background](#1-background)).

## Contents

1. [Background](#1-background)
2. [Goals and non-goals](#2-goals-and-non-goals)
3. [Decisions already taken](#3-decisions-already-taken)
4. [How it works for staff](#4-how-it-works-for-staff)
5. [Architecture](#5-architecture)
6. [Making it fast](#6-making-it-fast)
7. [Portal settings: steps kept as data](#7-portal-settings-steps-kept-as-data)
8. [Teach the portal (one-time setup)](#8-teach-the-portal-one-time-setup)
9. [The fast route](#9-the-fast-route)
10. [Change detection and update suggestions](#10-change-detection-and-update-suggestions)
11. [Safety rules](#11-safety-rules)
12. [Database cost](#12-database-cost)
13. [Data the app keeps](#13-data-the-app-keeps)
14. [Installing and updating the extension](#14-installing-and-updating-the-extension)
15. [What to reuse](#15-what-to-reuse)
16. [Discovery on the real portal (before coding the portal steps)](#16-discovery-on-the-real-portal-before-coding-the-portal-steps)
17. [Build stages](#17-build-stages)
18. [Testing](#18-testing)
19. [Risks and open questions](#19-risks-and-open-questions)
20. [Starting the build session](#20-starting-the-build-session)

---

## 1. Background

- **What we want:** download clients' GST returns from the GST portal
  (GSTR-1, GSTR-3B, GSTR-2B: PDF, JSON, Excel) and save each file into the
  client's compliance period exactly as if a staff member had uploaded it.
  No GSP / GST API. A person always types the captcha and OTP; nothing reads,
  solves or skips them.
- **First design (removed):** a helper program on one office PC (Node +
  Playwright) took queued jobs from the app. It worked against a mock portal,
  but it had to ask the app "is there a job?" every 60 seconds all day, which
  kept the Neon database awake about 10 hours a day (Neon bills awake time and
  only sleeps after 5 minutes without a query; see
  [NEON_USAGE.md](NEON_USAGE.md)). It also needed staff to walk to that PC for
  every captcha, and each client sat ~20 minutes waiting for GSTR-1 JSON.
  It was removed in Nov 2026 (migration
  `20261109000000_remove_gst_portal_downloads`). Its full code is kept on the
  branch **`feature/gst-portal-downloads`** (and the client-page version on
  `ccr-33f44405-lls1zy`) for reference.
- **Database use in Oct 2026** (production, before the GST feature was ever
  run): 258 awake hours, 237 CU-hours ≈ $25 at the Launch rate of $0.106 per
  CU-hour; storage ~37 MB. From 28 Oct the compute is capped at 0.25–1 CU, so
  about $5–8 a month is expected. The new design must add **almost nothing**
  to this.

## 2. Goals and non-goals

**Goals**

- Any staff PC with Chrome or Edge can download a client's returns with one
  click in the app. No dedicated PC, no queue, nothing running in the
  background.
- The person who clicks types the captcha and OTP in their own browser.
- Fast: only missing files are fetched; no 20-minute waits at the screen.
- Files are saved through the **existing upload path**, so naming, periods,
  GST working figures, "filed" marking, duplicates and permissions behave
  exactly as for a manual upload.
- Portal changes are fixed without reinstalling the extension, and are
  detected and proposed automatically for the admin to approve.
- Zero extra database cost when nobody is downloading.

**Non-goals**

- Solving, reading or bypassing the captcha or OTP, ever.
- Automatic exploring/crawling of the portal; clicking anything a person has
  not shown to be safe.
- Filing, submitting, resetting or editing anything on the portal.
- GSP / GST API integration (may be revisited only if volume grows a lot).

## 3. Decisions already taken

| Topic | Decision |
|---|---|
| Where it runs | A browser extension (Chrome + Edge, Manifest V3) on staff PCs |
| Who drives | **The app page is the brain; the extension is the hands** (see §5) |
| Trigger | Staff click Download on the client's page; it starts at once. No queue |
| Captcha / OTP | Always typed by the person who clicked |
| Saving files | The app's existing browser upload (`uploadComplianceFile` → `/api/compliance/documents/upload-url` → R2 → `/api/compliance/documents` → `recordComplianceUpload`) |
| What to fetch | Only files missing from the app, pre-ticked by default |
| GSTR-1 JSON | Two short visits: ask on the first, collect on a later one. Optional "wait in background" for whoever stays |
| Portal steps | Kept as **portal settings** (data) served by the app, versioned, approved by Admin |
| Setup | "Teach the portal": the admin downloads each file once by hand while the extension records |
| Speed | Fast route (the portal's own background requests, learned by teaching) with automatic fallback to the click route |
| Portal changes | Detected during normal runs, turned into tested **update suggestions**; Admin approves / rejects / rolls back |
| Install | Private or unlisted Chrome Web Store + Edge Add-ons listing (auto-updates); developer-mode loading only for the pilot |

## 4. How it works for staff

### One client

1. Compliance → Clients → the client → **GST portal** box (below the GST
   working). It lists, per month, which GST files are saved and which are
   missing; the missing ones are ticked.
2. Click **Download from GST portal**.
3. A new tab opens on the GST portal login with the username and password
   filled in (from the client's Credential whose title contains "GST" but not
   e-way bill / e-invoice; if none, staff type them). The cursor is in the
   captcha box.
4. Staff type the **captcha and OTP**.
5. The extension fetches each ticked file; the app saves each one as it
   arrives. The box shows ✓ saved, "not available" (e.g. a quarterly filer's
   middle month, a return not filed yet) or a clear error with a screenshot.
6. GSTR-1 JSON: on this visit the extension clicks *Generate JSON* and moves
   on. The box then shows "GSTR-1 JSON Oct 2026: asked on 5 Nov 11:02, ready
   in about 20 min". The next Download for this client collects it (a short
   visit), or, if the person chose **Wait for it**, the portal tab stays open
   in the background, is kept alive, and the JSON is collected when ready.
7. The extension logs out and closes the portal tab.

Expected time with only missing files: about 1–3 minutes per client, of
which ~1 minute is the person typing the captcha and OTP.

### Many clients (monthly round)

1. A **Download round** screen lists clients with missing GST files for a
   month (filters: my clients, GSTR-1 / 3B / 2B, quarterly). Tick clients,
   **Start**.
2. The extension does them one after another: opens the next login with the
   fields filled, plays a sound / desktop notification, the person types the
   captcha and OTP, files download, logout, next.
3. **Collect GSTR-1 JSON** does the same for clients whose JSON was asked for
   earlier (≈30 seconds each).
4. Several staff can run rounds on their own PCs at the same time (the
   portal allows one login per browser, so one client at a time per PC).

Rough time for 20 clients: 40–60 minutes for the round + ~15 minutes for
the JSON round (helper design: most of a day).

## 5. Architecture

```
 App tab (Next.js page, staff session)            Extension (MV3)                 GST portal tab
 ─────────────────────────────────────            ───────────────                 ──────────────
 decides what to fetch (missing files)  ──msg──►  bridge (content script on app)
 loads portal settings (versioned)                background service worker  ──► opens tab, fills login
 orchestrates steps, keeps progress               portal content script      ◄─► clicks / fetches in page
 receives file bytes, reads figures     ◄──msg──  returns {name, bytes, meta}
 uploads with existing upload code
 shows progress, errors, screenshots
```

- **App tab = brain.** All decisions and logic that may change live in the
  app (deploys update every PC at once): what is missing, which steps to run
  (from portal settings), order, retries, fallback, checking files, saving,
  progress, change detection.
- **Extension = hands.** Small and stable: open/close the portal tab, fill
  the login fields, run one step it is told (click a target, wait for a
  page, fetch an address in the page's own context), return file bytes,
  record what the portal did (teach / change detection), take a screenshot
  on error. No business logic, no stored passwords.
- **Messaging**, modelled on `public/whatsapp-extension` (bridge content
  script on the app origin + `window.postMessage` with a `source` tag +
  `chrome.runtime` messaging). Only the app's own origin may talk to the
  extension; check `event.origin` and the sender in the background worker.
- **Getting file bytes:** prefer fetching the file's address inside the
  portal page (same session) so the bytes come back directly. For files the
  portal builds on the fly, capture the response or the blob the page
  creates. A plain browser download is the last resort (an extension can't
  read a saved file's contents back easily). Discovery (§16) decides per
  file type.
- **MV3 service workers sleep** after ~30 s idle: keep long waits (JSON
  background wait, keep-alive) driven by `chrome.alarms` and by the app tab,
  not by timers in the worker.
- **No database writes during a run** except saving files (and one summary
  at the end, §13). Progress lives in the app tab and `chrome.storage.session`.

## 6. Making it fast

Biggest wins first:

1. **Only missing files.** The app knows each period's documents; send the
   extension only what's missing. Most runs fetch 2–4 files, not 12+.
2. **GSTR-1 JSON in two short visits** instead of waiting 20 minutes per
   client (§4). The browser is free for the next client at once.
3. **Wait for the page, not the clock.** Move on when the target is ready;
   keep only a short natural pause (≈0.5–1.5 s) instead of the helper's fixed
   2–5 s.
4. **Fastest page per file.** E.g. a year-wide *View Filed Returns* page may
   give all PDFs without choosing year/quarter/month each time (verify in
   discovery).
5. **Download and save in parallel.** While the extension fetches the next
   file, the app uploads the previous one; reading PDF figures runs in a
   worker (pdf.js already uses one) so the page never freezes.
6. **More PCs in parallel** for rounds (one client per browser).
7. **Fast route** (§9): fetch learned addresses directly instead of clicking
   through menus, with automatic fallback.

## 7. Portal settings: steps kept as data

All portal-specific knowledge is a **versioned settings document** served by
the app, never hard-coded in the extension:

- Addresses: login page, logged-in pattern, Returns Dashboard, logout,
  keep-alive page.
- Login field targets (username, password, captcha).
- Per file type (GSTR-1 PDF, GSTR-3B PDF, GSTR-2B PDF / JSON / Excel,
  GSTR-1 JSON generate / collect):
  - **click route:** ordered steps with targets matched by visible text
    (case-insensitive, preferred) or CSS as a fallback;
  - **fast route** (optional): request pattern with placeholders
    (`{gstin}`, `{period_mmyyyy}`, `{fy}`…), method, which parts vary, and
    the expected answer (content type, "recognised as GSTR-3B", etc.);
  - flags: `safe` (read/download) or `action` (changes portal state, e.g.
    Generate JSON; must be Admin-approved).
- Texts that mean *not available*, *session expired*, *JSON pending*.
- Pacing limits (max requests per minute).

Versioning: every version is kept (who created it, from what, when
approved). One version is **active**. Admin can roll back to any version.
The app sends the active version to the extension with each run, so a fix
reaches every PC on the next click without reinstalling anything.

Lessons from the helper build (keep them in mind):

- Match a return's box by the text element that holds its name, not the
  whole block's text: Playwright/DOM text of a block runs into its buttons
  ("GSTR1VIEW"), which breaks patterns like `GSTR-?1\b`.
- "Not available" texts can already be on the page (e.g. "Not Filed" labels
  on other returns); only count such a message if it **appears after** the
  click.
- Month lists often load a moment after the quarter is chosen: wait for the
  option to appear.

## 8. Teach the portal (one-time setup)

Giving only an ID and password and letting the app discover everything is
**not** possible or safe: the captcha/OTP needs a person, and an automatic
explorer could press *Submit*, *File*, *Reset* or *Prepare online*. Instead
the admin shows each download once and the app works out the rest.

**Admin steps (≈20–30 minutes, once):**

1. Setup → GST portal → **Teach**. Pick a test client with a saved GST login
   and **two months** (e.g. Apr and May 2025).
2. The extension opens the portal with the login filled; the admin types the
   captcha and OTP. Recording starts.
3. The app shows a checklist beside the portal tab (GSTR-1 PDF, GSTR-3B PDF,
   GSTR-2B PDF / JSON / Excel, GSTR-1 *Generate JSON*, GSTR-1 JSON collect,
   for each of the two months). The admin does each by hand, in any order.
4. Each item ticks itself when its file arrives.

**What the app works out:**

1. **Which file is which, by reading it.** The app already recognises GST
   returns (`src/lib/gst-read`: form, GSTIN, month). "This is GSTR-3B, Apr
   2025, GSTIN 23ABC… ✓". No manual labelling; a wrong month is flagged.
2. **The click route:** the recorded clicks (page, target text) for each
   file.
3. **The fast route:** the portal's background requests seen just before
   each file arrived (recorded in the page by wrapping `fetch` /
   `XMLHttpRequest`, or with `chrome.debugger` in teach mode only). Comparing
   the two months shows which parts vary: `042025` vs `052025` → month
   placeholder; same for GSTIN and financial year.
4. **Safe vs action:** downloads/reads are `safe`; anything that changes
   portal state (Generate JSON) is `action` and needs Admin approval.
   Requests the admin didn't make are never used.
5. **Privacy:** cookies, tokens, auth headers, the real GSTIN and file
   contents are stripped. Only patterns and a short "what a correct answer
   looks like" are saved.
6. **Self-test:** fetch a **third** month using only what was learned
   (safe steps only), check each file is recognised correctly, and show a
   summary, e.g. "6 of 6 files can be fetched directly; GSTR-1 JSON needs
   Generate (action, approve?)".
7. Admin clicks **Publish** → portal settings version 1.

**Bonus:** if teaching sees a safe request that lists the year's filed
returns (status, date), and the admin approves it, the app can show "filed
on the portal but no file saved here" per client and pre-tick exactly those.

## 9. The fast route

For each file in a run:

1. If the active settings have a fast route for it, fetch the learned
   address with the placeholders filled, inside the portal tab (same
   session), within the pacing limit.
2. **Check the answer:** expected content type; the app recognises it as the
   expected return; right GSTIN and month (or, for files without figures
   such as Excel, the expected type and a sensible size/name).
3. Pass → save. Fail → **fall back to the click route** for that file;
   staff still get it. Keep the recording of what the portal did (feeds §10).
4. A per-setting switch can turn the fast route off for everyone instantly.

## 10. Change detection and update suggestions

**Fast route fails, click route works** (usually an address or parameter
changed):

1. Compare what was expected with what the portal did on the click route.
2. Build a **proposed update** (e.g. "GSTR-3B PDF: address A → address B,
   month now in `rtn_prd`") and test it at once with the same checks.
3. Admin gets a card in Setup → GST portal:

   > **The portal has changed: GSTR-3B PDF**
   > Seen on 5 Nov during a download by Ramesh (CITY MOTORS, Oct 2026).
   > Old: address A · New: address B. Tested ✓ (recognised as GSTR-3B Oct 2026).
   > [Approve] [Reject] [Show details]

4. Approve → new settings version, used by every PC from the next click.
   Reject → keep the old one; the click route continues. Roll back any time.

**Click route fails too** (a button/page changed): the run shows a clear
error with a screenshot of the portal tab; the admin gets a card *"GSTR-2B
Excel: button 'Generate Excel file' not found"* with **Teach this step
again** (record just that download, ~1 minute) → proposed version → test →
approve.

**Health:** per step, count fast-route and click-route successes and
failures (saved with the run summary). Warn the admin when a step starts
failing, before staff notice. No scheduled checks.

Suggestions are never applied without Admin approval, except falling back to
the already-approved click route.

## 11. Safety rules

1. Login is always typed by a person. Captcha/OTP pages are never automated
   or recorded.
2. Only requests seen during the admin's teaching are repeated.
3. `action` steps only after Admin approval; never anything that files,
   submits, resets or edits.
4. No suggested change goes live without Admin approval.
5. No cookies, tokens, passwords or file contents in portal settings or logs.
6. The password goes to the extension only when the person clicks, is used to
   fill the field, and is never stored by the extension.
7. The extension's permissions are limited to the GST portal hosts and the
   app's origin; only the app's origin may message it.
8. Pacing limits on both routes; human login per client.
9. The GST portal discourages automated access. The click route is the safe
   default; the fast route can be switched off with one setting.
10. Files are saved as the person who clicked, with their permissions
    (normal upload rules: team checks, GSTIN must match the client, etc.).
11. Follow-up (separate task): encrypt `Credential.password` at rest.

## 12. Database cost

- Nothing runs on a schedule; nothing polls; no heartbeats.
- During a run the only database use is saving files (as a manual upload
  does) plus one small run summary at the end; staff are using the app then,
  so the database is awake anyway.
- Portal settings and suggestions are tiny and change rarely.
- **Do not** add timers or background refreshes to the GST portal box; use
  `useActivePolling` only if something genuinely needs refreshing while a
  person watches.

## 13. Data the app keeps

Keep it minimal (decide exact shape in the build session):

- **Portal settings versions** (JSON document + version number + status
  draft/active/retired + created by / approved by / dates). Could start in
  `ComplianceSetting` (key/value JSON) and move to a table if history grows.
- **Update suggestions** (file type, old vs new, test result, seen by, date,
  status pending/approved/rejected).
- **GSTR-1 JSON requests** per client and month (asked at, collected at,
  parts), so the app can say "ready to collect" and never ask twice. The
  portal itself also shows pending/ready, so this may live with the run
  summary instead of its own table; verify in discovery.
- **Run summary** per run (client, who, when, files saved, not available,
  errors, fast/click counts) — one write at the end. Useful for health
  counts and for the client's history.

No job queue, no heartbeat, no "helper last seen".

## 14. Installing and updating the extension

- Pilot: load unpacked from a zip the app serves (as the WhatsApp extension
  does: `public/whatsapp-extension`, `__APP_ORIGIN__` filled in on download).
- Production: private or unlisted listing on the **Chrome Web Store** and
  **Edge Add-ons** so it installs in one click and updates automatically;
  or force-install by browser policy on managed PCs.
- The app detects the extension (attribute set by the bridge, as WhatsApp
  does) and shows "Install the GST extension" with steps if missing.
- Store policies forbid remote **code**; portal settings are **data**, which
  is allowed. Keep all executable logic inside the extension package and the
  app.

## 15. What to reuse

From `master`:

- `src/lib/gst-read/*`: recognise returns and read figures (form, GSTIN,
  month, parts of 2B / GSTR-1 JSON).
- `src/components/compliance/upload.ts` and `gst-file.ts`: hashing, gzip,
  reading figures in the browser, upload-url → R2 → record.
- `src/lib/compliance-upload.ts` (`recordComplianceUpload`) behind
  `POST /api/compliance/documents`.
- `src/lib/gst-working.ts` `placementOf()` (GSTR-2B goes with GSTR-3B).
- Client pages: `src/components/compliance/clients-panel.tsx` (the GST
  working box; the new GST portal box sits below it).
- `public/whatsapp-extension` and `src/components/compliance/whatsapp-send.ts`:
  extension packaging, app↔extension messaging, install instructions.
- `src/hooks/use-active-polling.tsx` if any refresh is ever needed.

From branch `feature/gst-portal-downloads` (removed code, for reference):

- `helper/src/portal/selectors.ts`: first guesses at portal addresses,
  login fields, dashboard drop-downs, button texts and messages.
- `helper/src/portal/gst-portal.ts`: matching boxes by name, catching files
  (download / inline / new tab), "not available" vs real errors, session
  expiry detection.
- `helper/test/mock-server.ts`: a mock GST portal (login + OTP, Returns
  Dashboard with year/quarter/month, GSTR-1 JSON generate/pending/parts,
  3B/2B files) — reuse for extension tests.
- `helper/src/run-job.ts`: GSTR-1 JSON handling (reuse earlier request,
  parts without figures, expired → ask again once).
- The client-page version of the UI on branch `ccr-33f44405-lls1zy`.
- Credential choice rule: first Credential whose title contains "GST" but
  not e-way bill / e-invoice.

## 16. Discovery on the real portal (before coding the portal steps)

One session (~1 hour) with one real client, developer tools open (Network
tab), writing down:

1. Exact steps/pages for each file: GSTR-1 PDF, GSTR-3B PDF, GSTR-2B PDF /
   JSON / Excel, GSTR-1 JSON generate and collect.
2. How each file arrives: normal download, new tab, inline, or built on the
   fly (blob). Decides how the extension gets bytes (§5).
3. The background requests behind each (address, method, parameters,
   response type) — candidates for the fast route.
4. How long GSTR-1 JSON takes, how long its links stay, how many parts for a
   large return.
5. When the portal logs out an idle session; whether a second tab in the
   same login works.
6. Whether a year-wide page (e.g. *View Filed Returns*) gives PDFs faster.
7. Exact texts for not filed / not applicable / session expired / JSON
   pending.
8. Quarterly (QRMP) client: IFF months, quarterly 3B and 2B (`R2BQ`).

Teach mode (§8) later automates most of this recording; discovery is needed
first to design the extension's capture methods.

## 17. Build stages

Each stage is usable on its own; if one file type proves hard, staff keep
uploading that one by hand.

| Stage | What | Done when |
|---|---|---|
| 0 | Discovery (§16) | Notes for every file type, capture method chosen |
| 1 | **Missing-files view** on the client page (per month: saved / missing GST files) and in a round list | Staff can see what's missing without the extension |
| 2 | Extension skeleton: packaging, bridge, detection, install steps, open portal tab with login filled, logout | Login works on the real portal with captcha typed by staff |
| 3 | Click route for **GSTR-3B PDF and GSTR-1 PDF**, saved via existing upload | Files saved, periods marked filed, "not available" handled |
| 4 | GSTR-2B PDF / JSON / Excel | Saved, 2B figures in the GST working |
| 5 | GSTR-1 JSON: generate on first visit, collect on later visit; optional background wait with keep-alive | Parts > 1 saved without figures; never asks twice |
| 6 | Portal settings as versioned data from the app; Admin view of versions | A setting change reaches all PCs without reinstall |
| 7 | **Teach mode** (recording, file recognition, click route from recording, self-test, publish) | A fresh setup can be taught in ~30 min |
| 8 | **Fast route** with checks and automatic fallback; on/off switch | Same files, much faster; failures fall back silently |
| 9 | **Change detection + suggestions** (approve / reject / roll back), "teach this step again", health counts | A simulated portal change produces a tested suggestion |
| 10 | Download round (many clients), notifications, error screenshots | 20 clients in about an hour |
| 11 | Store listings (Chrome, Edge) with auto-update; docs for staff and admin | Installed from the store on all PCs |
| — | Separately: encrypt `Credential.password` at rest | |

### Progress

**Stage 1 (built).** Each file the GST working checks carries its kind
(`GSTR1_JSON`, `GSTR1_PDF`, `GSTR1A_PDF`, `GSTR3B_PDF`, `GSTR2B_JSON`) and
portal month (`FileCheck` in `src/lib/gst-read/working.ts`), so "missing" is
the working's own list, not a second copy of the rules. `src/lib/gst-portal.ts`
adds the state: *saved*, *missing* (ticked by default), *not due yet* (return
not filed and its due date not passed; GSTR-2B before the 14th) or *only if
filed* (IFF months, GSTR-1A). Shown in the client's **GST portal** box and in
**Compliance → GST downloads** (the round list; starting a round is stage 10).
Read-only, no new tables, no polling.

**Stage 2 (built, tested against the mock portal only).** `public/gst-extension`
(MV3): the bridge on the app's pages, the background worker opening the portal
tab, filling the login (`chrome.scripting`, fields from the portal settings),
reporting *logged in* from the address, logging out and closing the tab, and
closing it after `loginWaitMinutes` if nobody logs in. The app asks
`POST /api/compliance/gst-portal/login` only when staff click. Portal
settings are one built-in version for now (`src/lib/gst-portal-settings.ts`,
from the helper's selectors); stage 6 moves them to the database. Test:
`node --test tests/gst-extension/e2e.test.mjs` (Playwright loads the unpacked
extension against a mock portal and a stand-in app page).

**Stage 0 (discovery, Nov 2026).** The admin recorded each download on the
real portal with Chrome's Recorder plus the network log (HAR): GSTR-1 PDF,
GSTR-1 JSON generate and download, GSTR-2B JSON and GSTR-3B PDF for Sep 2026,
and GSTR-3B of Oct 2026 (not filed). Findings, from the recordings and the
portal's own page templates and scripts in the HAR:

- Returns Dashboard (`return.gst.gov.in/returns/auth/dashboard`, reachable
  directly): Financial Year, Quarter (some taxpayers/years) and Period
  drop-downs (`select[name=fin|quarter|mon]`, Angular, option values like
  `object:208` change every load, so options are picked by their text),
  then Search.
- Each return's box: the name ("GSTR-1", "GSTR-3B", "GSTR-2B") over a
  status line and buttons. **Filed** (`FIL`): "Status- Filed", VIEW /
  Download. **Not filed** (`NF`): "Due Date - …", **Prepare Online /
  Prepare Offline**. **Submitted** (`FRZ`): **FILE GSTR1 / FILE GSTR3B**
  where VIEW was. The recorder saved clicks by position ("second button of
  the box"), which on an unfiled month presses Prepare Offline (or FILE),
  with no error shown. So steps find buttons by text inside the right box,
  the box must show "Status- Filed" (GSTR-1, GSTR-3B), and a fixed list of
  buttons (file, submit, prepare, reset, proceed, sign, EVC, DSC, payment…)
  is never clicked.
- GSTR-3B PDF: box → Download; built in the page (pdfMake → blob → FileSaver).
- GSTR-1 PDF: box → VIEW (new page `/returns/auth/gstr1`) → VIEW SUMMARY →
  DOWNLOAD (PDF), also pdfMake. Unfiled shows "DOWNLOAD SUMMARY (PDF)". A
  **NIL** return's page (`isnil == 'Y'`, `summaryv3.html`) has no VIEW
  SUMMARY but **DOWNLOAD FILED (PDF)** (`generateNILGstr1Pdf`); the recipe's
  click step takes it as the file's button (`orFile`; extension 0.3.4, which
  also waits up to 60 s on both pages: DOWNLOAD (PDF) appears only once the
  summary figures have loaded).
- GSTR-1 JSON: box → Download → GENERATE JSON FILE TO DOWNLOAD. The links
  "Click here to download - File N" (to
  `/returns/auth/api/offline/download/url?rtn_prd=…&rtn_typ=GSTR1&file_num=N`)
  appear **only as the answer of a Generate click** (`main.js` calls
  `offline/download/generate`; `rc` = number of parts): the first click starts
  preparing the file, a click once it is ready answers with the links. A
  second click in the same visit sends `flag=1`, which makes a new file, so
  it is clicked once per visit. (Extension 0.3.0 looked for the links before
  clicking and never collected the JSON; fixed in 0.3.1.)
- GSTR-2B JSON: box → Download (form POST to
  `gstr2b.gst.gov.in/gstr2b/auth/gstr2bdwld`, fields `finyr`, `rtnprd`,
  `form=GSTR2B`) → GENERATE JSON FILE TO DOWNLOAD. The 2B page is its own
  Angular app (`static.gst.gov.in/uiassets/js/static/gstr2b/main-es2015.js`);
  the HAR ends a second before the Generate click, so how it hands over the
  file wasn't seen. Extension 0.3.1 only caught files made in the page and
  failed when the page gave the file to Chrome as a normal download; 0.3.2
  also catches any download the portal tab starts during a file step (reads
  its bytes, from the page for a blob address or with the portal login for a
  server one, then removes it from Downloads), waits for a disabled button
  to be enabled, closes tabs the portal opens, and if no file comes says what
  the page showed and which requests it made.
- The Aadhaar pop-up's REMIND ME LATER comes once a session: closed
  whenever it shows, never a step.
- The HAR did not include the answers of the background requests, so the
  fast route (stage 8) still needs them; the GSTR-1 JSON link's answer (file,
  redirect or JSON with an address) is handled all three ways but is to be
  confirmed on the first real run.

**Stage 3 (built; GSTR-2B JSON and GSTR-1 JSON from stages 4–5 too).**
Portal settings version 1 (`src/lib/gst-portal-settings.ts`) holds the
dashboard drop-downs, the box names, the filed status, a recipe per file
(`click` / `file` / `links` / `generate` steps, matched by text in the box or
page) and the texts (pop-ups to close, never-click, not available, session
expired, JSON pending). `public/gst-extension/portal.js` runs one step at a
time in the portal page (page world, so it catches the blob the page makes
for a pdfMake / FileSaver download, cancelling the browser download);
`background.js` (`gst-fetch`) opens the dashboard, chooses the period,
checks the box, runs the steps across page loads and returns the bytes. The
app (`gst-portal.tsx`) starts once the login is done, fetches the ticked
files one by one, hands each to Upload documents (`portal-files.ts`) and logs
out when done; the extension logs out by itself after `idleLogoutMinutes` if
a download run goes quiet. GSTR-1 JSON: Generate is clicked once per
visit; the portal answers with the links (every part fetched in the page; if
the page may not read an answer, the worker fetches it; failing that, Chrome
saves it to Downloads and staff are told) or starts preparing it. When it was
first asked for is remembered in the browser for 3 hours, to tell staff. Not yet: GSTR-1A, GSTR-2B PDF / Excel, the
background wait for GSTR-1 JSON, the round (stage 10). Test:
`node --test tests/gst-extension/e2e.test.mjs` (mock portal built like the
real one: a filed and an unfiled month; checks that no Prepare / File button
is ever pressed).

**Robustness (extension 0.3.3).** Each file opens the dashboard and waits
for that load to start and finish (before, a step could run on the page
that was about to be replaced); the worker is kept awake during slow portal
answers (Chrome stops an idle extension worker after about 30 seconds); a
file that fails on a page that changed or loaded badly is tried once more
from the dashboard (never GSTR-1 JSON once Generate was reached); the
portal's own error page (`/services/error/…`) and its login page are named
as such; a fetch left half-done by a worker restart no longer blocks the
next one. In the app, the box now shows what Upload documents did with each
file: **Saved**, or **Got it; needs a look** with the reason (period locked,
GSTIN differs, same file twice…) instead of a plain Saved.

**Access denied (extension 0.3.5).** The first real runs ended within
seconds: Chrome's net-export log (Nov 2026) showed every
`return.gst.gov.in/returns/auth/dashboard` answered **302 →
`services.gst.gov.in/services/error/accessdenied`**, though the login
cookies were sent. The extension opened the dashboard itself
(`chrome.tabs.update`: `Sec-Fetch-Site: cross-site`, no `Referer`); in the
training HAR the same request came from the welcome page's RETURN DASHBOARD
button (`Referer: https://services.gst.gov.in/`, `Sec-Fetch-Site:
same-site`). The portal lets `return.gst.gov.in` be entered only from its own
pages. So the extension now enters the dashboard by clicking RETURN DASHBOARD
on the welcome page (`dashboardEntry` in the settings), reuses the dashboard
while the tab is on it, and otherwise goes there by a link from the portal
page the tab is on; it never opens portal pages or files itself (the
worker's own file fetches are gone: a part the page can't read is opened
from the page so Chrome saves it in Downloads). The access-denied page
(`urls.accessDenied`) stops the run at once, without retrying. Headers are
never forged. The test portal now refuses the dashboard without a GST
`Referer`, like the real one.

**Second log, and extension 0.3.6.** A second net-export log (Nov 2026)
showed the same refused request: opened by the extension itself, no
`Referer`, a quarter-second after login. Tested in Chrome: only 0.3.4's way
(the extension opening the address) sends no `Referer`; 0.3.5's button click
and page link send `https://services.gst.gov.in/` like a person. So that
computer still ran 0.3.4 (files replaced but the extension not reloaded, and
an app page opened before the update). 0.3.6: "logged in" only once the
welcome page has finished loading (it used to be when its address first
showed); the dashboard is entered only from a fully loaded portal page,
never from the login page; every error names the extension version that
produced it ("… [extension 0.3.6]"); and on Download the app asks the
extension for the version it is running and the server for the newest one,
and stops with the update dialog if they differ, even on a page left open
from before an update.

**Third log, and extension 0.4.0: real clicks.** With 0.3.6 running (the
app's version check passed), the dashboard was still refused: Chrome 156
reports a page change started by a click the extension makes by script
(`el.click()` in the page, even the portal's own RETURN DASHBOARD button) as
coming from the extension (`initiator: chrome-extension://…`, `cross-site`,
no `Referer`). The bundled test Chromium did not, so the tests had passed.
0.4.0 makes every click a real one: `portal.js` finds the button, waits
until nothing covers it, and asks the worker (through `relay.js`, a content
script on the portal) to click its middle with `chrome.debugger`
`Input.dispatchMouseEvent`, so the portal sees an ordinary click from its own
page. Chrome shows "… started debugging this browser" during a run; the
debugger is detached at logout. If attaching fails or the bar is cancelled,
the run turns **assisted**: a click that opens another page is left to the
person (the button is outlined in orange with a banner, the app shows "Your
turn: click …" and brings the portal tab forward); other clicks are made by
script. To get back to the dashboard from other portal pages the tab goes to
the welcome page and clicks RETURN DASHBOARD. Settings v3: `urls.welcome`,
`clicks` ("real" / "assisted"). The test portal's page-opening buttons
refuse clicks that aren't real (`event.isTrusted`), so script clicks fail
the tests, as they fail on the real portal.

**Fourth log, and extension 0.4.1.** First real run with 0.4.0: the
portal **accepted** the real click on RETURN DASHBOARD (`same-site`,
`Referer: https://services.gst.gov.in/`, `Sec-Fetch-User: ?1`), the period,
Search and GSTR-1 *Generate JSON* worked, and the link answered 302 to the ZIP
on `files.gst.gov.in` (a signed address; the page may not read it, so it went
to Downloads). To fetch the next file (GSTR-3B), 0.4.0 opened the welcome
page directly to get back: refused too (302 → access denied). So **every
logged-in page is refused when opened directly**; only login and logout may
be. 0.4.1 never opens a logged-in page itself: it returns to the dashboard
with the browser's **Back** (which sends what the original click sent, checked
in Chrome 156), clicking RETURN DASHBOARD when Back reaches the welcome page;
a single refusal goes Back and carries on, a second stops the run. A GSTR-1
JSON part is caught as Chrome downloads it and read from its signed
`files.gst.gov.in` address, then removed from Downloads. Files that stay on
the dashboard (GSTR-3B PDF) are fetched before those that open other pages.

Testing: the extension test now runs against the mock portal as a real HTTPS
server for the GST host names (Chrome's `--host-resolver-rules`, a test
certificate in `tests/gst-extension/certs/`), with nothing intercepted, so
Referer, `Sec-Fetch-*`, redirects and cross-site rules are real; the mock
refuses its logged-in pages without a GST Referer like the real portal.
`GST_TEST_CHROME=/path/to/chrome` runs it in a given Chrome
(`GST_TEST_HEADED=1` for a visible window); it passes in Chrome for Testing
156.0.8078.80, the version staff use.

Fourth net-export log (0.4.1, computer A, files ticked before login): the
dashboard was still refused, about 1.5 s after the welcome page loaded, and
its request looked exactly like an address the extension opens itself
(initiator `chrome-extension://…`, no Referer, `Sec-Fetch-Site: cross-site`,
no `Sec-Fetch-User`). Chrome's "started debugging this browser" bar never
showed and no orange banner either, so the real click had not run; the
"Remind me later" pop-up only closes itself. The code alone doesn't explain
it, so **0.4.2 adds diagnostics** (nothing else changes): for the run's tabs
it records what the extension did (each step, real-click attach / press /
failure, Back, addresses it opens), what portal.js saw (the button pressed,
with its HTML and click handler; a covered button; the real-click answer;
script clicks), every click in the page (`trusted` or not, from relay.js),
each page load (referrer, Navigation Timing type), page-started navigations
(Navigation API) and, from `webNavigation` / `webRequest`, each page request
with its initiator, Referer and `Sec-Fetch-*`, the answer or redirect, and
Chrome's transition type. Addresses lose their query; no passwords,
cookies or typed text. Kept in session storage until the next login; the
app's **Save diagnostics** (next to the extension version) saves it as a
text file and copies it. New permissions: `webNavigation`, `webRequest`.
On computer B, 0.4.2's Save diagnostics only got "The GST extension didn't
answer": each entry re-read and re-wrote the whole record in storage, and the
answer waited behind that queue, past the app's 15 s. **0.4.3** keeps the
record in the worker's memory and copies it to session storage half a second
after the last entry; Save diagnostics answers from memory (45 s wait). A part
of Chrome the record listens to that Chrome refuses is listed in the record's
header instead of stopping the worker, and the app page's bridge says "reload
this page" when an update or reload has cut it off, instead of no answer.

**Still to check on the real portal (stage 0 / first pilot login):** the
login field ids (`#username`, `#user_pass`, `#captcha`), that the logged-in
address matches `services.gst.gov.in/services/auth/`, and that the logout
address logs out. A wrong one is a settings change in the app, not an
extension update. The ticked files are not fetched yet (stage 3).

## 18. Testing

- Reuse the mock GST portal (`helper/test/mock-server.ts` on
  `feature/gst-portal-downloads`), extended with: background JSON endpoints
  (for the fast route), a "changed" mode (moved address, renamed button) to
  test change detection, blob-built downloads, session expiry.
- End-to-end: Playwright loading the unpacked extension (persistent context
  with `--load-extension`), app page against a test database or mocked API,
  a simulated staff member typing captcha/OTP.
- Check: only missing files fetched; JSON asked before PDFs and never twice;
  parts > 1 saved without figures; not available ≠ error; fast-route failure
  falls back and produces a suggestion; no secrets in saved settings; no
  database calls while idle.
- App checks as usual: `npx tsc --noEmit`, `npx eslint` on changed files,
  migrations applied to a scratch Postgres and `prisma migrate diff` empty.

## 19. Risks and open questions

- **Portal terms:** automated access is discouraged. Mitigation: human login
  per client, staff-started runs, pacing, click route default, fast route
  switchable off.
- **Portal changes:** mitigated by settings-as-data, change detection,
  teach-one-step, roll back.
- **Getting bytes for on-the-fly files:** decide per type in discovery.
- **One login per browser:** rounds are one client at a time per PC; use
  more PCs for speed.
- **MV3 worker sleeping:** long waits must use alarms / the app tab.
- **Store review:** keep permissions narrow; explain host permissions
  (gst.gov.in, the app origin).
- **Open:** exact data shape for settings/suggestions/run summaries (§13);
  whether JSON-request tracking needs its own table; whether the filed-
  returns list (bonus in §8) exists and is safe to use.

## 20. Starting the build session

Suggested first message for the new session:

> Read `docs/GST_PORTAL_EXTENSION_PLAN.md`, `docs/COMPLIANCE.md`,
> `docs/GST_WORKING.md` and `docs/NEON_USAGE.md`. Look at the removed helper
> on branch `feature/gst-portal-downloads` for reference. Start with stage 1
> (missing-files view) and stage 2 (extension skeleton), on a new branch,
> committing in logical steps, and open a PR at the end.
