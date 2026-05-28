const CACHE_VERSION = 'pwa-stability-v6';
const CORE_CACHE = `core-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
const EXTERNAL_CACHE = `external-${CACHE_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './service-worker.js'
];

const STATIC_CDN_ORIGINS = new Set([
  'https://www.gstatic.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://images.unsplash.com',
  'https://logo.clearbit.com'
]);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await Promise.allSettled(
      CORE_ASSETS.map(async (url) => {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch (_) {
          // No bloquear la instalación si algún archivo no está disponible.
        }
      })
    );
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }

    const valid = new Set([CORE_CACHE, RUNTIME_CACHE, EXTERNAL_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => valid.has(key) ? Promise.resolve() : caches.delete(key)));
    await self.clients.claim();
  })());
});

function isCacheable(response) {
  return !!response && (response.ok || response.type === 'opaque');
}

function offlineHtml() {
  return new Response(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#742284">
<title>Yape</title>
<style>
html,body{margin:0;height:100%;background:#742284;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
body{display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
.card{max-width:320px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:22px 18px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 16px 38px rgba(0,0,0,.22)}
h1{margin:0 0 8px;font-size:22px;font-weight:800}
p{margin:0;font-size:14px;line-height:1.45;opacity:.96}
</style>
</head>
<body>
  <div class="card">
    <h1>Sin conexión</h1>
    <p>No se pudo abrir una versión guardada todavía. Vuelve a entrar cuando tengas internet para guardar la app y usarla offline.</p>
  </div>
</body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function readCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  return cache.match(request, { ignoreSearch: false });
}

async function writeCache(cacheName, request, response) {
  if (!isCacheable(response)) return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

function shouldHandleAsNavigation(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  return request.destination === 'document' || accept.includes('text/html');
}

function isStaticAssetRequest(request) {
  return ['script', 'style', 'worker', 'font', 'image'].includes(request.destination);
}

function shouldHandleExternalAsset(url, request) {
  return STATIC_CDN_ORIGINS.has(url.origin) && isStaticAssetRequest(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (shouldHandleAsNavigation(request) && sameOrigin) {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) {
          event.waitUntil(writeCache(RUNTIME_CACHE, request, preload.clone()));
          return preload;
        }
      } catch (_) {}

      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        event.waitUntil(writeCache(RUNTIME_CACHE, request, fresh.clone()));
        return fresh;
      } catch (_) {
        return (await readCache(request, RUNTIME_CACHE))
          || (await readCache('./index.html', CORE_CACHE))
          || (await readCache('./', CORE_CACHE))
          || offlineHtml();
      }
    })());
    return;
  }

  if (sameOrigin && isStaticAssetRequest(request)) {
    event.respondWith((async () => {
      const cached = (await readCache(request, RUNTIME_CACHE)) || (await readCache(request, CORE_CACHE));
      if (cached) {
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(request, { cache: 'no-store' });
            await writeCache(RUNTIME_CACHE, request, fresh.clone());
          } catch (_) {}
        })());
        return cached;
      }

      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        await writeCache(RUNTIME_CACHE, request, fresh.clone());
        return fresh;
      } catch (_) {
        if (request.destination === 'image') {
          return new Response('', { status: 204 });
        }
        throw _;
      }
    })().catch(async () => {
      if (request.destination === 'image') {
        return new Response('', { status: 204 });
      }
      return new Response('', { status: 503, statusText: 'Offline asset unavailable' });
    }));
    return;
  }

  if (shouldHandleExternalAsset(url, request)) {
    event.respondWith((async () => {
      const cached = await readCache(request, EXTERNAL_CACHE);
      if (cached) {
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(request, { cache: 'no-store', mode: request.mode });
            await writeCache(EXTERNAL_CACHE, request, fresh.clone());
          } catch (_) {}
        })());
        return cached;
      }

      try {
        const fresh = await fetch(request, { cache: 'no-store', mode: request.mode });
        await writeCache(EXTERNAL_CACHE, request, fresh.clone());
        return fresh;
      } catch (_) {
        if (request.destination === 'image') {
          return new Response('', { status: 204 });
        }
        return new Response('', { status: 503, statusText: 'Offline asset unavailable' });
      }
    })());
    return;
  }

  if (sameOrigin) {
    event.respondWith((async () => {
      const cached = await readCache(request, RUNTIME_CACHE);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        await writeCache(RUNTIME_CACHE, request, fresh.clone());
        return fresh;
      } catch (_) {
        return new Response('', { status: 204 });
      }
    })());
  }
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'CLEAR_CACHE') {
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
      if (!('focus' in client)) continue;
      try {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      } catch (_) {}
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
