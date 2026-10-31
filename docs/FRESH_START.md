# Backups and fresh start

Settings → **Data** (Admin only).

## Backups

- **Take backup now** saves a copy of the whole database in Neon (a snapshot of
  the production branch), named with the date, time (IST) and who took it.
- The list shows every backup, including the automatic ones Neon takes; old
  ones can be deleted from there.
- Backups cover the database only: clients, tasks, compliance, bills, users and
  settings. Files in Cloudinary and Cloudflare R2 are not in them.
- **Restoring** is done in the Neon console: the project → Backup & restore →
  choose the backup → Restore. It replaces all current data, so it is not a
  button in the app.

One-time setup: in Neon, Account settings → API keys → create a key. In
Vercel → Settings → Environment Variables add `NEON_API_KEY` (the key) and
`NEON_PROJECT_ID` (Neon → Settings → Project ID), then redeploy.
`NEON_BRANCH_ID` is optional; the project's default branch is used otherwise.

## Fresh start

Removes all client work so every client can be loaded again at once
(Clients → Import). Admin types FRESH START and their login password.

1. A backup is taken first. If backups aren't set up, or the backup fails,
   nothing is removed.
2. Removed: clients and everything under them (logins, compliance works and
   periods, files' records, obligations, reminders, notes, GST working
   sign-offs, dispatches, history), tasks with comments and attachments, bills
   with their history, change requests and Tally exports, notifications and the
   activity log.
3. Bill numbers start again at 1 in every series. To start elsewhere, set the
   next number in Billing → Number series as usual.
4. Kept: users (logins, roles, permissions, photos, phone notifications),
   compliance work types, teams and settings, company profiles, bill email
   settings, connectors and client request types.
5. **Also delete stored files** (optional) removes task attachments in
   Cloudinary (`office_management/task`, `office_management/chat`) and all
   compliance files in R2 (`clients/`). Staff photos stay. These can't be
   brought back, as backups don't include files.

### Keeping clients and tasks for after the fresh start

Before the fresh start (Admin or Partner):

1. Clients → **Export to Excel** → Export all. The file has every client's
   details: contacts, other phones, GSTIN, PAN, TAN, CIN, Udyam, IEC, the
   responsible person, connector, address, Tally ledger and notes.
2. Tasks → **Export tasks**. Admin gets every task; a partner gets the tasks
   they created or are assigned.

After the fresh start:

1. Clients → Import from Excel → upload the clients file as it is. Everyone
   comes back as a permanent client. Logins, documents, compliance, history
   and bills are not in the file.
2. Edit the tasks file if needed (delete rows, change due dates), then
   Tasks → **Import tasks**. Each row becomes a new task created by the person
   importing; clients are found again by GSTIN, then name, and staff by email.
   "Start every task as Pending" is ticked by default; Completed and Cancelled
   rows always come back as Pending. Comments and bills are not carried over,
   and no notifications are sent. A row with the same title and client as an
   existing task is skipped, so uploading twice is safe.

Code: `src/lib/client-export.ts`, `src/lib/client-import.ts`,
`src/lib/task-transfer.ts`.

Code: `src/lib/fresh-start.ts`, `src/lib/neon-backup.ts`,
`src/app/api/admin/fresh-start`, `src/app/api/admin/backups`.
