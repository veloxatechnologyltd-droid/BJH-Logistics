/*
 * BJH Logistics: shows the notifications BJH sends (Evans, 2026-11-04), so new
 * messages and requests reach staff with BJH closed.
 *
 * This is all it does. It has no fetch handler and caches nothing, so it never
 * touches a page request and keeps no business data on the device. It is plain
 * JavaScript on purpose: nothing here is built or bundled.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

/** A path inside this site, never another address. */
function sitePath(value) {
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url : null;
  } catch {
    return null;
  }
}

async function show(event) {
  let message = null;
  try {
    message = event.data ? event.data.json() : null;
  } catch {
    message = null;
  }
  // The browser insists that every push shows something.
  if (!message || typeof message.title !== "string") {
    message = { title: "BJH Logistics", body: "There is something new." };
  }
  const target = sitePath(message.url) ?? sitePath("/");

  // Someone already looking at that very page sees it arrive there.
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const watching = windows.some((client) => {
    const open = sitePath(client.url);
    return (
      client.focused &&
      client.visibilityState === "visible" &&
      open !== null &&
      open.pathname === target.pathname
    );
  });
  if (watching) return;

  // One notification per tag: a newer one replaces the last and counts them,
  // so ten messages in a group are one "(10 new)", not ten pop-ups.
  const tag = typeof message.tag === "string" ? message.tag : undefined;
  const earlier = tag ? await self.registration.getNotifications({ tag }) : [];
  const count =
    ((earlier[0] && earlier[0].data && earlier[0].data.count) || 0) + 1;
  await self.registration.showNotification(
    count > 1 ? `${message.title} (${count} new)` : message.title,
    {
      body: typeof message.body === "string" ? message.body : "",
      icon: "/icon.png",
      tag,
      renotify: Boolean(tag),
      // Stays until it is clicked or dismissed, where the system allows it.
      requireInteraction: true,
      data: { url: target.pathname + target.search, count },
    },
  );
}

self.addEventListener("push", (event) => event.waitUntil(show(event)));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = sitePath(
    (event.notification.data && event.notification.data.url) || "/",
  );
  if (!target) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const open = windows.find((client) => sitePath(client.url) !== null);
      if (open) {
        try {
          await open.focus();
          await open.navigate(target.href);
          return;
        } catch {
          // This window cannot be navigated; open another.
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
