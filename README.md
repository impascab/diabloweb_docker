# Diablo Web — Self-Hosted on Unraid (no Docker Compose needed)

Play Diablo 1 in any browser on your home network.  
MPQ and saves live at `/mnt/cache/appdata/diabloweb/` and survive every rebuild.

---

## Step 1 — Copy files to Unraid

Transfer this entire folder to your Unraid server. Easiest ways:
- **Unraid's built-in file manager** (Files app in the top bar) → navigate to `/mnt/cache/appdata/` → upload the zip and extract
- **From another computer on your network** via SMB: `\\UNRAID\appdata\` → paste the folder there
- **SSH + scp** from your computer:
  ```bash
  scp -r diabloweb-docker/ root@UNRAID-IP:/mnt/cache/appdata/diabloweb-build/
  ```

---

## Step 2 — Build the image (one-time, via SSH)

SSH into Unraid:
```bash
ssh root@YOUR-UNRAID-IP
```

Then run the build script (replace the path with wherever you put the files):
```bash
bash /mnt/cache/appdata/diabloweb-build/build-on-unraid.sh
```

This takes about **5 minutes** — it clones the diabloweb repo, compiles the WebAssembly game, and creates a local Docker image called `diabloweb:local`.

You only ever need to do this once (or when you want to update the game).

---

## Step 3 — Add Container in Unraid GUI

Go to **Unraid WebUI → Docker tab → Add Container** (or the "+" button).

Fill in these fields exactly:

| Field | Value |
|---|---|
| **Name** | `diabloweb` |
| **Repository** | `diabloweb:local` |
| **Network Type** | `Bridge` |
| **Console shell command** | `Shell` |
| **Restart policy** | `Unless Stopped` |

### Port Mapping
Click **Add another Path, Port, Variable, Label or Device** → Port:

| Field | Value |
|---|---|
| Name | `WebUI` |
| Container Port | `8080` |
| Host Port | `8666` |
| Protocol | `TCP` |

### Volume 1 — MPQ files
Click **Add** → Path:

| Field | Value |
|---|---|
| Name | `MPQ` |
| Container Path | `/data/mpq` |
| Host Path | `/mnt/cache/appdata/diabloweb/mpq` |
| Access Mode | `Read/Write` |

### Volume 2 — Save files
Click **Add** → Path:

| Field | Value |
|---|---|
| Name | `Saves` |
| Container Path | `/data/saves` |
| Host Path | `/mnt/cache/appdata/diabloweb/saves` |
| Access Mode | `Read/Write` |

Click **Apply** — Unraid will start the container.

---

## Step 4 — Play!

Open **`http://YOUR-UNRAID-IP:8666`** in any browser on your network.

**First visit:**
1. Upload `DIABDAT.MPQ` (full GoG game) or `spawn.mpq` (free shareware/demo)
2. Optionally upload a `.sv` save file from DevilutionX
3. Click **▶ Launch Diablo**

**Every visit after that:** Goes straight to the game — no re-upload, no prompts.

---

## Pause / Resume

- **⏸ Pause button** — always visible in the top-right corner of the game
- **F9 keyboard shortcut** — works too
- Dims the screen and suspends the game loop

---

## Getting DIABDAT.MPQ

| Source | Where to find it |
|---|---|
| **GoG** (recommended) | Buy at gog.com → install → `DIABDAT.MPQ` is in the install folder |
| **Original CD** | Copy `DIABDAT.MPQ` from the disc |
| **Shareware** (free, Act 1 only) | Use `spawn.mpq` — get it from the [live demo](https://d07riv.github.io/diabloweb/) via DevTools Network tab |

---

## DevilutionX save files (.sv)

| Platform | Save file location |
|---|---|
| Windows | `%APPDATA%\diasurgical\devilution\` |
| macOS | `~/Library/Application Support/diasurgical/devilution/` |
| Linux | `~/.local/share/diasurgical/devilution/` |
| iOS | Files app → On My iPhone → DevilutionX |
| Android | `Android/data/org.diasurgical.devilution/files/` |

Upload the `.sv` file on the setup screen. It's stored at `/mnt/cache/appdata/diabloweb/saves/` on your server.

---

## Updating the game

If a new version of diabloweb is released:

```bash
ssh root@YOUR-UNRAID-IP
cd /mnt/cache/appdata/diabloweb-build
git pull   # if you cloned, or re-copy the files
docker build --no-cache -t diabloweb:local .
```

Then in Unraid GUI → Docker → click the container → **Restart**.  
Your MPQ and saves are untouched.

---

## If you use a reverse proxy (Nginx Proxy Manager, Swag, etc.)

Add these headers to your proxy config — they're required for the WebAssembly game to run:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these, the game will fail to load with a SharedArrayBuffer error.

---

## Troubleshooting

**"Image not found" in Unraid GUI**  
Make sure you ran `build-on-unraid.sh` first and it completed without errors. Verify with:
```bash
docker images | grep diabloweb
```

**Blank screen after launching**  
Open browser DevTools (F12) → Console. If you see SharedArrayBuffer errors, your reverse proxy is missing the COOP/COEP headers above.

**MPQ upload stuck / fails**  
`DIABDAT.MPQ` is ~700 MB. Use a wired connection if possible. The progress bar shows real upload progress.

**Save file not loading in-game**  
The web version stores active saves in browser localStorage. The `.sv` upload is for backup/migration. Once uploaded to the server, load your hero from the in-game "Load Game" menu.
