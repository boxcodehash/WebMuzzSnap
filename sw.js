/* Notification-only worker for the live site. It does not cache pages. */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const data = payload.data || payload;
  const peer = data.peer || '';
  event.waitUntil(self.registration.showNotification('MuzzSnap', {
    body: 'New private message',
    tag: peer ? 'pm-' + peer : 'pm',
    data: { peer }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const peer = event.notification.data && event.notification.data.peer;
  const url = peer ? `private.html?peer=${encodeURIComponent(peer)}` : 'private.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('private.html') && 'focus' in client) {
          client.postMessage({ type: 'muzz-open-peer', peer });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
