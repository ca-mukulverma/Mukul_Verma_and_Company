# Control Centre (Admin)

Admin → **Control Centre** looks after the desktop accounting software MVC
installs at clients (first: **Gudakesa Desk** for Gudakesa Technologies Pvt Ltd).
Each client's copy runs on the client's own PC next to TallyPrime. This page lets
Admin:

- **Daily reports**: one row per client for a day: bills posted, amount
  billed, bank entries, purchases, salary journals, errors, pending work and
  who used the software. **Open** shows the full day.
- **Rules**: publish a change to a rate, limit or slab (PF, ESIC, GST, TDS,
  income-tax slabs, professional tax, due dates) **with the date it applies
  from**, to all clients or chosen ones. Withdraw a mistake. Also lists rates a
  client's office changed on its own.
- **Clients**: add a client (makes its key), link it to the portal client,
  switch it off, make a new key, turn missing-report alerts on/off.
- **Updates**: send a new version of the software to all clients or chosen
  ones; withdraw it; see which version each client runs.
- **Support files**: log files a client's PC sent to MVC; download, delete.

Only Admin sees the page and the APIs (`/dashboard/admin/control-centre`,
`/api/admin/desk/*`).

## How a client connects

1. Clients tab → **Add a client**: code (e.g. `GUDAKESA`), name. The key
   (`mvcd_…`) is shown **once**. Copy it and send it privately.
2. On the client's PC: Gudakesa Desk → Settings → **MVC Control Centre** →
   paste the key → **Save & test**. It shows "Connected as …".
3. The site stores only a SHA-256 hash of the key. Lost key → **New key**
   (the old one stops at once). **Switch off** blocks the client at once.

No database password is ever on a client PC: the software talks only to these
two endpoints with its key (`Authorization: Bearer mvcd_…`):

| Endpoint | When | What |
|---|---|---|
| `GET /api/desk/rules` | weekdays 11:30, 13:00, 16:00, 19:00 IST | rules for that client (for all + its own) |
| `POST /api/desk/report` | weekdays 19:00 IST | the day's report (sending a day again replaces it) |
| `GET /api/desk/version` | at every contact, and Settings → Check for update | the newest version published for that client, or `{}` |
| `GET /api/desk/download?v=1.2.0` | when staff click "Update – Install" | the installer (only a version published for that client) |
| `POST /api/desk/support` | Settings → Send support file to MVC | a logs zip (≤ 10 MB) + a note |

If the PC is off or offline at a time, it does not retry until the next time;
missed days' reports go at the next time (up to 7 days back). Saturday/Sunday
are reported only if something was done.

## Neon cost

- The key check and the rules are served from Redis (`desk:key:*`,
  `desk:rules:v1`), so the 11:30 / 13:00 / 16:00 contacts **do not wake the
  database**. Publishing or withdrawing a rule, switching a client off or making
  a new key clears the cache at once. If Redis is down, it falls back to the
  database.
- Only the 19:00 report writes to the database: inside office use (11:00–20:00)
  when the database is usually awake anyway.
- The missing-report check is a step of the existing daily job
  (`/api/cron/daily`, 11:58 IST): no new cron, no extra wake-up.

## Updates: sending a new version to clients

**What you do (after a new version is built on GitHub):**

1. Admin → Control Centre → **Updates**.
2. In **Version**, choose the new number (the list shows what GitHub has
   built; a version still being built is not offered yet).
3. **Send to**: tick a client to try it there first, or tick none for all
   clients.
4. Write one line in **What is new** (staff see it next to the Install
   button). Tick **Mark as important** only if they must install it.
5. **Publish**. The website checks the installer and fills in its check-sum
   itself; this can take up to a minute.

At their next contact (weekdays 11:30, 1, 4, 7) the client's PC shows a blue
**Update – Install** button. Nothing installs until someone there clicks it.
**Settings → Check for update** on their PC asks at once.

- **Something wrong with a version?** Press **Withdraw** next to it. PCs that
  have not installed it yet stop seeing it. PCs that already installed it keep
  it: build the old code again with a higher number and publish that.
- A client always gets the **highest** version published for it (for all
  clients or for it alone).
- **Version on each client's PC** shows what each client runs, from its last
  daily report.

**How the file reaches the client (technical):** the installers stay on the
private GitHub release. When a client PC asks for one with its key, the
website checks that this version is published for that client, then asks
GitHub with the website's own token and sends the PC on to GitHub's
short-lived download link (valid a few minutes, no token in it). The client
never sees a GitHub token. The PC checks the file against the check-sum
before it installs; a damaged download is refused.

## Support files

On a client's PC: Gudakesa Desk → Settings → **Send support file to MVC**
(logs and version; no passwords, no keys). It arrives here:

- A bell notification (and phone push) to every Admin: "Control Centre:
  support file from …".
- Control Centre → **Support files**: **Download** it into a folder *outside*
  the code (e.g. `Documents\ClientData\Gudakesa\`) and give that path to
  Claude Code. **Delete** it when done (it cannot be brought back).

The files are kept in the private Cloudflare R2 storage the website already
uses for compliance documents (folder `desk-support/`), not in the database.

## One-time setup for Updates (Vercel → Settings → Environment Variables)

| Name | Value | Needed |
|---|---|---|
| `GITHUB_DESK_TOKEN` | a GitHub token that can **only read** the `gudakesa-desk` repository (steps below) | yes |
| `GITHUB_DESK_REPO` | `ca-mukulverma/gudakesa-desk` | only if the repository is renamed |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | already there (compliance documents) | already set |
| `DESK_DOWNLOAD_MODE` | `stream` | no – only if a client's office blocks GitHub's download address; then the website passes the file through itself (slower, limited to 60 seconds per download) |

Making the GitHub token (5 minutes):

1. github.com → your photo (top right) → **Settings** → **Developer settings**
   → **Personal access tokens** → **Fine-grained tokens** → **Generate new
   token**.
2. Name: `MVC website – Gudakesa updates`. Expiration: 1 year (put a reminder
   in your calendar to make a new one).
3. **Repository access** → *Only select repositories* → `gudakesa-desk`.
4. **Permissions** → Repository permissions → **Contents: Read-only**.
   Nothing else.
5. **Generate token**, copy it, paste it in Vercel as `GITHUB_DESK_TOKEN`
   (Production), **Save**, then **Redeploy** the latest deployment.
6. Control Centre → Updates should now list the versions built on GitHub. If
   it says "GitHub answered 401", the token is wrong or has expired.

## Missing-report alert

On weekdays the daily job looks at the **previous weekday**: every active
client with alerts on, added before that day, without a report gets one
notification (bell + phone push) to each Admin. It is not repeated for the same
day. Turn it off for a client in the Clients tab.

## Rules: codes and values

Use the same code as the client's Rules screen. Values are JSON: a number
(`15000`, `8.33`), text in quotes (`"Rupee"`), or slabs
(`[[400000, 0], [800000, 5], [null, 30]]`). On the client, for a date the
**latest applying date wins**; on the same date an office change beats a
published rule, which beats the built-in value. So a rule published by Admin
with a later date replaces an older office change from that date.

## Tables

`DeskClient`, `DeskRule`, `DeskDailyReport`, `DeskEvent`
(migration `20261117031930_add_control_centre`, new tables only);
`DeskRelease`, `DeskSupportFile` (migration
`20261118120000_add_desk_updates_support`, new tables only). The published
versions are cached in Redis (`desk:releases:v1`) like the rules, so the
version check at every contact does not wake the database.

## Test

Against the app running on a **test** database (never production):

```
BASE=http://localhost:3999 DATABASE_URL=<test db> NEXTAUTH_SECRET=<app's> CRON_SECRET=<app's> \
  node --test tests/control-centre/e2e.test.mjs
```

Updates and support files: start the app with a fake GitHub and a local folder
for support files, then run the test (it starts the fake GitHub itself). With
`GK_DESK_REPO` set to a `gudakesa-desk` checkout it also runs the desktop
app's own update code (`gk/update.py`) against the website:

```
GITHUB_API_URL=http://127.0.0.1:3998 GITHUB_DESK_TOKEN=test-gh-token DESK_SUPPORT_LOCAL_DIR=<temp folder> npm run dev -- -p 3999
BASE=http://localhost:3999 DATABASE_URL=<test db> NEXTAUTH_SECRET=<app's> GK_DESK_REPO=<gudakesa-desk folder> node --test tests/control-centre/updates.test.mjs
```
