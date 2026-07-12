/**
 * patch-build.js — runs AFTER webpack build to inject save-sync code.
 * Patches the minified main.*.js to wrap fs.update() with a server POST.
 * Must run as: node patch-build.js from the /build directory.
 */
const fs   = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, 'build/static/js');
const files = fs.readdirSync(jsDir).filter(function(f) {
  return f.startsWith('main.') && f.endsWith('.js');
});

if (!files.length) {
  console.error('[patch] ERROR: No main.*.js found in build/static/js');
  process.exit(1);
}

const mainFile = path.join(jsDir, files[0]);
let src = fs.readFileSync(mainFile, 'utf8');

// Webpack minifies  update:(name,data)=>store.set(name,data)
// into something like  update:(e,t)=>n.set(e,t)
// The regex captures whichever single-or-multi-char variable names webpack chose.
const pattern = /update:\((\w+),(\w+)\)=>(\w+)\.set\(\1,\2\)/;
const match   = src.match(pattern);

if (!match) {
  console.error('[patch] Could not find update pattern in', files[0]);
  console.error('[patch] Save sync patch skipped — saves will still work locally.');
  process.exit(0); // soft fail — do not break the build
}

const full  = match[0];
const nName = match[1]; // minified 'name' variable
const nData = match[2]; // minified 'data' variable
const nStore= match[3]; // minified 'store' variable

const replacement =
  'update:(' + nName + ',' + nData + ')=>{' +
    'var _r=' + nStore + '.set(' + nName + ',' + nData + ');' +
    'if(' + nName + '.match(/\\.sv$/i)){' +
      'try{' +
        'var _c=(' + nData + ' instanceof Uint8Array)?' + nData + '.slice():new Uint8Array(' + nData + ');' +
        'fetch("/api/upload/save?name="+encodeURIComponent(' + nName + '),{method:"POST",body:_c})' +
        '.then(function(_res){' +
          'if(_res.ok)console.log("[diablo] Save synced to server:",' + nName + ');' +
          'else console.warn("[diablo] Save sync failed:",_res.status,' + nName + ');' +
        '}).catch(function(_e){console.warn("[diablo] Save sync error:",_e.message,' + nName + ');});' +
      '}catch(_e){console.warn("[diablo] Save sync exception:",_e.message);}' +
    '}' +
    'return _r;}';

src = src.replace(full, replacement);
fs.writeFileSync(mainFile, src);
console.log('[patch] Save sync successfully injected into', files[0]);
console.log('[patch] Matched pattern:', full.substring(0, 80));
