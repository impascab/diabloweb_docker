# DiabloWeb — Self-Hosted Docker Edition

> **⚠️ Vibe Coded Disclaimer**
> This entire project — every line of the Dockerfile, server code, overlay, nginx config, shell scripts, and build patches — was designed and written by [Claude](https://claude.ai) (Anthropic's AI assistant) through an iterative conversation.
> My contribution was the idea, testing, and feedback. 

A self-hosted Docker container that lets you play Diablo 1 in any browser on your home network, built on top of [d07RiV/diabloweb](https://github.com/d07RiV/diabloweb).
My goal was to continue playing the same D1 session from any web browser in my home without having to upload or select files.

**Upload your MPQ once → play from any computer on your network forever.**

---

## What this adds on top of diabloweb

| Feature | Detail |
|---|---|
| 🐳 Docker container | One build, runs forever on Unraid or any Linux server |
| 📦 MPQ persistence | Upload DIABDAT.MPQ once, stored on server, auto-loaded on every browser |
| 🖥️ Any computer | Second/third computer on your LAN gets the MPQ automatically — no file needed |
| 💾 Save file sync | Upload DevilutionX `.sv` saves, synced to all browsers |
| 🔧 HTTP compatible | Works over plain HTTP (no HTTPS/reverse proxy needed) via SharedArrayBuffer polyfill |
| 🏥 Health checks | Docker/Unraid shows real container health status |

---

## Requirements

- Unraid (or any Linux machine with Docker)
- A copy of `DIABDAT.MPQ` from the original Diablo game (GoG or CD)
- Or `spawn.mpq` for the free shareware version (Act 1 only)

---

## Installation on Unraid

### Step 1 — Get the files

Download the latest release zip from this repo and extract it to your Unraid server. Place the files at:

```
/mnt/cache/appdata/diabloweb-build/
```

You can do this via:
- **SMB share**: `\\UNRAID\cache\appdata\diabloweb-build\`
- **SSH + scp**: `scp -r diabloweb-build/ root@UNRAID-IP:/mnt/cache/appdata/`
- **Unraid file manager**: Files app in the Unraid top bar

### Step 2 — Build the Docker image (one time, ~5 minutes)

SSH into Unraid:

```bash
ssh root@YOUR-UNRAID-IP
chmod +x /mnt/cache/appdata/diabloweb-build/build-on-unraid.sh
docker build -t diabloweb:local /mnt/cache/appdata/diabloweb-build
```

You will see the build progress. When it finishes with `Successfully tagged diabloweb:local` you are ready.

### Step 3 — Add Container in Unraid GUI

Go to **Docker tab → Add Container** and fill in:

| Field | Value |
|---|---|
| Name | `diabloweb` |
| Repository | `diabloweb:local` |
| Network Type | `Bridge` |
| Restart Policy | `Unless Stopped` |

**Add a Port mapping:**

| Container Port | Host Port | Protocol |
|---|---|---|
| `8080` | `8666` | TCP |

**Add Path #1 — MPQ storage:**

| Field | Value |
|---|---|
| Container Path | `/data/mpq` |
| Host Path | `/mnt/cache/appdata/diabloweb/mpq` |

**Add Path #2 — Save file storage:**

| Field | Value |
|---|---|
| Container Path | `/data/saves` |
| Host Path | `/mnt/cache/appdata/diabloweb/saves` |

Click **Apply**.

### Step 4 — Play

Open `http://YOUR-UNRAID-IP:8666` in any browser on your network.

**First visit:**
1. Click **Choose DIABDAT.MPQ** and select your file
2. Optionally upload a DevilutionX `.sv` save file
3. Click **▶ Launch Diablo**
4. The page reloads and the game starts automatically

**Every visit after that** (any computer on your network): the game starts on its own — no file selection, no prompts.

---

## Getting DIABDAT.MPQ

| Source | Where to find it |
|---|---|
| **GoG** (recommended) | Buy at gog.com → install → `DIABDAT.MPQ` in the install folder |
| **Original CD** | Copy `DIABDAT.MPQ` directly from the disc |
| **Shareware** (free, Act 1 only) | Use `spawn.mpq` from the original shareware release |

---

## DevilutionX save files

Save files from [DevilutionX](https://github.com/diasurgical/devilutionX) are fully compatible.

| Platform | Save location |
|---|---|
| Windows | `%APPDATA%\diasurgical\devilution\` |
| macOS | `~/Library/Application Support/diasurgical/devilution/` |
| Linux | `~/.local/share/diasurgical/devilution/` |
| iOS | Files app → On My iPhone → DevilutionX |
| Android | `Android/data/org.diasurgical.devilution/files/` |

---

## Build patches applied

The Dockerfile applies these patches to the diabloweb source at build time:

| Patch | Reason |
|---|---|
| `node-sass` → `sass` (Dart Sass) | `node-sass` cannot compile on Alpine Linux with Python 3.12+ (distutils removed) |
| `peerjs` pinned to `1.0.2` | Newer `peerjs 1.5.x` uses private class fields (`#_`) that webpack 4 cannot parse |
| `homepage` set to `"."` | Original points to GitHub Pages path, breaking self-hosted asset loading |
| `componentDidMount` auto-start | Patches diabloweb to auto-start when MPQ is found in IndexedDB |
| SharedArrayBuffer polyfill | Enables WebAssembly threading over plain HTTP without HTTPS |

---

## Architecture

```
Browser
  └── http://UNRAID-IP:8666
        └── nginx (port 8080 in container)
              ├── /              → serves CRA build (diabloweb game)
              ├── /api/*         → proxied to Node.js API (port 3000)
              └── /static/*      → cached game assets
                    
Node.js API (api-server.js)
  ├── GET  /api/status           → check if MPQ/saves exist on server
  ├── POST /api/upload/mpq       → receive and store MPQ file
  ├── POST /api/upload/save      → receive and store save file  
  ├── GET  /api/serve/:file      → serve stored MPQ/save to browser
  └── GET  /api/saves/:name      → download a save file

Persistent storage (host volume)
  ├── /data/mpq/DIABDAT.MPQ      → stored MPQ (survives container rebuilds)
  └── /data/saves/*.sv           → stored save files
```

---

## Updating

```bash
docker build --no-cache -t diabloweb:local /mnt/cache/appdata/diabloweb-build
```

Then stop and restart the container in Unraid. Your MPQ and saves are on the host volume and are never affected by rebuilds.

---

## Credits

- **[d07RiV](https://github.com/d07RiV)** — original [diabloweb](https://github.com/d07RiV/diabloweb) project
- **[GalaXyHaXz](https://github.com/GalaXyHaXz) and the [devilution team](https://github.com/diasurgical/devilution)** — Diablo source reconstruction
- **[Claude](https://claude.ai) by Anthropic** — wrote all the Docker/server/overlay code in this repo through AI-assisted development
- **Blizzard Entertainment** — original Diablo game (you need a legal copy of DIABDAT.MPQ)

---

## License

The self-hosting wrapper code in this repository (Dockerfile, api-server.js, nginx.conf, overlay scripts, etc.) is MIT licensed.

The diabloweb game engine is subject to its own license — see [d07RiV/diabloweb](https://github.com/d07RiV/diabloweb).

Diablo itself is © Blizzard Entertainment. You must own a legal copy of the game.
