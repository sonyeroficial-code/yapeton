/* PWA Service Worker - actualiza PNG e imagenes sin quedarse con cache vieja */
const CACHE_VERSION = 'slow-network-yape-icons-final-v7';
const PRECACHE_NAME = `app-precache-${CACHE_VERSION}`;
const RUNTIME_NAME = `app-runtime-${CACHE_VERSION}`;

// Mantener el precache pequeno. No precachear PNG/JPG aqui, asi siempre se piden de la red primero.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

const NAVIGATION_NETWORK_TIMEOUT_MS = 3000;
const ASSET_NETWORK_TIMEOUT_MS = 2500;

function fetchWithTimeout(request, options = {}, timeoutMs = NAVIGATION_NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_NAME);

    await Promise.allSettled(
      CORE_ASSETS.map(async (url) => {
        try {
          const request = new Request(url, { cache: 'reload' });
          const response = await fetch(request);

          if (response && (response.ok || response.type === 'opaque')) {
            await cache.put(url, response.clone());
          }
        } catch (_) {
          // No bloquear la instalacion si falta algun archivo.
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
        // Borra caches anteriores para que las imagenes viejas no se queden guardadas.
        if (key !== PRECACHE_NAME && key !== RUNTIME_NAME) {
          return caches.delete(key);
        }
        return Promise.resolve();
      })
    );

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
    return await caches.match(request, {
      ignoreSearch: request.mode === 'navigate'
    });
  } catch (_) {
    return null;
  }
}

async function putRuntime(request, response) {
  try {
    if (!response || !(response.ok || response.type === 'opaque')) return;
    const cache = await caches.open(RUNTIME_NAME);
    await cache.put(request, response.clone());
  } catch (_) {
    // Ignorar errores de cache.
  }
}

function transparentPngResponse() {
  const body = Uint8Array.from([
    137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,
    0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,12,73,68,65,
    84,8,29,99,0,1,0,0,5,0,1,13,10,42,78,0,0,0,0,73,
    69,78,68,174,66,96,130
  ]);

  return new Response(body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store'
    }
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // HTML: red primero, pero con tiempo maximo. Si la red esta lenta,
  // abre la copia guardada para que la app no se quede esperando.
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      const cached = await fromCache('./index.html') || await fromCache('./');

      try {
        const response = await fetchWithTimeout(
          request,
          { cache: 'no-store' },
          NAVIGATION_NETWORK_TIMEOUT_MS
        );
        await putRuntime('./index.html', response.clone());
        return response;
      } catch (_) {
        return cached || new Response(
          '<!doctype html><title></title><meta name="viewport" content="width=device-width,initial-scale=1"><body></body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Imagenes PNG/JPG/etc: red primero y sin usar cache vieja del navegador.
  // Si subes una imagen nueva con el mismo nombre, se actualiza al recargar.
  if (isImageRequest(request)) {
    event.respondWith((async () => {
      try {
        const response = await fetchWithTimeout(request, { cache: 'no-store' }, ASSET_NETWORK_TIMEOUT_MS);
        await putRuntime(request, response.clone());
        return response;
      } catch (_) {
        return await fromCache(request) || transparentPngResponse();
      }
    })());
    return;
  }

  // Otros archivos estaticos: cache primero, red como respaldo.
  event.respondWith((async () => {
    const cached = await fromCache(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      await putRuntime(request, response.clone());
      return response;
    } catch (_) {
      return new Response('', { status: 204 });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (!event || !event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

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
    const allClients = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of allClients) {
      if ('focus' in client) {
        try {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        } catch (_) {
          // Intentar abrir una ventana nueva abajo.
        }
      }
    }

    if (clients.openWindow) return clients.openWindow(target);
  })());
});
