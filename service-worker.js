/* Offline support for the existing app.
   Keeps changes minimal: caches the core files that actually exist,
   stores visited assets for later offline use, and falls back to index.html
   for internal navigation when there is no connection. */
const CACHE_VERSION = 'offline-fix-v1';
const CORE_CACHE = `core-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

const CORE_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './service-worker.js'
];

async function safePut(cacheName, request, response) {
  try {
    if (!response) return;
    if (response.ok || response.type === 'opaque') {
      const cache = await caches.open(cacheName);
      await cache.put(request, response);
    }
  } catch (e) {
    // Ignore quota/cache errors to avoid breaking the app.
  }
}

self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await Promise.allSettled(
      CORE_FILES.map(async (url) => {
        try {
          const response = await fetch(url, { cache: 'no-store' });
          if (response.ok || response.type === 'opaque') {
            await cache.put(url, response);
          }
        } catch (e) {
          // Ignore missing/unavailable files during install.
        }
      })
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((key) => {
        if (key !== CORE_CACHE && key !== RUNTIME_CACHE) {
          return caches.delete(key);
        }
      })
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isHTML = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  // HTML/pages: network first, offline fallback to cached app shell.
  if (isHTML) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        await safePut(CORE_CACHE, request, fresh.clone());
        return fresh;
      } catch (e) {
        const cached =
          (await caches.match(request)) ||
          (await caches.match('./index.html')) ||
          (await caches.match('index.html')) ||
          (await caches.match('./'));

        return cached || new Response('Sin conexion', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Scripts, styles, images, fonts, videos, Firebase/CDN assets, etc.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const fresh = await fetch(request);
      await safePut(RUNTIME_CACHE, request, fresh.clone());
      return fresh;
    } catch (e) {
      if (request.destination === 'image') {
        const transparentPixel = Uint8Array.from([
          137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,
          8,6,0,0,0,31,21,196,137,0,0,0,12,73,68,65,84,8,29,99,0,1,0,0,5,0,
          1,13,10,42,78,0,0,0,0,73,69,78,68,174,66,96,130
        ]);
        return new Response(transparentPixel, {
          headers: { 'Content-Type': 'image/png' }
        });
      }

      return new Response('', { status: 504 });
    }
  })());
});
