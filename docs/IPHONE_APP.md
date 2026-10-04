# iPhone app & push notifications

MV Company can be installed on an iPhone (or Android phone) as an app from the
Home Screen. Once installed, staff receive **push notifications** on their lock
screen for everything that already creates an in-app notification: new or
reassigned tasks, status changes, task comments, chat messages, billing
approvals and permission changes. Tapping a notification opens the related task.

This uses standard Web Push (a Progressive Web App), so there is **no App Store
submission, no Mac/Xcode and no Apple Developer account** needed. iPhones need
**iOS 16.4 or later**.

## One-time server setup

1. Generate VAPID keys (identifies your server to Apple/Google push services):

   ```bash
   npx web-push generate-vapid-keys
   ```

2. Add these environment variables (locally in `.env`, and in Vercel →
   Project → Settings → Environment Variables):

   ```env
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<Public Key from step 1>
   VAPID_PRIVATE_KEY=<Private Key from step 1>
   VAPID_SUBJECT=mailto:<an email address you own>
   ```

   Keep the private key secret. Do not change the keys later: doing so
   invalidates every device's subscription and staff must re-enable
   notifications.

3. Apply the database migration (adds the `PushSubscription` table):

   ```bash
   npx prisma migrate deploy
   ```

4. Redeploy. The site must be served over **HTTPS** (Vercel does this).

If the VAPID variables are missing, the app keeps working normally and simply
skips sending push notifications.

## Installing on iPhone (for each staff member)

1. Open the site in **Safari** and sign in.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open **MV Company** from the Home Screen (not from Safari) and sign in.
4. Go to **Settings → Notifications** and tap
   **Enable notifications on this device**, then **Allow**.
5. Tap **Send test notification** to confirm it works.

On Android (Chrome), steps 2–3 are optional: notifications can be enabled
directly from the browser, though installing via **Add to Home screen** gives
the app-like experience.

## How it works

| Piece | File |
| --- | --- |
| App manifest (name, icon, standalone mode) | `public/manifest.webmanifest`, `public/icons/` |
| Service worker (shows notifications, handles taps) | `public/sw.js` |
| Enable/disable/test UI | `src/components/notifications/push-notification-settings.tsx` |
| Save/remove a device subscription | `src/app/api/push/subscribe/route.ts` |
| Send a test push | `src/app/api/push/test/route.ts` |
| Server-side sending | `src/lib/web-push.ts` (called from `createNotification` in `src/lib/notifications.ts` and the API routes that create notifications directly) |

A user can enable notifications on several devices. Devices that have been
removed or have revoked permission are deleted automatically the next time a
push to them fails.

## Troubleshooting

- **No "Enable" button on iPhone** – the app must be opened from the Home
  Screen icon, not from Safari.
- **"Notifications are blocked"** – iPhone Settings → Notifications →
  MV Company → Allow Notifications.
- **Nothing arrives** – check that the three VAPID variables are set in Vercel
  and that the deployment was rebuilt after adding them
  (`NEXT_PUBLIC_*` values are baked in at build time).

## Going further: a native App Store app

If you later want an App Store listing, the same site can be wrapped with
[Capacitor](https://capacitorjs.com/) and push sent via Apple Push Notification
service (APNs). That requires a Mac with Xcode and an Apple Developer account
($99/year); the notification triggers in `src/lib/web-push.ts` would gain a
second APNs sender alongside Web Push.
