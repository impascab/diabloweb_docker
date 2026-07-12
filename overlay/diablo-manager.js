/**
 * Diablo Web Manager Overlay
 *
 * HOW IT WORKS:
 * diabloweb stores all game files (MPQ, saves) in IndexedDB under the
 * database name 'diablo_fs' via idb-kv-store, keyed by lowercase filename.
 * This overlay:
 *   1. First visit: asks user for MPQ + optional save, uploads to server
 *      (for persistence), and writes into diablo_fs IndexedDB so the game
 *      starts automatically without its own file picker.
 *   2. Subsequent visits on the SAME browser: MPQ is already in IndexedDB —
 *      overlay is skipped entirely and the game starts on its own.
 *   3. Different computer on home network: MPQ is on the server but not in
 *      that browser's IndexedDB yet — Launch button fetches it from the
 *      server and writes it into IndexedDB, then reloads so the game starts.
 */
(function () {
  'use strict';

  var API       = '/api';
  var IDB_NAME  = 'diablo_fs';  // IndexedDB database name used by diabloweb
  var IDB_STORE = 'kv';         // object store name used by idb-kv-store

  // ── IndexedDB helpers ────────────────────────────────────────────────────────

  /** Open (or create) the diablo_fs IndexedDB. */
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror   = function (e) { reject(e.target.error); };
      req.onblocked = function ()  { reject(new Error('IndexedDB blocked by another tab')); };
    });
  }

  /**
   * Write a value to diablo_fs under the given key.
   * Resolves on tx.oncomplete — NOT req.onsuccess — because IDB transactions
   * can still abort after individual request success (e.g. quota exceeded).
   */
  function idbSet(db, key, data) {
    return new Promise(function (resolve, reject) {
      var tx    = db.transaction(IDB_STORE, 'readwrite');
      var store = tx.objectStore(IDB_STORE);
      var req   = store.put(data, key);
      req.onerror   = function (e) { reject(e.target.error); };
      tx.oncomplete = function ()  { resolve(); };
      tx.onerror    = function (e) { reject(e.target.error); };
      tx.onabort    = function ()  { reject(new Error('IDB transaction aborted (quota exceeded?)')); };
    });
  }

  /** Check whether a key exists in diablo_fs. */
  function idbHas(db, key) {
    return new Promise(function (resolve, reject) {
      var tx    = db.transaction(IDB_STORE, 'readonly');
      var store = tx.objectStore(IDB_STORE);
      var req   = store.getKey(key);
      req.onsuccess = function (e) { resolve(e.target.result !== undefined); };
      req.onerror   = function (e) { reject(e.target.error); };
    });
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#dw-overlay{position:fixed;inset:0;z-index:9999;background:#0a0a0a;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'font-family:Georgia,serif;color:#c8a96e}',
    '#dw-overlay h1{font-size:2.2rem;margin:0 0 6px;',
    'text-shadow:0 0 20px #8b1a1a;letter-spacing:2px}',
    '#dw-overlay p.subtitle{color:#888;font-size:.9rem;margin:0 0 36px}',
    '.dw-card{background:#1a1008;border:1px solid #4a3010;border-radius:6px;',
    'padding:28px 36px;width:min(480px,90vw);box-shadow:0 4px 40px rgba(0,0,0,.8)}',
    '.dw-card h2{margin:0 0 18px;font-size:1.15rem;color:#e0b870;',
    'text-transform:uppercase;letter-spacing:1px;',
    'border-bottom:1px solid #3a2008;padding-bottom:10px}',
    '.dw-section{margin-bottom:22px}',
    '.dw-section label{display:block;font-size:.82rem;color:#a08050;',
    'margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}',
    '.dw-row{display:flex;gap:10px;align-items:center}',
    '.dw-file-btn{flex:1;padding:9px 14px;cursor:pointer;background:#2a1808;',
    'border:1px solid #5a3818;border-radius:4px;color:#c8a96e;font-size:.9rem;',
    'text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
    'transition:border-color .2s}',
    '.dw-file-btn:hover:not(:disabled){border-color:#a07040}',
    '.dw-file-btn:disabled{opacity:.55;cursor:not-allowed}',
    '.dw-file-btn.ok{border-color:#2a7a2a;color:#6cc06c}',
    '.dw-btn{width:100%;padding:11px;margin-top:8px;background:#6b1a1a;',
    'border:1px solid #9b3a2a;border-radius:4px;color:#f0d080;font-size:1rem;',
    'font-family:inherit;letter-spacing:1px;cursor:pointer;',
    'text-transform:uppercase;transition:background .2s}',
    '.dw-btn:hover:not(:disabled){background:#8b2a2a}',
    '.dw-btn:disabled{opacity:.45;cursor:not-allowed}',
    '.dw-progress{height:4px;background:#2a1808;border-radius:2px;',
    'margin-top:10px;overflow:hidden;display:none}',
    '.dw-progress-bar{height:100%;background:#c8602a;width:0;',
    'transition:width .2s;border-radius:2px}',
    '.dw-msg{font-size:.82rem;color:#888;margin-top:8px;min-height:18px}',
    '.dw-msg.err{color:#d04040}',
    '.dw-divider{text-align:center;color:#444;font-size:.8rem;',
    'margin:16px 0;position:relative}',
    '.dw-divider::before,.dw-divider::after{content:"";position:absolute;',
    'top:50%;width:40%;height:1px;background:#2a1808}',
    '.dw-divider::before{left:0}.dw-divider::after{right:0}',
  ].join('');
  document.head.appendChild(style);

  // ── Fetch a file from server and write to IndexedDB ──────────────────────────
  function fetchAndStore(db, url, idbKey, onProg) {
    var fakeTimer = null;
    var fakePct   = 0;
    if (onProg) {
      fakeTimer = setInterval(function () {
        fakePct = Math.min(fakePct + 1, 78);
        onProg(fakePct / 100);
      }, 400);
    }
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('Server returned ' + r.status + ' for ' + url);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
        if (onProg) onProg(0.9);
        return idbSet(db, idbKey, new Uint8Array(buf));
      })
      .then(function () {
        if (onProg) onProg(1.0);
      })
      .catch(function (err) {
        if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
        throw err;
      });
  }

  // ── Setup overlay ─────────────────────────────────────────────────────────────
  function showSetupOverlay(db, status) {
    var el = document.createElement('div');
    el.id = 'dw-overlay';
    el.innerHTML = [
      '<h1>\u2694 Diablo</h1>',
      '<p class="subtitle">Self-hosted \u00b7 First-time setup</p>',
      '<div class="dw-card">',
      '<h2>Game Files</h2>',
      '<div class="dw-section">',
      '<label>DIABDAT.MPQ \u2014 Full Game (GoG / CD)</label>',
      '<div class="dw-row"><button class="dw-file-btn' +
        (status.mpqFull ? ' ok' : '') + '" id="dw-mpq-btn">' +
        (status.mpqFull ? '\u2713 DIABDAT.MPQ on server' : 'Choose DIABDAT.MPQ\u2026') +
        '</button></div>',
      '<div class="dw-divider">or</div>',
      '<label>spawn.mpq \u2014 Shareware / Free Demo</label>',
      '<div class="dw-row"><button class="dw-file-btn' +
        (status.mpqSpawn ? ' ok' : '') + '" id="dw-spawn-btn">' +
        (status.mpqSpawn ? '\u2713 spawn.mpq on server' : 'Choose spawn.mpq\u2026') +
        '</button></div>',
      '<div class="dw-progress" id="dw-mpq-progress">',
      '<div class="dw-progress-bar" id="dw-mpq-bar"></div></div>',
      '<div class="dw-msg" id="dw-mpq-msg"></div>',
      '</div>',
      '<div class="dw-section">',
      '<label>Save Game \u2014 DevilutionX .sv file (optional)</label>',
      '<div class="dw-row"><button class="dw-file-btn" id="dw-save-btn">' +
        (status.saves.length
          ? '\u2713 ' + status.saves.length + ' save(s) on server'
          : 'Choose .sv save file\u2026') +
        '</button></div>',
      '<div class="dw-progress" id="dw-save-progress">',
      '<div class="dw-progress-bar" id="dw-save-bar"></div></div>',
      '<div class="dw-msg" id="dw-save-msg"></div>',
      '</div>',
      '<button class="dw-btn" id="dw-launch-btn"' +
        (status.mpqFull || status.mpqSpawn ? '' : ' disabled') + '>',
      '\u25b6 Launch Diablo',
      '</button>',
      '<div class="dw-msg" id="dw-launch-msg">' +
        (status.mpqFull || status.mpqSpawn ? 'Ready to play!' : 'Upload an MPQ to enable launch') +
        '</div>',
      '</div>',
    ].join('');
    document.body.appendChild(el);

    // Set saves list via textContent to prevent XSS from crafted filenames
    var saveMsgEl = document.getElementById('dw-save-msg');
    if (saveMsgEl) {
      saveMsgEl.textContent = status.saves.length
        ? status.saves.join(', ')
        : 'Upload a DevilutionX save to continue your hero';
    }

    function makeInput(accept) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
      document.body.appendChild(inp);
      return inp;
    }
    var mpqInput   = makeInput('.MPQ,.mpq');
    var spawnInput = makeInput('.mpq,.MPQ');
    var saveInput  = makeInput('.sv,.SV');

    var hasMPQ = !!(status.mpqFull || status.mpqSpawn);

    function setMsg(id, msg, isErr) {
      var m = document.getElementById(id);
      if (!m) return;
      m.textContent = msg;
      m.className = 'dw-msg' + (isErr ? ' err' : '');
    }
    function updateLaunch() {
      var b = document.getElementById('dw-launch-btn');
      if (b) b.disabled = !hasMPQ;
      setMsg('dw-launch-msg',
        hasMPQ ? 'Ready to play!' : 'Upload an MPQ to enable launch', false);
    }

    function handleUpload(file, apiEndpoint, apiName, idbKey, btnId, progId, barId, msgId) {
      var btn  = document.getElementById(btnId);
      var prog = document.getElementById(progId);
      var bar  = document.getElementById(barId);
      if (!btn || !prog || !bar) return Promise.resolve(false);

      prog.style.display = 'block';
      bar.style.width = '0%';
      btn.disabled = true;
      setMsg(msgId, 'Reading file\u2026', false);

      return file.arrayBuffer().then(function (buf) {
        var uint8 = new Uint8Array(buf);
        setMsg(msgId, 'Uploading to server\u2026', false);
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', API + apiEndpoint + '?name=' + encodeURIComponent(apiName));
          xhr.upload.addEventListener('progress', function (e) {
            if (e.lengthComputable) {
              bar.style.width = Math.round((e.loaded / e.total) * 60) + '%';
            }
          });
          xhr.addEventListener('load', function () {
            try { resolve({ parsed: JSON.parse(xhr.responseText), uint8: uint8 }); }
            catch (_) { reject(new Error('Server error (status ' + xhr.status + ')')); }
          });
          xhr.addEventListener('error', function () { reject(new Error('Network error')); });
          xhr.send(uint8);
        });
      }).then(function (r) {
        if (!r.parsed || !r.parsed.ok) {
          throw new Error(r.parsed ? r.parsed.error : 'Upload failed');
        }
        setMsg(msgId, 'Storing in browser\u2026', false);
        bar.style.width = '70%';
        return idbSet(db, idbKey, r.uint8).then(function () { return r.uint8; });
      }).then(function () {
        bar.style.width = '100%';
        prog.style.display = 'none';
        btn.textContent = '\u2713 ' + apiName + ' ready';
        btn.classList.add('ok');
        btn.disabled = false;
        setMsg(msgId, 'Done! Game will load this automatically from now on.', false);
        return true;
      }).catch(function (err) {
        prog.style.display = 'none';
        btn.disabled = false;
        setMsg(msgId, err.message || 'Failed', true);
        return false;
      });
    }

    document.getElementById('dw-mpq-btn').addEventListener('click',
      function () { mpqInput.click(); });
    document.getElementById('dw-spawn-btn').addEventListener('click',
      function () { spawnInput.click(); });
    document.getElementById('dw-save-btn').addEventListener('click',
      function () { saveInput.click(); });

    mpqInput.addEventListener('change', function () {
      var file = mpqInput.files[0]; if (!file) return;
      handleUpload(file, '/upload/mpq', 'DIABDAT.MPQ', 'diabdat.mpq',
        'dw-mpq-btn', 'dw-mpq-progress', 'dw-mpq-bar', 'dw-mpq-msg')
        .then(function (ok) {
          if (ok) { hasMPQ = true; status.mpqFull = true; updateLaunch(); }
          mpqInput.value = '';
        });
    });

    spawnInput.addEventListener('change', function () {
      var file = spawnInput.files[0]; if (!file) return;
      handleUpload(file, '/upload/mpq', 'spawn.mpq', 'spawn.mpq',
        'dw-spawn-btn', 'dw-mpq-progress', 'dw-mpq-bar', 'dw-mpq-msg')
        .then(function (ok) {
          if (ok) { hasMPQ = true; status.mpqSpawn = true; updateLaunch(); }
          spawnInput.value = '';
        });
    });

    saveInput.addEventListener('change', function () {
      var file = saveInput.files[0]; if (!file) return;
      handleUpload(file, '/upload/save', file.name, file.name.toLowerCase(),
        'dw-save-btn', 'dw-save-progress', 'dw-save-bar', 'dw-save-msg')
        .then(function () { saveInput.value = ''; });
    });

    document.getElementById('dw-launch-btn').addEventListener('click', function () {
      var mpqKey = status.mpqFull  ? 'diabdat.mpq'
                 : status.mpqSpawn ? 'spawn.mpq'
                 : null;
      var mpqUrl = status.mpqFull  ? '/api/serve/diabdat.mpq'
                 : '/api/serve/spawn.mpq';

      var launchBtn = document.getElementById('dw-launch-btn');

      if (!mpqKey) {
        if (launchBtn) launchBtn.disabled = false;
        setMsg('dw-launch-msg', 'No MPQ found on server \u2014 please upload one first.', true);
        return;
      }

      if (launchBtn) launchBtn.disabled = true;

      idbHas(db, mpqKey).then(function (alreadyInIDB) {
        if (alreadyInIDB) return Promise.resolve();

        setMsg('dw-launch-msg', 'Loading game files from server\u2026', false);
        var prog = document.getElementById('dw-mpq-progress');
        var bar  = document.getElementById('dw-mpq-bar');
        if (prog) prog.style.display = 'block';

        return fetchAndStore(db, mpqUrl, mpqKey, function (pct) {
          if (bar) bar.style.width = Math.round(pct * 80) + '%';
        }).then(function () {
          var savePromises = status.saves.map(function (name) {
            var key = name.toLowerCase();
            return idbHas(db, key).then(function (has) {
              if (has) return Promise.resolve();
              return fetchAndStore(
                db, '/api/serve/' + encodeURIComponent(name), key, null);
            });
          });
          return Promise.all(savePromises);
        }).then(function () {
          if (bar) bar.style.width = '100%';
          if (prog) prog.style.display = 'none';
        });
      }).then(function () {
        window.location.reload();
      }).catch(function (err) {
        if (launchBtn) launchBtn.disabled = false;
        setMsg('dw-launch-msg', 'Error: ' + err.message, true);
      });
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  function boot() {
    openDB().then(function (db) {
      return Promise.all([
        idbHas(db, 'diabdat.mpq'),
        idbHas(db, 'spawn.mpq'),
        fetch(API + '/status').then(function (r) {
          if (!r.ok) throw new Error('API returned ' + r.status);
          return r.json();
        }),
      ]).then(function (results) {
        var idbHasFull  = results[0];
        var idbHasSpawn = results[1];
        var srv         = results[2];

        srv.mpqFull  = !!srv.mpqFull;
        srv.mpqSpawn = !!srv.mpqSpawn;
        srv.saves    = Array.isArray(srv.saves) ? srv.saves : [];

        // MPQ already in this browser's IndexedDB.
        // Always pull ALL saves from the server unconditionally — the server is
        // the authoritative source. We WAIT for all saves to finish writing to
        // IDB before returning, so the game always starts with the latest saves.
        // Without the wait, the game boots with stale IDB saves before the
        // fresh ones finish downloading.
        if (idbHasFull || idbHasSpawn) {
          if (srv.saves.length) {
            var savePromises = srv.saves.map(function (name) {
              var key = name.toLowerCase();
              return fetchAndStore(db, '/api/serve/' + encodeURIComponent(name), key, null);
            });
            return Promise.all(savePromises).then(function () {
              // Reload so diabloweb's componentDidMount reads the fresh saves
              // from IDB. Without reload, React already mounted with stale saves.
              // On reload, idbHasFull/idbHasSpawn will still be true but
              // srv.saves will be empty if we mark sync done — so we use a flag.
              if (!sessionStorage.getItem('dw-saves-synced')) {
                sessionStorage.setItem('dw-saves-synced', '1');
                window.location.reload();
              }
            }).catch(function (e) {
              console.warn('[diablo-manager] Save sync error:', e.message);
            });
          }
          return;
        }

        // Show setup screen (Launch fetches from server into IndexedDB)
        showSetupOverlay(db, srv);
      });
    }).catch(function (err) {
      console.warn('[diablo-manager] Setup error:', err.message, '— running without overlay.');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
