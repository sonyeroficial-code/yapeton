(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  var UPDATE_INTERVAL = 20000;
  var registrationRef = null;
  var updateAvailable = false;
  var reloadOnControllerChange = false;
  var hasReloaded = false;
  var observedDocs = new WeakSet();

  function safeCall(fn) {
    try { return fn(); } catch (e) { return null; }
  }

  function addStyles(doc) {
    if (!doc || !doc.head || doc.getElementById('external-update-system-style')) return;
    var style = doc.createElement('style');
    style.id = 'external-update-system-style';
    style.textContent = '' +
      '.update-system-banner{' +
      'position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);left:12px;right:12px;z-index:2147483646;' +
      'display:none;align-items:center;justify-content:space-between;gap:12px;' +
      'padding:12px 14px;border-radius:16px;box-sizing:border-box;' +
      'background:rgba(38,5,58,.96);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
      'border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 30px rgba(0,0,0,.28);color:#fff;' +
      'font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}' +
      '.update-system-banner.visible{display:flex;}' +
      '.update-system-banner__text{font-size:14px;line-height:1.2;font-weight:700;letter-spacing:.01em;}' +
      '.update-system-banner__btn{appearance:none;-webkit-appearance:none;border:0;cursor:pointer;' +
      'padding:10px 14px;border-radius:999px;background:#8f46ff;color:#fff;font-weight:700;font-size:14px;' +
      'white-space:nowrap;box-shadow:0 4px 16px rgba(143,70,255,.35);}' +
      '.update-system-banner__btn:active{transform:scale(.98);}' +
      '.update-system-has-update{position:relative !important;}' +
      '.update-system-has-update::after{' +
      'content:"";position:absolute;top:8px;right:8px;width:10px;height:10px;border-radius:50%;' +
      'background:#ff2b2b;box-shadow:0 0 0 2px rgba(116,34,132,.95),0 0 10px rgba(255,43,43,.55);' +
      'pointer-events:none;z-index:2;}' +
      '@supports (padding:max(0px)){' +
      '.update-system-banner{top:max(calc(env(safe-area-inset-top,0px) + 10px),10px);}' +
      '}';
    doc.head.appendChild(style);
  }

  function createBanner(doc) {
    if (!doc || !doc.body) return null;
    addStyles(doc);
    var banner = doc.getElementById('update-system-banner');
    if (banner) return banner;

    banner = doc.createElement('div');
    banner.id = 'update-system-banner';
    banner.className = 'update-system-banner';
    banner.innerHTML = '<div class="update-system-banner__text">Nueva versión disponible</div>' +
      '<button type="button" class="update-system-banner__btn">Actualizar ahora</button>';

    var button = banner.querySelector('.update-system-banner__btn');
    if (button) {
      button.addEventListener('click', function () {
        activateUpdate();
      });
    }

    doc.body.appendChild(banner);
    return banner;
  }

  function getCandidateDocs() {
    var docs = [document];
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      var frameDoc = safeCall(function () { return iframes[i].contentDocument; });
      if (frameDoc) docs.push(frameDoc);
    }
    return docs;
  }

  function markButtons(doc, active) {
    if (!doc) return;
    var selectors = [
      '.opciones-update',
      'button[onclick*="actualizarApp"]',
      'button',
      '[role="button"]'
    ];
    var nodes = [];
    selectors.forEach(function (sel) {
      safeCall(function () {
        var found = doc.querySelectorAll(sel);
        for (var i = 0; i < found.length; i++) nodes.push(found[i]);
      });
    });

    var seen = new WeakSet();
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      if (!node || seen.has(node)) continue;
      seen.add(node);
      var text = ((node.textContent || '') + ' ' + (node.getAttribute('aria-label') || '')).toLowerCase();
      var isUpdateButton =
        (node.classList && node.classList.contains('opciones-update')) ||
        text.indexOf('actualizar') !== -1;
      if (!isUpdateButton) continue;
      if (active) node.classList.add('update-system-has-update');
      else node.classList.remove('update-system-has-update');
    }
  }

  function renderState() {
    var docs = getCandidateDocs();
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      if (!doc) continue;
      addStyles(doc);
      var banner = createBanner(doc);
      if (banner) banner.classList.toggle('visible', updateAvailable && doc === document);
      markButtons(doc, updateAvailable);
    }
  }

  function setUpdateAvailable(value) {
    updateAvailable = !!value;
    renderState();
  }

  function watchInstalling(worker) {
    if (!worker || worker.__updateSystemBound) return;
    worker.__updateSystemBound = true;
    worker.addEventListener('statechange', function () {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        setUpdateAvailable(true);
      }
      if (worker.state === 'activated') {
        setUpdateAvailable(false);
      }
    });
  }

  function bindRegistration(registration) {
    if (!registration) return;
    registrationRef = registration;

    if (registration.waiting) setUpdateAvailable(true);
    if (registration.installing) watchInstalling(registration.installing);

    if (!registration.__updateSystemBound) {
      registration.__updateSystemBound = true;
      registration.addEventListener('updatefound', function () {
        watchInstalling(registration.installing);
      });
    }
  }

  function checkUpdate() {
    return navigator.serviceWorker.getRegistration().then(function (registration) {
      if (!registration) return null;
      bindRegistration(registration);
      return Promise.resolve(registration.update()).then(function () {
        if (registration.waiting) setUpdateAvailable(true);
        return registration;
      }).catch(function () {
        return registration;
      });
    }).catch(function () {
      return null;
    });
  }

  function activateUpdate() {
    var reg = registrationRef;
    var waiting = reg && reg.waiting;
    if (waiting) {
      reloadOnControllerChange = true;
      try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
      return;
    }

    checkUpdate().then(function (latestReg) {
      var currentWaiting = latestReg && latestReg.waiting;
      if (currentWaiting) {
        reloadOnControllerChange = true;
        try { currentWaiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
        return;
      }
      location.reload();
    });
  }

  function observeDocument(doc) {
    if (!doc || observedDocs.has(doc)) return;
    observedDocs.add(doc);
    var start = function () {
      addStyles(doc);
      createBanner(doc);
      markButtons(doc, updateAvailable);
      safeCall(function () {
        var mo = new MutationObserver(function () { markButtons(doc, updateAvailable); });
        mo.observe(doc.documentElement || doc.body, { childList: true, subtree: true, attributes: true });
      });
    };

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  function observeIframes() {
    function attachToFrames() {
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        (function (frame) {
          safeCall(function () {
            frame.addEventListener('load', function () {
              observeDocument(frame.contentDocument);
              renderState();
            });
            if (frame.contentDocument) observeDocument(frame.contentDocument);
          });
        })(frames[i]);
      }
      renderState();
    }

    attachToFrames();
    safeCall(function () {
      var mo = new MutationObserver(attachToFrames);
      mo.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (hasReloaded) return;
    hasReloaded = true;
    setUpdateAvailable(false);
    if (reloadOnControllerChange || true) {
      location.reload();
    }
  });

  observeDocument(document);
  observeIframes();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderState, { once: true });
  } else {
    renderState();
  }

  navigator.serviceWorker.ready.then(function (registration) {
    bindRegistration(registration);
    renderState();
    checkUpdate();
  }).catch(function () {
    checkUpdate();
  });

  setInterval(checkUpdate, UPDATE_INTERVAL);
})();
