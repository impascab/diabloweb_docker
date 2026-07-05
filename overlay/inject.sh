#!/bin/sh
# Injects scripts into index.html. Idempotent.
INDEX=/usr/share/nginx/html/index.html

if grep -q 'sab-polyfill.js' "$INDEX"; then
  echo "[inject] Already injected, skipping."
else
  # 1. SharedArrayBuffer polyfill — absolute first, restores SAB on HTTP
  # 2. COI service worker registration — enables crossOriginIsolated where supported
  # 3. Our overlay manager — before </body>
  sed -i \
    -e 's|<head>|<head><script src="/sab-polyfill.js"></script><script src="/coi-register.js"></script>|' \
    -e 's|</body>|<script src="/diablo-manager.js"></script></body>|' \
    "$INDEX"

  echo "[inject] Injected sab-polyfill.js, coi-register.js and diablo-manager.js"
fi
