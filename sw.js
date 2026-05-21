/* PWA Service Worker - modo rápido offline / internet lento */
const CACHE_VERSION = 'offline-fast-v4';
const PRECACHE_NAME = `app-precache-${CACHE_VERSION}`;
const RUNTIME_NAME = `app-runtime-${CACHE_VERSION}`;
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

const HTML_NETWORK_TIMEOUT = 900;
const ASSET_NETWORK_TIMEOUT = 1400;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(url, response.clone());
        }
      } catch (_) {}
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key !== PRECACHE_NAME && key !== RUNTIME_NAME) return caches.delete(key);
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

function isImageRequest(request) {
  const accept = request.headers.get('accept') || '';
  const url = new URL(request.url);
  return request.destination === 'image'
    || accept.includes('image')
    || /\.(png|jpg|jpeg|webp|gif|svg|ico)(\?.*)?$/i.test(url.pathname + url.search);
}

async function fromCache(request) {
  try {
    return await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
  } catch (_) {
    return null;
  }
}

async function putRuntime(request, response) {
  try {
    if (!response || !(response.ok || response.type === 'opaque')) return;
    const cache = await caches.open(RUNTIME_NAME);
    await cache.put(request, response.clone());
  } catch (_) {}
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('network-timeout')), ms));
}

async function fetchWithTimeout(request, options, ms) {
  return Promise.race([
    fetch(request, options),
    timeout(ms)
  ]);
}

function refreshInBackground(event, request, cacheKey) {
  try {
    event.waitUntil((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        await putRuntime(cacheKey || request, response.clone());
      } catch (_) {}
    })());
  } catch (_) {}
}

function transparentPngResponse() {
  const body = Uint8Array.from([
    137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,
    0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,12,73,68,65,
    84,8,29,99,0,1,0,0,5,0,1,13,10,42,78,0,0,0,0,73,
    69,78,68,174,66,96,130
  ]);
  return new Response(body, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;


  // HTML/app shell: cache primero para no trabarse con internet lento; red actualiza por detrás.
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      const cached = await fromCache('./index.html') || await fromCache('./') || await fromCache(request);
      if (cached) {
        refreshInBackground(event, request, './index.html');
        return cached;
      }
      try {
        const response = await fetchWithTimeout(request, { cache: 'no-store' }, HTML_NETWORK_TIMEOUT);
        await putRuntime('./index.html', response.clone());
        return response;
      } catch (_) {
        return new Response(
          '<!doctype html><title>Offline</title><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#742284;min-height:100vh"></body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  if (isImageRequest(request)) {
    event.respondWith((async () => {
      const cached = await fromCache(request);
      if (cached) {
        refreshInBackground(event, request, request);
        return cached;
      }
      try {
        const response = await fetchWithTimeout(request, { cache: 'no-store' }, ASSET_NETWORK_TIMEOUT);
        await putRuntime(request, response.clone());
        return response;
      } catch (_) {
        return transparentPngResponse();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await fromCache(request);
    if (cached) {
      refreshInBackground(event, request, request);
      return cached;
    }
    try {
      const response = await fetchWithTimeout(request, {}, ASSET_NETWORK_TIMEOUT);
      await putRuntime(request, response.clone());
      return response;
    } catch (_) {
      return new Response('', { status: 204 });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (!event || !event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    })());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || self.location.origin + '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        try {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        } catch (_) {}
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
