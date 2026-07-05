/*
 * coi-register.js — registers the COI service worker and reloads if needed.
 * Must run before any other scripts so SharedArrayBuffer is available
 * when the main app and WebAssembly code initialize.
 */
(function () {
  // If already cross-origin isolated, nothing to do
  if (self.crossOriginIsolated) return;

  if (!('serviceWorker' in navigator)) {
    console.warn('[coi] Service workers not supported — game may not load on HTTP.');
    return;
  }

  // Register the service worker
  navigator.serviceWorker.register('/coi-serviceworker.js').then(function (reg) {
    // If this is a fresh install (no existing controller), reload so the
    // service worker takes control and adds the headers immediately.
    if (!navigator.serviceWorker.controller) {
      console.log('[coi] Service worker installed — reloading to activate headers.');
      window.location.reload();
      return;
    }
    console.log('[coi] Service worker active — cross-origin isolation enabled.');
  }).catch(function (err) {
    console.warn('[coi] Service worker registration failed:', err);
  });
})();
