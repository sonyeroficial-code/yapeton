/* Yape PWA Service Worker - safe startup + offline support */
const CACHE_VERSION = 'yape-shell-v20260406-ios-voucher-safe-fix3';
const PRECACHE_NAME = `yape-precache-${CACHE_VERSION}`;
const RUNTIME_NAME  = `yape-runtime-${CACHE_VERSION}`;

// Keep the app shell extremely small so install never blocks startup.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './bcp.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_NAME);
    await Promise.allSettled(
      CORE_ASSETS.map(async (url) => {
        try {
          const req = new Request(url, { cache: 'reload' });
          const res = await fetch(req);
          if (res && (res.ok || res.type === 'opaque')) {
            await cache.put(url, res.clone());
          }
        } catch (_) {
          // Never fail install because an asset is missing or offline.
        }
      })
    );
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((key) => {
        if (key !== PRECACHE_NAME && key !== RUNTIME_NAME) {
          return caches.delete(key);
        }
      })
    );
    await self.clients.claim();
  })());
});

async function fromCache(request) {
  const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
  return cached || null;
}

async function putRuntime(request, response) {
  try {
    if (!response || !(response.ok || response.type === 'opaque')) return;
    const cache = await caches.open(RUNTIME_NAME);
    await cache.put(request, response.clone());
  } catch (_) {}
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never let startup HTML block. Prefer network quickly, fallback to cache.
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        putRuntime('./index.html', response.clone());
        return response;
      } catch (_) {
        return (await fromCache('./index.html')) || (await fromCache('./')) || new Response('<!doctype html><title>Offline</title><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;background:#742284;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center">Sin conexión</body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // For static assets use cache first, then network, but never throw.
  event.respondWith((async () => {
    const cached = await fromCache(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      putRuntime(request, response.clone());
      return response;
    } catch (_) {
      const accept = request.headers.get('accept') || '';
      if (accept.includes('image')) {
        const body = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,12,73,68,65,84,8,29,99,0,1,0,0,5,0,1,13,10,42,78,0,0,0,0,73,69,78,68,174,66,96,130]);
        return new Response(body, { headers: { 'Content-Type': 'image/png' } });
      }
      return new Response('', { status: 204 });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification && event.notification.data && event.notification.data.url) || self.location.origin + '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        try { await client.focus(); if ('navigate' in client) await client.navigate(target); return; } catch (_) {}
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
