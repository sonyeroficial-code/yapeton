/* Firebase Cloud Messaging background support */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const FCM_BG_CONFIG = {
  apiKey: 'AIzaSyC89Qpf_Ie85lVkm5V5wi_xBC5fajPngj8',
  authDomain: 'yapeton.firebaseapp.com',
  projectId: 'yapeton',
  storageBucket: 'yapeton.firebasestorage.app',
  messagingSenderId: '550981729513',
  appId: '1:550981729513:web:1048656e03ec1a54410478',
  measurementId: 'G-CXZSJB540K'
};

try {
  if (!firebase.apps.length) firebase.initializeApp(FCM_BG_CONFIG);
} catch (e) {}

let __bgMessaging = null;
try { __bgMessaging = firebase.messaging(); } catch (e) { __bgMessaging = null; }

function normalizePushPayload(payload) {
  const root = payload || {};
  const data = root.data || {};
  const note = root.notification || {};
  const title = note.title || data.title || 'Confirmación de Pago';
  const body = note.body || data.body || data.text || 'Recibiste un nuevo yapeo';
  const icon = note.icon || data.icon || './icon-192.png';
  const badge = note.badge || data.badge || icon;
  const url = data.url || self.location.origin + '/';
  const tag = data.tag || ('yape-push-' + (data.transferId || Date.now()));
  return { title, body, icon, badge, url, tag, data };
}

if (__bgMessaging && __bgMessaging.onBackgroundMessage) {
  __bgMessaging.onBackgroundMessage((payload) => {
    const msg = normalizePushPayload(payload);
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: msg.icon,
      badge: msg.badge,
      tag: msg.tag,
      renotify: true,
      data: { url: msg.url, raw: msg.data },
      vibrate: [180, 80, 180]
    });
  });
}

self.addEventListener('push', (event) => {
  if (!event || !event.data) return;
  event.waitUntil((async () => {
    let raw = {};
    try { raw = event.data.json(); } catch (e) {
      try { raw = { notification: { body: event.data.text() } }; } catch (_) { raw = {}; }
    }
    const msg = normalizePushPayload(raw);
    await self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: msg.icon,
      badge: msg.badge,
      tag: msg.tag,
      renotify: true,
      data: { url: msg.url, raw: msg.data },
      vibrate: [180, 80, 180]
    });
  })());
});

/* Yape PWA Service Worker - safe startup + offline support */
const CACHE_VERSION = 'push-ready-v1';
const PRECACHE_NAME = `yape-precache-${CACHE_VERSION}`;
const RUNTIME_NAME  = `yape-runtime-${CACHE_VERSION}`;

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
        } catch (_) {}
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
