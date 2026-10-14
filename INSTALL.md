# Installing PiStudio

PiStudio is a GUI for [pi](https://pi.dev). It has two pieces:

- **the Node server** (`server.js`) — serves the web UI and bridges it to a
  `pi --mode rpc` child process;
- **the shell** — either a browser tab or an optional Electron desktop window.

PiStudio does **not** bundle `pi`; it spawns the `pi` already on your `PATH`.

---

## 1. Prerequisites

| Requirement | Why | Check |
|---|---|---|
| **Node.js ≥ 20** | runs the server and the launcher | `node -v` |
| **`pi` CLI** | the agent PiStudio drives | `pi --version` |
| A configured model provider | so `pi` can answer | `pi` (run once interactively) |

Install `pi` and sign in once so it has credentials:

```bash
npm install -g @earendil-works/pi-coding-agent
pi            # complete setup, then quit
```

## 2. Install from npm (recommended)

```bash
npm install -g pistudio
```

This puts two identical commands on your `PATH`: **`pistudio`** and its alias
**`pigui`**.

```bash
cd ~/my-project
pistudio              # desktop window (falls back to the browser)
pistudio --web        # force the browser UI
pistudio --cwd ~/proj # run pi in another directory
pistudio --help
```

Notes:

- `pistudio` runs **pi in the current directory**, so `cd` into your project
  first (or pass `--cwd`).
- The npm package ships the prebuilt web UI. The **desktop window** additionally
  needs Electron, which is not installed by the global package — the command
  detects this and opens the browser instead. For the native window see
  *Run from source* below or build the macOS app.

### Update / uninstall

```bash
npm update -g pistudio
npm uninstall -g pistudio
```

## 3. Run from source

Use this for the desktop (Electron) shell, development, or if you want the
latest `main`:

```bash
git clone https://github.com/AlexZhangUPUPUP/PI-GUI.git pistudio
cd pistudio
npm install            # installs the frontend + Electron
npm run link           # optional: symlink pistudio/pigui into ~/.local/bin
```

Then:

```bash
npm run build          # build the frontend into dist/ (once)
pistudio               # desktop window (uses the local Electron)
pistudio --web         # browser UI
./start.sh             # server only, no launcher
./start-desktop.sh     # Electron directly
```

`npm run link` requires `~/.local/bin` to be on your `PATH` (it usually is on
macOS). Remove the links with `npm run unlink`.

## 4. macOS app bundle

Build a double-clickable `.app` (and `.dmg`):

```bash
npm install
npm run package        # → release/PiStudio-darwin-<arch>/PiStudio.app
```

The bundle is **ad-hoc signed only**. macOS may still quarantine it; clear the
flag once:

```bash
xattr -dr com.apple.quarantine "release/PiStudio-darwin-arm64/PiStudio.app"
```

The packaged app remembers the last working folder (`userData/cwd.json`) and
falls back to your home directory, so double-clicking is useful.

## 5. Troubleshooting

**`pistudio: command not found`** — the global npm bin directory is not on your
`PATH`. Find it with `npm bin -g` (or `npm config get prefix`) and add its `bin`
subdirectory to `PATH`.

**"pi not found" / the window shows a spawn error** — install the `pi` CLI
(section 1) and make sure `pi --version` works in the same shell. The macOS app
adds `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` to `PATH` for this
reason.

**`npm install` stalls downloading Electron** — the repo's `.npmrc` points at the
npmmirror mirror. Delete `.npmrc` (or set `ELECTRON_MIRROR`) if your network
reaches GitHub directly:

```bash
ELECTRON_MIRROR=https://github.com/electron/electron/releases/download/ npm install
```

**Blank window / old UI** — rebuild the frontend: `npm run build`.

**Port already in use** — pick another: `pistudio --web -- --port 5180`, or let
the desktop shell choose one automatically (it uses `--port 0`).
