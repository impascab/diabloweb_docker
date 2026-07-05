/*
 * coi-serviceworker.js — Cross-Origin Isolation via Service Worker
 *
 * Intercepts all page fetches and adds Cross-Origin-Opener-Policy and
 * Cross-Origin-Embedder-Policy headers to every response, enabling
 * SharedArrayBuffer on HTTP (non-HTTPS) origins.
 *
 * This technique is well established and used by many self-hosted WebAssembly
 * apps. The service worker runs in the browser and adds headers locally —
 * no HTTPS required.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  // Only handle GET requests — pass everything else through unchanged
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).then(function (response) {
      // Don't modify opaque responses (cross-origin no-cors)
      if (response.type === 'opaque') return response;

      var newHeaders = new Headers(response.headers);
      newHeaders.set('Cross-Origin-Opener-Policy',   'same-origin');
      newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
      newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

      return new Response(response.body, {
        status:     response.status,
        statusText: response.statusText,
        headers:    newHeaders,
      });
    })
  );
});
