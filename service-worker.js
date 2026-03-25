const CACHE_VERSION = '2026-03-25-v1';
const SHELL_CACHE = `yape-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `yape-static-${CACHE_VERSION}`;
const DATA_CACHE = `yape-data-${CACHE_VERSION}`;
const NAVIGATION_TIMEOUT_MS = 2600;
const DATA_TIMEOUT_MS = 3000;

const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './service-worker.js',
  './app-runtime.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './bcp.png'
];

const STATIC_HOSTS = new Set([
  self.location.hostname,
  'www.gstatic.com',
  'cdnjs.cloudflare.com',
  'fonts.gstatic.com',
  'fonts.googleapis.com'
]);

function notifyClients(message, level = 'slow') {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'APP_NOTICE', message, level });
    });
  }).catch(() => {});
}

async function cachePut(cacheName, request, response) {
  if (!response || !(response.ok || response.type === 'opaque')) return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function fetchWithTimeout(request, timeoutMs) {
  if (typeof AbortController === 'undefined') {
    return fetch(request);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isNavigation(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

function isStaticAsset(request, url) {
  if (request.destination && ['style', 'script', 'image', 'font', 'audio', 'manifest'].includes(request.destination)) {
    return true;
  }
  if (!STATIC_HOSTS.has(url.hostname)) return false;
  return /\.(?:css|js|mjs|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|mp3)$/i.test(url.pathname);
}

function isApiGet(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return true;
  return /firestore|googleapis/.test(url.hostname);
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(APP_SHELL.map(async (asset) => {
      try {
        const response = await fetch(new Request(asset, { cache: 'reload' }));
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(asset, response.clone());
        }
      } catch (_) {}
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (![SHELL_CACHE, STATIC_CACHE, DATA_CACHE].includes(key)) {
        return caches.delete(key);
      }
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isNavigation(request)) {
    event.respondWith((async () => {
      try {
        const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
        if (response && response.ok) {
          await cachePut(SHELL_CACHE, './index.html', response.clone());
          return response;
        }
      } catch (_) {
        notifyClients('Conexión lenta, mostrando el shell guardado.', 'slow');
      }
      const cached = await caches.match(request, { ignoreSearch: true })
        || await caches.match('./index.html', { ignoreSearch: true })
        || await caches.match('./offline.html', { ignoreSearch: true });
      if (cached) return cached;
      return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#742284;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">Sin conexión</body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    })());
    return;
  }

  if (isStaticAsset(request, url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { ignoreSearch: false });
      if (cached) {
        event.waitUntil((async () => {
          try {
            const response = await fetch(request);
            await cachePut(STATIC_CACHE, request, response.clone());
          } catch (_) {}
        })());
        return cached;
      }
      try {
        const response = await fetch(request);
        await cachePut(STATIC_CACHE, request, response.clone());
        return response;
      } catch (_) {
        notifyClients('Sin conexión. Se usaron recursos estáticos guardados.', 'slow');
        if (request.destination === 'image') {
          const fallback = await caches.match('./icon-192.png');
          if (fallback) return fallback;
        }
        return new Response('', { status: 204 });
      }
    })());
    return;
  }

  if (isApiGet(request, url)) {
    event.respondWith((async () => {
      try {
        const response = await fetchWithTimeout(request, DATA_TIMEOUT_MS);
        await cachePut(DATA_CACHE, request, response.clone());
        return response;
      } catch (_) {
        const cached = await caches.match(request, { ignoreSearch: false });
        if (cached) {
          notifyClients('Conexión lenta, mostrando datos guardados.', 'slow');
          return cached;
        }
        throw _;
      }
    })().catch(() => new Response('', { status: 504, statusText: 'Gateway Timeout' })));
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      return response;
    } catch (_) {
      const cached = await caches.match(request, { ignoreSearch: false });
      return cached || new Response('', { status: 204 });
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
