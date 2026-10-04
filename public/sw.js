/* MVC Tasks service worker – receives push notifications (iPhone home-screen app, Android Chrome, desktop).
   Deliberately does NOT cache pages, so the website behaves exactly as before. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "MVC Tasks", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "MVC Tasks";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Red count on the iPhone home-screen icon (iOS 16.4+), where supported
      typeof data.unread === "number" && self.navigator && self.navigator.setAppBadge
        ? self.navigator.setAppBadge(data.unread).catch(() => {})
        : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          if ("navigate" in w) w.navigate(target);
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
