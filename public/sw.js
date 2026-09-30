/*
 * The service worker, for one job: showing the morning brief (and the weekly
 * review) as a notification and opening the app when it is pressed
 * (plan #1124).
 *
 * It caches nothing and handles no fetches, so the app behaves exactly as it
 * did without it. Registered from the account page's notification switch
 * (app/account/notifications.tsx). The payload is lib/push/send.ts's
 * PushPayload: { title, body, url, tag }.
 *
 * The URL it opens carries from=push, so the page can tell a press on the
 * notification from any other visit and record that the brief was opened
 * (plan #1242; lib/day-brief/opens.ts).
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Your day';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      tag: payload.tag || 'day-brief',
      icon: '/apple-icon.png',
      badge: '/apple-icon.png',
      data: { url: payload.url || '/home' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/home';
  const url = new URL(path, self.location.origin);
  url.searchParams.set('from', 'push');
  const target = url.href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
