/* Yape PWA Service Worker - Cache First + Network Fallback */
const CACHE_VERSION = '0e0116d8ad';
const PRECACHE_NAME = `yape-precache-${CACHE_VERSION}`;
const RUNTIME_NAME  = `yape-runtime-${CACHE_VERSION}`;

// Files to precache (app shell + media). Generated at build time.
const PRECACHE_URLS = [
  "ayuda.png",
  "bcp.png",
  "borrar.png",
  "cambio.png",
  "compartir.png",
  "huella.mp4",
  "icon-192.png",
  "icon-512.png",
  "img/anuncios/anuncio1.png",
  "img/anuncios/anuncio2.png",
  "img/anuncios/anuncio3.png",
  "img/anuncios/anuncio4.png",
  "img/anuncios/anuncio5.png",
  "img/anuncios/anuncio6.png",
  "img/iconos/1yapear.png",
  "img/iconos/aprobacion.png",
  "img/iconos/biometria.png",
  "img/iconos/bus.png",
  "img/iconos/creditos.png",
  "img/iconos/dolares.png",
  "img/iconos/escanear_qr.png",
  "img/iconos/gaming.png",
  "img/iconos/mostrar_saldo.png",
  "img/iconos/movimientos_icon.png",
  "img/iconos/ocultar_saldo.png",
  "img/iconos/promos.png",
  "img/iconos/recargar.png",
  "img/iconos/remesas.png",
  "img/iconos/soat.png",
  "img/iconos/tienda.png",
  "img/iconos/vermas.png",
  "img/iconos/yapear.png",
  "img/promos/promo1.png",
  "img/promos/promo2.png",
  "img/promos/promo3.png",
  "img/promos/promo4.png",
  "img/yape-logo.png",
  "img/yape1_logo.png",
  "img/yape_logo.png",
  "img/yapear_servicios.mp4",
  "index.html",
  "logo.png",
  "manifest.webmanifest",
  "media/aprende.png",
  "media/biometria.png",
  "media/bitel.png",
  "media/claro.png",
  "media/entel.png",
  "media/entradas.png",
  "media/enviar_exterior.png",
  "media/gaming.png",
  "media/giro.png",
  "media/logo.mp4",
  "media/movistar.png",
  "media/recarga_logo.png",
  "media/seguros.png",
  "media/video.mp4",
  "media/yape-logo.png",
  "media/yapear_servicios.mp4",
  "msg-icon.png",
  "olvido.png",
  "qr.png",
  "s-icon.png",
  "search-icon.png"
];

// Helper: cache put with basic error handling (e.g., opaque responses).
async function safeCachePut(cache, request, response) {
  try {
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response);
    }
  } catch (e) {
    // Ignore cache errors (quota, opaque in some cases, etc.)
  }
}

self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => {
        if (k !== PRECACHE_NAME && k !== RUNTIME_NAME) return caches.delete(k);
      })
    );
    await self.clients.claim();
  })());
});

// Cache First + Network Fallback for same-origin requests.
// - Navigations: serve index.html from cache when offline.
// - Static assets: cache first.
// - Runtime: store new responses for offline reuse.
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ignore cross-origin requests (CDNs, analytics). Browser will handle them.
  if (url.origin !== self.location.origin) return;

  // Navigations (HTML) → App shell fallback
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      const cache = await caches.open(PRECACHE_NAME);
      const cached = await cache.match('index.html');
      try {
        const network = await fetch(request);
        // Update cache with latest index.html when online
        await safeCachePut(cache, 'index.html', network.clone());
        return network;
      } catch (e) {
        return cached || new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Assets → Cache First + Network fallback (then cache)
  event.respondWith((async () => {
    const cache = await caches.open(PRECACHE_NAME);
    const runtime = await caches.open(RUNTIME_NAME);

    const cached = await cache.match(request) || await runtime.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      await safeCachePut(runtime, request, response.clone());
      return response;
    } catch (e) {
      // If missing, return a tiny fallback instead of blank (helps avoid white screens)
      const accept = request.headers.get('accept') || '';
      if (accept.includes('image')) {
        // 1x1 transparent PNG
        const body = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,12,73,68,65,84,8,29,99,0,1,0,0,5,0,1,13,10,42,78,0,0,0,0,73,69,78,68,174,66,96,130]);
        return new Response(body, { headers: { 'Content-Type': 'image/png' } });
      }
      return new Response('', { status: 504 });
    }
  })());
});


self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification && event.notification.data && event.notification.data.url) || self.location.origin + '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        try { await client.focus(); if('navigate' in client) await client.navigate(target); return; } catch(e) {}
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});

self.addEventListener('notificationclose', () => {});
