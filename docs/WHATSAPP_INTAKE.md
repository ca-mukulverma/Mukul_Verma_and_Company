# WhatsApp intake

*For MV. What it does first, the one-time set-up next, the technical part at the end.*

The firm's **dedicated WhatsApp number** is in every client group. A small program on the office PC (the
**listener**) reads those groups and hands everything to this app. The rule is that no client message is
missed:

- **Every client message** lands in **WhatsApp** (menu → My work → WhatsApp).
- A **request or question** stays *Waiting for reply* until:
  - someone from MVC replies in the group (seen automatically, because each staff member's phone is saved under Users), or
  - someone clicks **Task** (a task for the client's manager), **Answered** (replied by phone or email) or **Information**.
- After **3 office hours** without a reply, the client's manager and Admin get an **alert**. Office hours are 11:00–20:00, Monday–Friday.
- **Every evening** after 20:00, each manager gets one push with the client messages still open.
- **Files** (bank statements, POs, bills, attendance …) go to the client's **Desk** (e.g. Gudakesa Desk). The Desk collects them at 11:30 / 1 / 4 / 7 and puts each one on the right screen. The copy here is deleted as soon as the Desk has it. Only the message text, who sent it and when stay in this app.
- The listener **only reads**. It never sends anything to a client. Replies go as they do today: from your phones or the WhatsApp extension.

> **Risk to know.** Reading groups this way is not an official WhatsApp feature: WhatsApp's own business API does
> not read ordinary groups. Because the number only reads, the risk of a ban is low. If the number is ever blocked,
> the app and the Desk keep working; only the automatic intake stops until another number is linked. Tell clients in
> the engagement letter that group messages are recorded in MVC's system (DPDP Act 2023).

## One-time set-up (about 20 minutes)

1. **Vercel → Settings → Environment Variables:** add `WA_LISTENER_KEY`. Use any long random text (at least 20 characters, e.g. from a password generator). Then redeploy. The database tables are created by the deploy's migration.
2. **File storage:** WhatsApp files use the same Cloudflare R2 storage as compliance documents (already set up, see COMPLIANCE.md). Nothing new to do.
3. **Users → each staff member → phone:** save the number each person uses on WhatsApp. Without it, their replies in a group are not recognised, and the WhatsApp page lists who is missing.
4. **Office PC (the one that stays on):**
   - install **Node.js 20 or newer** (nodejs.org, LTS);
   - copy the `listener` folder of this repository to `C:\MVC\whatsapp-listener`;
   - in that folder, copy `env.example` to `.env` and fill in `WA_LISTENER_KEY` (the same value as in Vercel);
   - open *Command Prompt* in the folder and run `npm install`, then `npm start`;
   - a **QR code** appears. On the dedicated number's phone: WhatsApp → **Linked devices** → **Link a device** → scan it. The window shows "connected - listening to the groups (read-only)".
5. **Start it with Windows:** Task Scheduler → *Create Task* → Trigger **At log on** (or At startup) → Action *Start a program*: `cmd`, arguments `/c cd /d C:\MVC\whatsapp-listener && npm start`. Tick *Run whether user is logged on or not* if the PC stays logged off.
6. **Link the groups:** after the first batch (within 30 minutes of the first message in office hours), every group appears at the bottom of the WhatsApp page (Admin only). For each group choose:
   - its **client**, and
   - for Gudakesa, its **Desk** (GUDAKESA), so its files go to Gudakesa Desk.
7. Keep the dedicated number's **phone charged and on Wi-Fi**. A linked device stops working if the phone is offline for about 14 days.

## Neon (database) cost

- The listener sends **one batch every 30 minutes**, and only between 11:00 and 20:00 on weekdays, when the database is awake for staff anyway. After 20:00 it sends one more batch, which wakes the database once.
- The 3-hour alert and the evening summary run **inside** the batch call. There is no new cron.
- The Desk's file collection and its "collected" confirmation are answered from **Redis**, so the database learns about them at the next batch.
- Files never go into the database.

The expected extra cost is about ₹50–100 a month for Gudakesa, and ₹180–450 a month for all 20 clients. The details are in the Gudakesa Desk plan (`docs/AUTOMATION_PLAN.md` §11 in the gudakesa-desk repository).

## Technical part

| Piece | Where |
|---|---|
| Listener (Node, Baileys, linked device) | `listener/index.mjs`. The queue is on disk (`DATA_DIR/queue.jsonl`), so nothing is lost while offline |
| Message sorting, office hours (pure, tested) | `src/lib/wa-classify.ts`, tested by `node --experimental-strip-types tests/whatsapp/classify.test.mjs` |
| Batch, alerts, evening summary, the Desk's feed | `src/lib/wa-intake.ts` |
| `POST /api/whatsapp/upload-url` | listener key. Returns a 10-minute R2 upload link. No database |
| `POST /api/whatsapp/batch` | listener key. `{ messages: [...], endOfDay? }`. One database session |
| `GET /api/desk/files`, `POST /api/desk/files/ack` | Desk key (Control Centre). Redis + R2 only |
| `GET/PATCH /api/whatsapp/inbox` | signed-in staff. Admin and partners see all groups, others the clients they manage. Only Admin and partners make tasks, as elsewhere in the app |
| `GET/PATCH /api/admin/whatsapp/groups` | Admin. Links a group to a client and a Desk |
| Tables | `WaGroup`, `WaMessage` (migration `20261124000000_whatsapp_intake`) |

**How messages are sorted (no AI):**

- a message from a saved staff phone counts as a reply;
- greetings and "ok" are closed at once;
- asking words (English and Hinglish: *please, send, bhej, bana do, chahiye, urgent, ?, kab, kitna …*) make it a **request** or **question**;
- a file is a **document** unless its caption asks for something;
- anything else is **information**.

Staff can change any of these on the WhatsApp page.

**Not done yet:** a "What's new" card. Add it once the listener is running, so staff are not told about a page that is still empty.
