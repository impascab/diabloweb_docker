/**
 * SharedArrayBuffer polyfill for HTTP (non-crossOriginIsolated) environments.
 *
 * Modern browsers removed SharedArrayBuffer on non-isolated origins, but
 * WebAssembly.Memory with shared:true still works in many browsers even without
 * crossOriginIsolated. We use this to restore SharedArrayBuffer globally.
 *
 * This runs as the very first script before anything else loads.
 */
(function() {
  if (typeof SharedArrayBuffer !== 'undefined') return; // already available

  try {
    // WebAssembly.Memory with shared:true creates a shared memory buffer.
    // Its .buffer property is a SharedArrayBuffer even without COOP/COEP
    // in browsers that support Wasm threads (Chrome 74+, Firefox 79+).
    var mem = new WebAssembly.Memory({ initial: 0, maximum: 0, shared: true });
    if (mem.buffer instanceof SharedArrayBuffer) {
      // Expose it globally so all code that checks typeof SharedArrayBuffer works
      self.SharedArrayBuffer = mem.buffer.constructor;
      console.log('[sab-polyfill] SharedArrayBuffer restored via WebAssembly.Memory');
      return;
    }
  } catch(e) {
    // WebAssembly.Memory shared not supported
  }

  console.warn('[sab-polyfill] Could not restore SharedArrayBuffer — game may not run on this browser over HTTP.');
})();
