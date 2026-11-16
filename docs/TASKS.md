# Tasks: follow-up, replies and deletion

How the task list is organised, how follow-up works, what notifications go
out, and how tasks are deleted. Billing of completed tasks is in
[BILLING.md](BILLING.md); recurring returns are in [COMPLIANCE.md](COMPLIANCE.md).

## The task list

| View | What is in it |
|---|---|
| **Active** (default) | Pending, In progress and Review, and tasks waiting for their deletion to be approved |
| **Done – awaiting bill** | Completed, and the bill not numbered yet (or not started). Shows the bill's stage and how many days it has waited, oldest first |
| **Closed** | Completed and billed, or the bill cancelled / not billable |
| **Deletion requests** | Admin only: requests waiting for a decision |

Who sees which tasks is unchanged: Admins see every task, partners the tasks
they created or are on, staff the tasks they are on. Searching now stays
within that (before, a partner's search could list other tasks too).

Every card shows the **last activity** ("Ravi commented · 2 days ago") and
who the task is **waiting on**: the people asked for a reply, otherwise the
people on the task. Quick filters: **Waiting on me**, **Unanswered comment**,
**Overdue**, **No update 3+ days** (no change and no comment for 3 days).

Clicking a card opens the task in a **side panel**; the arrow keys (or the
arrows at the top) move to the previous / next task on the page, so a whole
page can be followed up without reloading the list. *Open full page* opens
the task on its own page as before.

## Follow-up from the cards

**Admins**, and **partners Admin switches on** (Settings → Permissions →
*Follow up tasks*), see on each card of the tasks they can see (partners:
created or on) the **last three comments** and a row of **one-click
comments** (`Status?`, `Please update today`, …). One click posts the comment
without opening the task. Admin edits the list under **Tasks → Quick
comments** (one per line, up to 12); it is stored in `ComplianceSetting`
under `task_quick_comments`.

## Replies needed

A comment from a follower (Admin or a follow-up partner) **asks everyone else
on the task for a reply**: the task's creator and its assignees (active
staff). Tick **No reply needed** under the comment box to post without
asking.

- Each person asked gets a **Reply needed** notification (amber in the bell)
  and the comment is listed at the top of **Today** under **Reply needed**
  until they reply. It can't be dismissed.
- Their reply is **any comment of theirs on the task** (from the task, the
  bell, Today or a card); it answers every comment waiting for them there.
- The daily digest (about noon) starts with "Replies needed: N tasks".
- Cards show **Your reply** for the person asked, and *reply asked* next to
  the names the task is waiting on.

Stored in `TaskReplyRequest` (one row per comment and person, `resolvedAt`
set by their reply).

## Notifications: one per person per action

Every task notification goes to the bell and as a push notification to the
phone. Nothing about tasks is emailed or sent on WhatsApp
(`ENABLE_TASK_EMAIL_WHATSAPP` stays off).

| Action | Who is told | Before |
|---|---|---|
| Status changed | The creator and the Admins, once each | "Task Status Updated" to the creator **and** "Task Updated" to every Admin |
| Task completed | The creator and Admins who are not billing managers: "Task completed". The billing managers (Admins among them): only "Task completed: ready for billing" | Up to three notifications to one person |
| Comment | The creator, everyone on the task and the Admins, once each; "Reply needed" for those asked | An Admin on the task got it twice |
| Task created | The assignees ("New Task Assigned") and the other Admins ("New Task Created") | An Admin assigned to it got both |
| Other edit (title, date …) | The Admins | Unchanged |

A status change is announced **10 seconds later**, and only if the task still
has that status, so an *Undo* from the toast sends nothing at all.

**The bell** lists unread notifications only. Clicking one opens what it is
about and takes it off the bell **together with that task's other
notifications**; opening a task (or replying to it) does the same. *Clear
all* empties the bell. Every notification stays under *See all
notifications* (Settings → Notifications) for 90 days. Task notifications
have **Reply**, which answers without leaving the page.

## Deleting a task (no more "Cancelled")

- **Admin**: *Delete task* deletes at once (reason optional).
- **Anyone else on the task** (its creator or an assignee): *Request
  deletion* with a reason (required). The task stays in Active, marked
  *Deletion requested*, and can't be changed until Admin decides. Admins get
  a notification and the request is under **Deletion requests**, on the card
  and in the task: **Approve** deletes it, **Reject** puts it back (an old
  cancelled task becomes Pending). The person who asked is told.
- **A task with a bill can't be deleted**, even a draft: reopen the task (an
  untouched draft bill is then removed) or deal with the bill in Billing
  first. The billing manager's *No billing* on a completed task still removes
  the task with its bill, as before.
- Every deletion is kept in `TaskDeletionRequest` with the title, client,
  reason and who asked / decided, so a deleted task can be traced.
- Tasks that were *Cancelled* before this change were turned into deletion
  requests (asked by whoever cancelled them) for Admin to approve.

## Claude's summary on Today

Each person's **Today** can show *Your task discussions in short*: a few
sentences about the comments on their tasks, written once a day by a
scheduled Claude task on the firm's Claude Pro plan (no API key in the app,
₹0 extra). The app only shows the latest summary from the last 36 hours
(`TaskDigest`).

**How it is set up (done on 11 Nov 2026)**

- **Scheduled task**: *Daily task discussion summary (Today page)* in
  claude.ai, a fresh Claude session every Monday to Saturday at 11:41 IST
  (office hours, when the database is awake, so no extra wake-up). It writes
  for at most 15 people and never twice for one person on the same day. It
  needs the **Neon connector attached to the scheduled task** (claude.ai →
  scheduled tasks → the task → connectors); without it the run stops and says so.
- **Database role `claude_tasks`**: every query of the run starts with
  `SET LOCAL ROLE claude_tasks`, so the database itself checks it. The role
  can read only the task tables (and only names from Users and Clients) and
  add rows to `TaskDigest`. Anything else (client logins, bills, phone
  numbers, PAN, changing or deleting a row, creating a table) is refused with
  `permission denied`. It has no password and can't log in; the database
  owner switches to it (`INHERIT FALSE`, so the owner's own rights are
  unchanged). It was created with plain SQL, not Neon's role tool, which
  would have put it in Neon's broad superuser group:

  ```sql
  CREATE ROLE claude_tasks NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  GRANT USAGE ON SCHEMA public TO claude_tasks;
  GRANT SELECT ON "Task", "TaskAssignee", "TaskComment", "TaskReplyRequest", "TaskDigest" TO claude_tasks;
  GRANT SELECT ("id", "name", "role", "isActive") ON "User" TO claude_tasks;
  GRANT SELECT ("id", "contactPerson", "companyName") ON "Client" TO claude_tasks;
  GRANT INSERT ON "TaskDigest" TO claude_tasks;
  GRANT claude_tasks TO neondb_owner WITH INHERIT FALSE, SET TRUE;
  ```

- **What this does and doesn't guard**: a mistaken or misunderstood query is
  refused by the database. The Neon connector itself still holds the owner's
  access, so a session that ignored its instructions could leave the role;
  cloud Claude sessions can't connect to the database directly with a
  separate login, so this is the strongest lock available without a paid API
  key in the app. Neon keeps one day of history for restoring if ever needed.
- **To stop it**: disable the scheduled task in claude.ai. To remove the role:
  `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM claude_tasks; REVOKE USAGE ON SCHEMA public FROM claude_tasks; DROP ROLE claude_tasks;`

## Cost

Nothing here adds a paid service. Notifications are push (free); the views,
cards and reply requests are read with the task list in the same request
(no new background refresh); reply reminders ride on the existing daily
digest; Claude's summary runs on the Pro plan during office hours. The
duplicate notifications removed above mean fewer notifications overall.

## Where it is in the code

- Views, statuses, quick comments: `src/lib/task-views.ts`, `src/lib/task-follow-up.ts`
- List API: `src/app/api/tasks/route.ts`; page: `src/app/dashboard/tasks/page.tsx`
- Task page / side panel: `src/components/tasks/task-detail-view.tsx`
- Comments and reply requests: `src/app/api/tasks/[id]/comments/route.ts`
- Notifications: `src/lib/task-notify.ts`; bell: `src/components/notifications/notification-system.tsx`
- Deletion: `src/lib/task-delete.ts`, `src/app/api/tasks/[id]/route.ts` (DELETE),
  `src/app/api/tasks/[id]/deletion-request/route.ts`, `src/app/api/tasks/deletion-requests/[requestId]/route.ts`
- Today: `src/lib/my-work.ts`, `src/app/dashboard/my-work/page.tsx`
