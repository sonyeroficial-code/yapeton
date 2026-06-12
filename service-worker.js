/* Yape PWA - Android/iPhone + offline real (datos sin megas no se queda cargando) */
const CACHE_NAME = 'yape-pwa-v20260612-3';
const OFFLINE_URL = './offline.html';
const NETWORK_TIMEOUT_MS = 2300;
const REMOTE_TIMEOUT_MS = 1800;

const PRECACHE_URLS = [
  './',
  './index.html',
  './app_yapeando_mismo_estilo.html',
  './manifest.webmanifest',
  './offline.html',
  './bcp.png',
  './icon-192.png',
  './icon-512.png',
  './logobaucher.gif',
  './assets/animacion_confetti.gif',
  './assets/animacion_yape_confetti.js',
  './assets/animacion_yape_confetti_v3.js',
  './assets/aprobacion.png',
  './assets/audio_app.mp3',
  './assets/barra_opciones_perfil.webp',
  './assets/biometria.png',
  './assets/creditos.png',
  './assets/dolares.png',
  './assets/fuente_roboto_01.woff2',
  './assets/fuente_roboto_02.woff2',
  './assets/icono_app_yape.svg',
  './assets/icono_aprobar_compras.svg',
  './assets/icono_campana.svg',
  './assets/icono_contactos_yape.webp',
  './assets/icono_creditos.svg',
  './assets/icono_dolares.svg',
  './assets/icono_escanear_qr.svg',
  './assets/icono_flecha_movimientos.svg',
  './assets/icono_gaming.webp',
  './assets/icono_huella_morada.webp',
  './assets/icono_movimientos.svg',
  './assets/icono_ojo_mostrar_saldo.svg',
  './assets/icono_ojo_ocultar_saldo.png',
  './assets/icono_ojo_ocultar_saldo_backup.svg',
  './assets/icono_perfil.svg',
  './assets/icono_promos.webp',
  './assets/icono_recargar_celular.svg',
  './assets/icono_remesas.svg',
  './assets/icono_soat.svg',
  './assets/icono_soporte.svg',
  './assets/icono_tienda.svg',
  './assets/icono_ver_todo_base.webp',
  './assets/icono_viajar_bus.webp',
  './assets/icono_yape_svg.svg',
  './assets/icono_yapear_boton.svg',
  './assets/icono_yapear_servicios.svg',
  './assets/logo_yape_principal.webp',
  './assets/mensaje.png',
  './assets/promo_01.webp',
  './assets/promo_02.webp',
  './assets/promo_03.webp',
  './assets/promo_04.webp',
  './assets/promo_05.webp',
  './assets/promo_06.webp',
  './assets/qr_yape_morado.webp',
  './assets/recargar.png',
  './assets/remesas.png',
  './assets/roboto_latin.woff2',
  './assets/roboto_simbolos.woff2',
  './assets/soat.png',
  './assets/tienda.png',
  './assets/yape_personaje.svg',
  './img/yape1_logo.png',
  './img/yape_logo.png',
  './img/yapear_servicios.mp4',
  './media/aprende.png',
  './media/biometria.png',
  './media/bitel.png',
  './media/claro.png',
  './media/entel.png',
  './media/entradas.png',
  './media/logo.gif',
  './media/movistar.png',
  './media/seguros.png',
  './media/video.mp4',
  './media/yapear_servicios.mp4',
  './img/anuncios/anuncio1.png',
  './img/anuncios/anuncio2.png',
  './img/anuncios/anuncio3.png',
  './img/anuncios/anuncio4.png',
  './img/anuncios/anuncio5.png',
  './img/anuncios/anuncio6.png',
  './img/iconos/aprobacion.png',
  './img/iconos/biometria.png',
  './img/iconos/bus.png',
  './img/iconos/creditos.png',
  './img/iconos/dolares.png',
  './img/iconos/gaming.png',
  './img/iconos/promos.png',
  './img/iconos/recargar.png',
  './img/iconos/remesas.png',
  './img/iconos/soat.png',
  './img/iconos/tienda.png',
  './img/promos/promo1.png',
  './img/promos/promo2.png',
  './img/promos/promo3.png',
  './img/promos/promo4.png'
];

function timeoutPromise(ms){
  return new Promise((_, reject) => setTimeout(() => reject(new Error('network-timeout')), ms));
}

function fetchWithTimeout(request, ms){
  return Promise.race([fetch(request), timeoutPromise(ms || NETWORK_TIMEOUT_MS)]);
}

async function putSafe(cache, request, response){
  try{
    if(response && response.ok) await cache.put(request, response.clone());
  }catch(e){}
}

function jsResponse(code){
  return new Response(code, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function emptyJs(){ return jsResponse('/* offline fallback */\n'); }

function firebaseStub(url){
  const p = url.pathname || '';
  if(p.includes('firebase-app')){
    return jsResponse(`
      const __apps=[];
      export function initializeApp(config={}, name='[DEFAULT]'){ const app={config,name,options:config}; __apps.push(app); return app; }
      export function getApps(){ return __apps.slice(); }
      export function getApp(name='[DEFAULT]'){ return __apps.find(a=>a.name===name) || initializeApp({}, name); }
      export async function deleteApp(){ return true; }
    `);
  }
  if(p.includes('firebase-analytics')){
    return jsResponse(`
      export function getAnalytics(){ return {}; }
      export async function isSupported(){ return false; }
      export function logEvent(){ return; }
    `);
  }
  if(p.includes('firebase-messaging')){
    return jsResponse(`
      export async function isSupported(){ return false; }
      export function getMessaging(){ return {}; }
      export async function getToken(){ return ''; }
      export async function deleteToken(){ return true; }
      export function onMessage(){ return function(){}; }
    `);
  }
  if(p.includes('firebase-firestore')){
    return jsResponse(`
      const offlineError = () => new Error('offline network unavailable');
      export function getFirestore(){ return {}; }
      export function doc(){ return { path:[...arguments].join('/') }; }
      export function collection(){ return { path:[...arguments].join('/') }; }
      export function query(){ return { args:[...arguments] }; }
      export function where(){ return { where:[...arguments] }; }
      export function limit(n){ return { limit:n }; }
      export async function getDoc(){ throw offlineError(); }
      export async function getDocs(){ throw offlineError(); }
      export async function setDoc(){ throw offlineError(); }
      export async function updateDoc(){ throw offlineError(); }
      export async function deleteDoc(){ throw offlineError(); }
      export function onSnapshot(ref, ok, fail){ try{ if(typeof fail==='function') setTimeout(()=>fail(offlineError()),0); }catch(e){} return function(){}; }
      export function serverTimestamp(){ return new Date(); }
      export function arrayUnion(){ return [...arguments]; }
      export function arrayRemove(){ return [...arguments]; }
      export class Timestamp{ constructor(seconds=0,nanoseconds=0){ this.seconds=seconds; this.nanoseconds=nanoseconds; } toDate(){ return new Date(this.seconds*1000); } static now(){ return new Timestamp(Math.floor(Date.now()/1000),0); } static fromDate(d){ return new Timestamp(Math.floor(d.getTime()/1000),0); } }
    `);
  }
  return emptyJs();
}

async function cacheFirstThenUpdate(request){
  const cache = await caches.open(CACHE_NAME);
  const cached = await caches.match(request);
  if(cached){
    fetchWithTimeout(request, NETWORK_TIMEOUT_MS).then(r => putSafe(cache, request, r)).catch(()=>{});
    return cached;
  }
  const fresh = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
  await putSafe(cache, request, fresh);
  return fresh;
}

async function remoteScriptStrategy(request){
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_NAME);
  const cached = await caches.match(request);
  if(cached){
    fetchWithTimeout(request, REMOTE_TIMEOUT_MS).then(r => putSafe(cache, request, r)).catch(()=>{});
    return cached;
  }
  try{
    const fresh = await fetchWithTimeout(request, REMOTE_TIMEOUT_MS);
    await putSafe(cache, request, fresh);
    return fresh;
  }catch(e){
    if(url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) return firebaseStub(url);
    if(url.hostname.includes('cdnjs.cloudflare.com') && url.pathname.includes('lottie')) return jsResponse('window.lottie=window.lottie||{loadAnimation:function(){return{destroy:function(){},play:function(){},stop:function(){}}}};');
    if(url.hostname.includes('cdn.jsdelivr.net') && url.pathname.toLowerCase().includes('jsqr')) return jsResponse('window.jsQR=window.jsQR||function(){return null};');
    return emptyJs();
  }
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(PRECACHE_URLS.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch(e) {}
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // Scripts remotos: si hay datos sin megas, no esperar infinito. Usa caché o stub para que la app abra.
  if(url.origin !== self.location.origin){
    if(req.destination === 'script' || url.hostname === 'www.gstatic.com' || url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('cdn.jsdelivr.net')){
      event.respondWith(remoteScriptStrategy(req));
    }
    return;
  }

  if(req.mode === 'navigate' || req.destination === 'document'){
    event.respondWith((async () => {
      const cached = await caches.match(req) || await caches.match('./index.html') || await caches.match(OFFLINE_URL);
      if(cached){
        fetchWithTimeout(req, NETWORK_TIMEOUT_MS).then(async fresh => {
          const cache = await caches.open(CACHE_NAME);
          await putSafe(cache, req, fresh);
        }).catch(()=>{});
        return cached;
      }
      try{
        const fresh = await fetchWithTimeout(req, NETWORK_TIMEOUT_MS);
        const cache = await caches.open(CACHE_NAME);
        await putSafe(cache, req, fresh);
        return fresh;
      }catch(e){
        return await caches.match(OFFLINE_URL) || new Response('Sin conexión', {status: 200, headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try{
      return await cacheFirstThenUpdate(req);
    }catch(e){
      if(req.destination === 'image') return new Response('', {status: 204});
      if(req.destination === 'style') return new Response('', {status: 200, headers:{'Content-Type':'text/css'}});
      if(req.destination === 'script') return emptyJs();
      return new Response('', {status: 504, statusText: 'Offline'});
    }
  })());
});
