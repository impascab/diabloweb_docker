#!/usr/bin/env node
/**
 * Diablo Web Helper API
 * Handles MPQ/save file uploads and status checks.
 * Runs on port 3000, proxied from nginx at /api/
 *
 * Streams uploads directly to disk — never buffers a full 700 MB MPQ in RAM.
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const MPQ_DIR   = '/data/mpq';
const SAVES_DIR = '/data/saves';

// Ensure data directories exist on startup
[MPQ_DIR, SAVES_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function corsHeaders(contentType) {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': contentType || 'application/json',
  };
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, corsHeaders('application/json'));
  res.end(body);
}

/**
 * Stream the request body directly to a file.
 * Uses a temp file + atomic rename so a failed upload never leaves a corrupt file.
 * Guards against double-reject: both out.on('error') and req.on('error') can fire
 * for the same failed upload; only the first rejection is forwarded.
 */
function streamToFile(req, destPath) {
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + '.tmp';
    const out = fs.createWriteStream(tmpPath);
    let settled = false;

    function fail(err) {
      if (settled) return;
      settled = true;
      out.destroy();
      fs.unlink(tmpPath, () => {});
      reject(err);
    }

    req.pipe(out);

    out.on('finish', () => {
      if (settled) return;
      fs.rename(tmpPath, destPath, err => {
        if (settled) return;
        settled = true;
        if (err) {
          fs.unlink(tmpPath, () => {});
          return reject(err);
        }
        resolve();
      });
    });

    out.on('error', fail);
    req.on('error', fail);
  });
}

// ── Request handler ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const urlObj   = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname; // e.g. /api/status

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // ── GET /api/status ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/status') {
    const mpqFull  = fs.existsSync(path.join(MPQ_DIR, 'DIABDAT.MPQ'));
    const mpqSpawn = fs.existsSync(path.join(MPQ_DIR, 'spawn.mpq'));
    let saves = [];
    try {
      saves = fs.readdirSync(SAVES_DIR).filter(f => !f.startsWith('.') && !f.endsWith('.tmp'));
    } catch (_) {}
    return sendJSON(res, 200, { mpqFull, mpqSpawn, saves });
  }

  // ── POST /api/upload/mpq ─────────────────────────────────────────────────────
  // Query param: ?name=DIABDAT.MPQ  or  ?name=spawn.mpq
  if (req.method === 'POST' && pathname === '/api/upload/mpq') {
    const rawName  = urlObj.searchParams.get('name') || 'DIABDAT.MPQ';
    const safeName = rawName.toLowerCase() === 'spawn.mpq' ? 'spawn.mpq' : 'DIABDAT.MPQ';
    const dest     = path.join(MPQ_DIR, safeName);
    try {
      await streamToFile(req, dest);
      const { size } = fs.statSync(dest);
      return sendJSON(res, 200, { ok: true, file: safeName, size });
    } catch (e) {
      console.error('[api] MPQ upload error:', e);
      return sendJSON(res, 500, { ok: false, error: String(e) });
    }
  }

  // ── POST /api/upload/save ────────────────────────────────────────────────────
  // Query param: ?name=hero.sv
  if (req.method === 'POST' && pathname === '/api/upload/save') {
    const rawName  = urlObj.searchParams.get('name') || 'hero.sv';
    const safeName = path.basename(rawName); // strip directory components
    // Reject empty, '.', and '..' — path.basename('.') = '.' and
    // path.basename('..') = '..' which both pass the !safeName check but
    // resolve to the saves dir itself or its parent when joined.
    if (!safeName || safeName === '.' || safeName === '..') {
      return sendJSON(res, 400, { ok: false, error: 'Invalid filename' });
    }
    const dest = path.join(SAVES_DIR, safeName);
    // Final guard: ensure the resolved path is actually inside SAVES_DIR
    if (!dest.startsWith(SAVES_DIR + path.sep) && dest !== SAVES_DIR) {
      return sendJSON(res, 400, { ok: false, error: 'Invalid filename' });
    }
    try {
      await streamToFile(req, dest);
      const { size } = fs.statSync(dest);
      return sendJSON(res, 200, { ok: true, file: safeName, size });
    } catch (e) {
      console.error('[api] Save upload error:', e);
      return sendJSON(res, 500, { ok: false, error: String(e) });
    }
  }

  // ── GET /api/serve/:filename ──────────────────────────────────────────────────
  // Serves a stored file (MPQ or save) back to the browser so the overlay can
  // write it into the diablo_fs IndexedDB. This is what makes the game work
  // on any computer in the house without re-uploading files.
  if (req.method === 'GET' && pathname.startsWith('/api/serve/')) {
    const rawName = path.basename(pathname);
    if (!rawName || rawName === '.' || rawName === '..') {
      return sendJSON(res, 400, { error: 'Invalid filename' });
    }
    // Look in both MPQ and saves directories
    const isMpq = rawName.toLowerCase() === 'diabdat.mpq' || rawName.toLowerCase() === 'spawn.mpq';
    const filePath = isMpq
      ? path.join(MPQ_DIR,   rawName.toLowerCase() === 'diabdat.mpq' ? 'DIABDAT.MPQ' : 'spawn.mpq')
      : path.join(SAVES_DIR, rawName);
    if (!filePath.startsWith(MPQ_DIR + path.sep) && !filePath.startsWith(SAVES_DIR + path.sep)) {
      return sendJSON(res, 400, { error: 'Invalid filename' });
    }
    if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'Not found' });
    let stat;
    try { stat = fs.statSync(filePath); } catch (e) {
      return sendJSON(res, 500, { error: 'Could not read file' });
    }
    res.writeHead(200, {
      ...corsHeaders('application/octet-stream'),
      'Content-Disposition': `attachment; filename="${rawName}"`,
      'Content-Length':      stat.size,
    });
    const serveStream = fs.createReadStream(filePath);
    serveStream.on('error', (err) => {
      console.error('[api] Serve stream error for', rawName, ':', err);
      res.destroy();
    });
    // Destroy the file read stream if the client disconnects mid-download.
    // Without this, the stream keeps an open file descriptor until GC runs.
    res.on('close', () => { serveStream.destroy(); });
    serveStream.pipe(res);
    return;
  }

  // ── GET /api/saves/:name ─────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname.startsWith('/api/saves/')) {
    const safeName = path.basename(pathname);
    // Reject '.', '..', and empty names — they resolve outside SAVES_DIR when joined.
    // path.basename('/api/saves/.') = '.' and path.basename('/api/saves/..') = '..'
    // which join to /data/saves and /data respectively (directories, not files).
    if (!safeName || safeName === '.' || safeName === '..') {
      return sendJSON(res, 400, { error: 'Invalid filename' });
    }
    const filePath = path.join(SAVES_DIR, safeName);
    // Belt-and-suspenders: ensure resolved path is inside SAVES_DIR
    if (!filePath.startsWith(SAVES_DIR + path.sep)) {
      return sendJSON(res, 400, { error: 'Invalid filename' });
    }
    if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'Not found' });
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      return sendJSON(res, 500, { error: 'Could not read file' });
    }
    res.writeHead(200, {
      ...corsHeaders('application/octet-stream'),
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length':      stat.size,
    });
    const fileStream = fs.createReadStream(filePath);
    // Must handle 'error' — without it a read failure fires an unhandled
    // EventEmitter error which crashes Node even with uncaughtException handler.
    fileStream.on('error', (err) => {
      console.error('[api] Read stream error for', safeName, ':', err);
      res.destroy();
    });
    // Destroy the file read stream if the client disconnects mid-download.
    res.on('close', () => { fileStream.destroy(); });
    fileStream.pipe(res);
    return;
  }

  // ── DELETE /api/saves/:name ──────────────────────────────────────────────────
  if (req.method === 'DELETE' && pathname.startsWith('/api/saves/')) {
    const safeName = path.basename(pathname);
    // Same dot/dotdot guard as the GET handler above.
    if (!safeName || safeName === '.' || safeName === '..') {
      return sendJSON(res, 400, { ok: false, error: 'Invalid filename' });
    }
    const filePath = path.join(SAVES_DIR, safeName);
    if (!filePath.startsWith(SAVES_DIR + path.sep)) {
      return sendJSON(res, 400, { ok: false, error: 'Invalid filename' });
    }
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: String(e) });
    }
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(3000, '127.0.0.1', () => {
  console.log('[diablo-api] Listening on 127.0.0.1:3000');
});

server.on('error', err => {
  console.error('[diablo-api] Server error:', err);
  process.exit(1);
});

// Catch any synchronous throws that escape the async request handler
// (e.g. fs.statSync failing after a successful write to a suddenly read-only volume).
// Without this, Node would print an uncaughtException and the client connection
// would hang indefinitely with no response.
process.on('uncaughtException', (err) => {
  console.error('[diablo-api] Uncaught exception:', err);
  // The server is still running — don't exit, just log.
  // Individual request handlers already send 500 on known errors;
  // this catches anything that slipped through.
});

process.on('unhandledRejection', (reason) => {
  console.error('[diablo-api] Unhandled promise rejection:', reason);
});
