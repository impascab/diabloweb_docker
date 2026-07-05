# ── Stage 1: Build diabloweb ──────────────────────────────────────────────────
FROM node:18-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build

RUN git clone https://github.com/d07RiV/diabloweb.git .

# Three package.json fixes before install:
# 1. node-sass → sass (Dart Sass): node-sass can't compile on Alpine/Python 3.12+
# 2. peerjs pinned to 1.0.2: newer 1.x uses private class fields webpack 4 can't parse
# 3. homepage → ".": original points to GitHub Pages path, breaks self-hosting
RUN sed -i \
      -e 's/"node-sass": *"[^"]*"/"sass": "^1.62.0"/' \
      -e 's/"peerjs": *"[^"]*"/"peerjs": "1.0.2"/' \
      -e 's|"homepage": *"[^"]*"|"homepage": "."|' \
      package.json

RUN npm install --legacy-peer-deps

# sass-loader 7.x hardcodes require('node-sass') — shim it to use sass instead
RUN mkdir -p node_modules/node-sass && \
    echo '{"name":"node-sass","version":"9.0.0","main":"index.js"}' \
      > node_modules/node-sass/package.json && \
    echo 'module.exports = require("sass");' \
      > node_modules/node-sass/index.js

# Patch App.js to auto-start the game when MPQ is found in IndexedDB.
# The original componentDidMount only checks for spawn.mpq to show a button;
# it never auto-starts. We add an auto-start call after the IDB check so that
# when the page loads and the MPQ is already in IDB, the game starts immediately
# without requiring any user interaction.
RUN sed -i 's/this\.fs\.then(fs => {/this.fs.then(fs => { const diabdat = fs.files.get("diabdat.mpq"); if (diabdat) { this.start(new File([diabdat], "diabdat.mpq")); return; }/' src/App.js

# CI=false     → deprecation warnings don't abort the build
# NODE_OPTIONS → webpack 4 needs legacy OpenSSL provider on Node 17+
RUN CI=false NODE_OPTIONS=--openssl-legacy-provider npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:18-alpine

RUN apk add --no-cache nginx netcat-openbsd

RUN mkdir -p /app /data/mpq /data/saves

COPY --from=builder /build/build    /usr/share/nginx/html
COPY overlay/diablo-manager.js      /usr/share/nginx/html/diablo-manager.js
COPY coi-serviceworker.js           /usr/share/nginx/html/coi-serviceworker.js
COPY coi-register.js                /usr/share/nginx/html/coi-register.js
COPY sab-polyfill.js                /usr/share/nginx/html/sab-polyfill.js
COPY overlay/inject.sh              /inject.sh
COPY nginx.conf                     /etc/nginx/http.d/default.conf
COPY api-server.js                  /app/api-server.js
COPY entrypoint.sh                  /entrypoint.sh

RUN chmod +x /inject.sh /entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O- http://localhost:8080/api/status 2>/dev/null | grep -q 'mpqFull' || exit 1

ENTRYPOINT ["/entrypoint.sh"]
