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
(migration `20261117031930_add_control_centre`, new tables only).

## Test

Against the app running on a **test** database (never production):

```
BASE=http://localhost:3999 DATABASE_URL=<test db> NEXTAUTH_SECRET=<app's> CRON_SECRET=<app's> \
  node --test tests/control-centre/e2e.test.mjs
```
