const CACHE = 'muzzsnap-app-v4';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './config.runtime.js',
  './manifest.webmanifest',
  './muzzsnap.jpg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('config.local.json')) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request);
      const cache = await caches.open(CACHE);
      cache.put(event.request, fresh.clone());
      return fresh;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      throw new Error('offline');
    }
  })());
});
