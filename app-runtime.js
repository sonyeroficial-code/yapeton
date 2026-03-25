(function(){
  const APP_CACHE_DB = 'yape-runtime-db';
  const APP_STORE = 'kv';
  const FALLBACK_PREFIX = 'yape-runtime:';
  const state = {
    lastNotice: null,
    cardVisible: false,
    lastSyncAt: Number(localStorage.getItem('yape-last-sync-at') || 0) || null,
    online: navigator.onLine !== false,
    slowHint: false,
    cardData: null
  };

  const supportsIDB = typeof indexedDB !== 'undefined';
  let dbPromise = null;

  function getConnectionInfo(){
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const effectiveType = String(connection?.effectiveType || '').toLowerCase();
    const saveData = connection?.saveData === true;
    const rtt = Number(connection?.rtt || 0) || null;
    const slowHint = !!connection && (saveData || ['slow-2g', '2g', '3g'].includes(effectiveType) || (rtt && rtt > 700));
    state.slowHint = slowHint;
    return {
      online: navigator.onLine !== false,
      effectiveType,
      saveData,
      rtt,
      slowHint
    };
  }

  function getTimeout(kind){
    const info = getConnectionInfo();
    const slow = info.slowHint || !info.online;
    const budgets = {
      read: slow ? 2200 : 3600,
      write: slow ? 3800 : 5600,
      fetchGet: slow ? 2500 : 4500,
      navigation: slow ? 2200 : 3200
    };
    return budgets[kind] || budgets.read;
  }

  function promiseWithTimeout(promise, timeoutMs, label){
    const budget = timeoutMs || getTimeout('read');
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error((label || 'request') + ' timed out');
          err.code = 'timeout';
          reject(err);
        }, budget);
      })
    ]).finally(() => {
      if(timer) clearTimeout(timer);
    });
  }

  function openDb(){
    if(!supportsIDB) return Promise.resolve(null);
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(APP_CACHE_DB, 1);
        request.onupgradeneeded = function(){
          const db = request.result;
          if(!db.objectStoreNames.contains(APP_STORE)){
            db.createObjectStore(APP_STORE);
          }
        };
        request.onsuccess = function(){ resolve(request.result); };
        request.onerror = function(){ resolve(null); };
      } catch(_) {
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function writeCache(key, value){
    const payload = { data: value, savedAt: Date.now() };
    const db = await openDb();
    if(db){
      await new Promise((resolve) => {
        const tx = db.transaction(APP_STORE, 'readwrite');
        tx.objectStore(APP_STORE).put(payload, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } else {
      try { localStorage.setItem(FALLBACK_PREFIX + key, JSON.stringify(payload)); } catch(_) {}
    }
    markFreshSync(payload.savedAt);
  }

  async function readCache(key){
    const db = await openDb();
    if(db){
      return new Promise((resolve) => {
        const tx = db.transaction(APP_STORE, 'readonly');
        const req = tx.objectStore(APP_STORE).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => resolve(null);
      });
    }
    try {
      const raw = localStorage.getItem(FALLBACK_PREFIX + key);
      return raw ? JSON.parse(raw).data : null;
    } catch(_) {
      return null;
    }
  }

  async function readCacheEnvelope(key){
    const db = await openDb();
    if(db){
      return new Promise((resolve) => {
        const tx = db.transaction(APP_STORE, 'readonly');
        const req = tx.objectStore(APP_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }
    try {
      const raw = localStorage.getItem(FALLBACK_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch(_) {
      return null;
    }
  }

  async function withCachedFallback(key, fetcher, options){
    const opts = options || {};
    const shouldFallback = typeof opts.shouldFallback === 'function'
      ? opts.shouldFallback
      : (err) => {
          const msg = String(err?.message || err || '').toLowerCase();
          const code = String(err?.code || '').toLowerCase();
          return navigator.onLine === false || code.includes('timeout') || msg.includes('timeout') || msg.includes('network') || msg.includes('offline') || msg.includes('unavailable');
        };

    try {
      const fresh = await fetcher();
      await writeCache(key, fresh);
      return fresh;
    } catch (err) {
      const cached = await readCacheEnvelope(key);
      if(cached && shouldFallback(err)){
        notify(opts.fallbackMessage || 'Conexión lenta, mostrando contenido guardado.', 'slow');
        updateOfflineCard({ mode: navigator.onLine === false ? 'offline' : 'cached', savedAt: cached.savedAt });
        return Object.assign({}, cached.data, { __fromCache: true, __savedAt: cached.savedAt });
      }
      throw err;
    }
  }

  function markFreshSync(ts){
    const value = Number(ts || Date.now());
    state.lastSyncAt = value;
    try { localStorage.setItem('yape-last-sync-at', String(value)); } catch(_) {}
  }

  function formatDateTime(ts){
    if(!ts) return 'sin sincronizar aún';
    try {
      return new Date(ts).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
    } catch(_) {
      return new Date(ts).toString();
    }
  }

  function ensureUi(){
    if(document.getElementById('appRuntimeNotice')) return;
    const style = document.createElement('style');
    style.id = 'appRuntimeStyle';
    style.textContent = `
      #appRuntimeNotice{position:fixed;top:max(env(safe-area-inset-top,0px),12px);left:50%;transform:translate(-50%,-18px);opacity:0;pointer-events:none;z-index:2147483647;transition:opacity .2s ease,transform .2s ease;max-width:min(92vw,560px)}
      #appRuntimeNotice.show{opacity:1;transform:translate(-50%,0)}
      #appRuntimeNotice .bar{background:rgba(27,20,46,.94);color:#fff;border:1px solid rgba(255,255,255,.14);box-shadow:0 14px 32px rgba(0,0,0,.28);border-radius:16px;padding:12px 14px;font:500 14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
      #appRuntimeNotice .bar[data-level="ok"]{background:rgba(18,92,69,.94)}
      #appRuntimeNotice .bar[data-level="slow"]{background:rgba(72,52,16,.95)}
      #appRuntimeOfflineCard{position:fixed;left:12px;right:12px;bottom:max(env(safe-area-inset-bottom,0px),12px);z-index:2147483646;display:none}
      #appRuntimeOfflineCard.show{display:block}
      #appRuntimeOfflineCard .card{max-width:min(96vw,560px);margin:0 auto;background:rgba(20,12,34,.96);color:#fff;border-radius:20px;padding:14px 16px;border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 44px rgba(0,0,0,.34);font:500 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
      #appRuntimeOfflineCard .title{font-size:15px;font-weight:700;margin-bottom:4px}
      #appRuntimeOfflineCard .meta{opacity:.82;font-size:12px;margin-top:8px}
      #appRuntimeOfflineCard .actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
      #appRuntimeOfflineCard button{appearance:none;-webkit-appearance:none;border:none;border-radius:999px;padding:10px 14px;font:600 13px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
      #appRuntimeOfflineCard .primary{background:#18c7b7;color:#1d1230}
      #appRuntimeOfflineCard .ghost{background:rgba(255,255,255,.12);color:#fff}
    `;
    document.head.appendChild(style);

    const notice = document.createElement('div');
    notice.id = 'appRuntimeNotice';
    notice.innerHTML = '<div class="bar" data-level="slow"></div>';
    document.body.appendChild(notice);

    const card = document.createElement('div');
    card.id = 'appRuntimeOfflineCard';
    card.innerHTML = `
      <div class="card">
        <div class="title">Modo offline listo</div>
        <div class="body">La interfaz principal ya se mostró. Si la red tarda demasiado, se usa la versión guardada.</div>
        <div class="meta"></div>
        <div class="actions">
          <button class="primary" type="button">Reintentar</button>
          <button class="ghost" type="button">Ocultar</button>
        </div>
      </div>`;
    document.body.appendChild(card);

    card.querySelector('.primary').addEventListener('click', function(){
      if(navigator.onLine !== false) location.reload();
      else notify('Sigues sin conexión. Se mantiene la versión guardada.', 'slow');
    });
    card.querySelector('.ghost').addEventListener('click', function(){
      card.classList.remove('show');
    });
  }

  function notify(message, level){
    ensureUi();
    const root = document.getElementById('appRuntimeNotice');
    if(!root) return;
    const bar = root.querySelector('.bar');
    bar.textContent = message;
    bar.dataset.level = level || 'slow';
    root.classList.add('show');
    clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => root.classList.remove('show'), level === 'ok' ? 1800 : 3200);
  }

  function updateOfflineCard(payload){
    ensureUi();
    state.cardData = payload || {};
    const root = document.getElementById('appRuntimeOfflineCard');
    if(!root) return;
    const title = root.querySelector('.title');
    const body = root.querySelector('.body');
    const meta = root.querySelector('.meta');
    const mode = String(payload?.mode || 'ready');
    const savedAt = payload?.savedAt || payload?.profile?.savedAt || state.lastSyncAt;
    const session = payload?.session || null;

    if(mode === 'ready'){
      root.classList.remove('show');
      return;
    }

    if(mode === 'online'){
      title.textContent = 'Datos actualizados';
      body.textContent = 'La app volvió a usar red y actualizó el contenido esencial sin bloquear la interfaz.';
      meta.textContent = 'Última sincronización: ' + formatDateTime(savedAt);
      root.classList.add('show');
      clearTimeout(state.cardTimer);
      state.cardTimer = setTimeout(() => root.classList.remove('show'), 2200);
      return;
    }

    if(mode === 'hydrating'){
      title.textContent = 'Abriendo rápido';
      body.textContent = 'La interfaz cargó primero y la validación de la sesión continúa en segundo plano.';
    } else if(mode === 'cached-session' || mode === 'cached'){
      title.textContent = 'Conexión lenta, usando datos guardados';
      body.textContent = 'La red no respondió a tiempo. La app sigue funcionando con la sesión o contenido guardado.';
    } else if(mode === 'offline-no-session'){
      title.textContent = 'Sin conexión';
      body.textContent = 'Puedes abrir la interfaz básica, pero necesitas internet para iniciar sesión por primera vez.';
    } else if(mode === 'session-expired'){
      title.textContent = 'Sesión no válida';
      body.textContent = 'Se recuperó la interfaz, pero la cuenta necesita validarse de nuevo con internet.';
    } else {
      title.textContent = 'Modo offline listo';
      body.textContent = session
        ? 'Tu sesión guardada permitió abrir la app sin dejarla en blanco.'
        : 'La app abrió su shell guardado y evitó quedarse cargando.';
    }

    const who = session?.username ? `Sesión: ${session.username}` : 'Interfaz guardada disponible';
    meta.textContent = `${who} · Última sincronización: ${formatDateTime(savedAt)}`;
    root.classList.add('show');
  }

  function setSessionMeta(meta){
    try { localStorage.setItem('yape-session-meta', JSON.stringify(meta || {})); } catch(_) {}
  }

  function patchFetch(){
    if(!window.fetch || window.__APP_RUNTIME_FETCH_PATCHED__) return;
    const nativeFetch = window.fetch.bind(window);
    window.__APP_RUNTIME_FETCH_PATCHED__ = true;

    window.fetch = function(input, init){
      const request = input instanceof Request ? input : new Request(input, init || {});
      const method = String(request.method || 'GET').toUpperCase();
      const timeoutMs = getTimeout('fetchGet');

      if(method !== 'GET' || typeof AbortController === 'undefined'){
        return nativeFetch(input, init);
      }

      const outerSignal = init && init.signal ? init.signal : request.signal;
      const controller = new AbortController();
      let timer = null;
      let onAbort = null;
      const nextInit = Object.assign({}, init || {}, { signal: controller.signal });

      if(outerSignal){
        if(outerSignal.aborted){
          controller.abort(outerSignal.reason);
        } else {
          onAbort = () => controller.abort(outerSignal.reason);
          outerSignal.addEventListener('abort', onAbort, { once: true });
        }
      }

      timer = setTimeout(() => controller.abort(new DOMException('fetch timeout', 'AbortError')), timeoutMs);

      return nativeFetch(input, nextInit).catch((err) => {
        if(controller.signal.aborted){
          err.code = err.code || 'FETCH_TIMEOUT';
        }
        throw err;
      }).finally(() => {
        clearTimeout(timer);
        if(outerSignal && onAbort){
          outerSignal.removeEventListener('abort', onAbort);
        }
      });
    };
  }

  function bindEvents(){
    window.addEventListener('online', function(){
      state.online = true;
      notify('Conexión restaurada. Actualizando contenido guardado.', 'ok');
      updateOfflineCard({ mode: 'online', savedAt: state.lastSyncAt });
    });
    window.addEventListener('offline', function(){
      state.online = false;
      notify('Sin conexión. Se muestra la versión guardada.', 'slow');
      updateOfflineCard({ mode: 'offline', savedAt: state.lastSyncAt });
    });
    if('serviceWorker' in navigator){
      navigator.serviceWorker.addEventListener('message', function(event){
        const data = event.data || {};
        if(data.type === 'APP_NOTICE' && data.message){
          notify(data.message, data.level || 'slow');
        }
      });
    }
  }

  patchFetch();
  bindEvents();
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ensureUi, { once: true });
  } else {
    ensureUi();
  }

  window.__APP_RUNTIME = {
    getConnectionInfo,
    getTimeout,
    promiseWithTimeout,
    readCache,
    writeCache,
    withCachedFallback,
    notify,
    updateOfflineCard,
    setSessionMeta,
    markFreshSync
  };
})();
