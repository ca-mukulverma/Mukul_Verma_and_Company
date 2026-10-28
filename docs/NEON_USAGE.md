# Neon database usage

How the app keeps its Neon (Postgres) compute bill low, what was changed on
28 Oct 2026, and how to check that it's working.

## How Neon bills compute

The database compute starts when a query arrives and suspends after
**5 minutes with no queries**. Every wake-up therefore bills at least
5 minutes, even for a single query. Two things drive the bill:

1. **How often something wakes the database** outside real use: crons,
   polling from tabs left open, background refreshes.
2. **How long polls keep running** after people stop using the app. That
   time is added on top of Neon's own 5-minute suspend delay.

## What the usage looked like (25–27 Oct 2026, IST)

| Day | Wake-ups | Awake time |
|---|---|---|
| Sun 25 | 5 | 27 min |
| Mon 26 | 28 | 6 h 02 m |
| Tue 27 | 34 | 5 h 30 m |

- About 46% of the awake time was the idle period before suspend.
- 34 of 67 sessions lasted 6 minutes or less: one request, then idle.
- Scheduled wake-ups every day at 06:02 IST (notification cleanup),
  10:40 IST (bounce-mailbox check) and an unexplained one at 10:21 IST.
- Real use is concentrated 11:00–20:00 IST on weekdays.

## Changes made on 28 Oct 2026

### In Neon (applied directly)

| Setting | Before | After |
|---|---|---|
| Autoscaling max | 4 CU | **1 CU** (raise to 2 CU only if month-end reports feel slow) |
| Autoscaling min | 0.25 CU | 0.25 CU |
| Scale to zero | 5 min | 5 min (unchanged) |
| `pg_stat_statements` | not installed | **installed** (v1.11) |
| Stale preview branches | 8 (18–24 Oct) | deleted; only `production` remains |

### In this repository

1. **One daily cron instead of several** (`/api/cron/daily`, 06:28 UTC =
   11:58 IST). It runs, in order: compliance items, each person's daily digest
   (tasks, compliance and billing in one notification, plus the billing
   escalation to Admin), notification/bill-history cleanup, and the
   bounce-mailbox check.
   Each step is isolated and timed; the response lists every step's result.
   Job logic lives in `src/lib/cron-jobs.ts`; the old `/api/cron/*` routes
   stay for running a single job by hand (GET with
   `Authorization: Bearer <CRON_SECRET>`).
   - **Behaviour change:** the "Compliance work today" notification now
     arrives at about noon IST instead of early morning. To move it, change
     the schedule in `vercel.json` (times are UTC; IST = UTC + 5:30). Any
     time outside office hours costs one extra wake-up a day.
2. **Polling stops sooner when nobody is using the app.** The idle cut-off
   in `src/hooks/use-active-polling.tsx` is 5 minutes (was 10).
3. **Notification bell** polls every 60 s (was 30 s) through the shared
   idle-aware hook, and refreshes on return to the app at most once every
   30 s. Push notifications are unaffected.
4. **Chat staff list** (`/api/chat/users`) is cached in Redis for 5 minutes
   instead of being read from Neon on every 30-second poll. Online status
   remains live.

### Checked and already fine

- **Preview branches:** `.github/workflows/cleanup-neon-preview-branch.yml`
  deletes the Neon branch when a PR closes or a Git branch is deleted. It
  has run successfully since 25 Oct. The 8 stale branches predated it.
- **Middleware** uses the JWT only and never queries the database.
- **Auth session check** reads the user from the database at most once a
  minute per user (`USER_REFRESH_INTERVAL_MS` in `src/lib/auth.ts`), not on
  every request.
- **Connections:** the app uses Neon's pooled `DATABASE_URL`; migrations
  switch to the direct address (`scripts/migrate-on-vercel.js`). Prisma is a
  single shared client.
- **Chat live updates and the online heartbeat** use Redis, not Neon.
- **Role check** (`/api/auth/validate-role`) already polls every 5 minutes
  only while the user is active.

## Needs a decision or a check outside the code

1. **The 10:21 IST daily wake-up is not from this app's crons.** Nothing in
   `vercel.json` or the GitHub workflows runs at 04:51 UTC. Check Vercel →
   Logs around 10:21 IST for which route is called, and look for outside
   callers: an uptime monitor, a Google Apps Script trigger, or another app
   or script that calls this app's API.
2. **`expired-clients` never ran.** Its route accepts only POST, but Vercel
   Cron sends GET, so expired guest clients have never been deleted
   automatically. Turning it on would permanently delete expired guest
   clients **and their tasks and attachments**. It has been left off; decide
   whether you want it before enabling.
3. **`cache-warmup` never ran** (POST only, and it needs an admin session).
   It was a keep-alive in effect and is removed from the cron list. The
   route remains; it can be deleted.
4. **`src/app/api/init-startup.ts` and `src/lib/scheduled-tasks.ts`** use
   `node-cron`, which doesn't run on Vercel, and nothing imports them. They
   are dead code and can be deleted.

## Next step: query tuning (after a few working days)

`pg_stat_statements` started collecting on 28 Oct. After 3–4 working days,
run this on the production branch to see which queries take the most time:

```sql
SELECT calls,
       round(total_exec_time::numeric, 1) AS total_ms,
       round(mean_exec_time::numeric, 1)  AS mean_ms,
       rows,
       left(query, 200) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Then, for the top queries: `EXPLAIN ANALYZE`, add missing indexes as
reviewed Prisma migrations, and cache read-mostly results (Redis helpers are
in `src/lib/cache.ts`). Caching wasn't widened blind, because stale billing
or task figures would be worse than a few extra queries.

## How to verify

In the Neon console → project → **Monitoring** and the operations list,
over the next 3 working days:

- No wake-ups at 06:02 or 10:40 IST.
- One cron wake-up a day, around 11:58 IST (usually while the database is
  already awake).
- Fewer short (≤ 6 minute) sessions, and none late at night from open tabs.
- Vercel → Cron Jobs: `/api/cron/daily` returns 200 with `"ok": true`.
  If a step fails, the response's `failed` list names it.
