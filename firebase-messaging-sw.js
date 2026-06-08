/* PWA offline revisado - app shell cache */
const CACHE_NAME = 'pwa-shell-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './bcp.png'
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => name === CACHE_NAME ? null : caches.delete(name)));
    await self.clients.claim();
  })());
});

function isSameOrigin(request) {
  try { return new URL(request.url).origin === self.location.origin; }
  catch (e) { return false; }
}

async function navigationFallback(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put('./index.html', response.clone()).catch(() => {});
    return response;
  } catch (e) {
    return (await caches.match('./index.html')) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok && isSameOrigin(request)) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (e) {
    if (request.destination === 'image') {
      return (await caches.match('./bcp.png')) || Response.error();
    }
    return (await caches.match('./index.html')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(navigationFallback(request));
    return;
  }
  // Same-origin files: cache first. External APIs/CDNs: network only, so Firebase etc. do not get stale/corrupted.
  if (isSameOrigin(request)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification && event.notification.close();
  event.waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}).then((clientList) => {
    for (const client of clientList) {
      if ('focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow('./index.html');
  }));
});

// Alias file for Firebase Messaging registration fallback.
