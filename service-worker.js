const CACHE_VERSION = '2026-03-16-3';
const PRECACHE_NAME = `yape-precache-${CACHE_VERSION}`;
const RUNTIME_NAME = `yape-runtime-${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './bcp.png'
];
const SAME_ORIGIN_STATIC = /\.(?:png|jpg|jpeg|webp|gif|svg|mp4|webm|css|js|json|webmanifest|ico)$/i;

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_NAME);
    await Promise.allSettled(APP_SHELL.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(url, res.clone());
        }
      } catch (err) {
        // Never block install because of a missing or slow asset.
      }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key !== PRECACHE_NAME && key !== RUNTIME_NAME) {
        return caches.delete(key);
      }
    }));
    await self.clients.claim();
  })());
});

async function fromCache(request) {
  const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
  if (cached) return cached;
  if (request.mode === 'navigate') {
    return caches.match('./index.html') || caches.match('./');
  }
  return null;
}

async function putRuntime(request, response) {
  if (!response || (!response.ok && response.type !== 'opaque')) return response;
  try {
    const cache = await caches.open(RUNTIME_NAME);
    await cache.put(request, response.clone());
  } catch (err) {}
  return response;
}

async function networkFirstWithTimeout(request, timeoutMs = 3000) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
  try {
    const response = await Promise.race([fetch(request), timeout]);
    return await putRuntime(request, response);
  } catch (err) {
    return fromCache(request);
  }
}

async function staleWhileRevalidate(request) {
  const cached = await fromCache(request);
  const networkPromise = fetch(request)
    .then((response) => putRuntime(request, response))
    .catch(() => null);
  return cached || networkPromise || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithTimeout(request, 2500));
    return;
  }

  if (SAME_ORIGIN_STATIC.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification && event.notification.data && event.notification.data.url) || self.location.origin + '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        try {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        } catch (err) {}
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
