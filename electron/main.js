'use strict';

/**
 * Electron shell for pi-gui.
 *
 * Starts the local pi-gui server on a free port (the server prints a
 * `__PI_GUI_READY__ {…}` handshake on stdout), then shows it in a window.
 *
 *   npm run desktop                 # cwd = current directory
 *   npm run desktop -- --cwd ~/proj # pi runs in another directory
 *   npm run desktop -- -- --no-session   # after -- is forwarded to pi
 */

const { app, BrowserWindow, Menu, dialog, shell, nativeTheme, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const out = { cwd: process.cwd(), piArgs: [] };
  const sep = argv.indexOf('--');
  const own = sep === -1 ? argv : argv.slice(0, sep);
  out.piArgs = sep === -1 ? [] : argv.slice(sep + 1);
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    if (a === '--cwd' && own[i + 1]) out.cwd = path.resolve(own[++i]);
    else if (a.startsWith('--cwd=')) out.cwd = path.resolve(a.slice(6));
  }
  return out;
}

const cli = parseArgs(process.argv.slice(2));

/* --------------------------------------------------------------- window */

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    if (s && s.width > 400 && s.height > 300) return s;
  } catch {}
  return { width: 1380, height: 900 };
}

function saveState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {}
}

const LOADING_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { color-scheme: light dark; }
  body { margin:0; height:100vh; display:flex; flex-direction:column; gap:16px;
         align-items:center; justify-content:center;
         font:14px "Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         background:#f5f6f8; color:#24292f; }
  @media (prefers-color-scheme: dark) { body { background:#0f1115; color:#e6e8eb; } }
  .logo { display:flex;align-items:center;justify-content:center;width:56px;height:56px;
          font-size:28px;font-weight:600;background:rgba(79,107,237,.12);color:#4f6bed;
          border-radius:14px }
  @media (prefers-color-scheme: dark) { .logo { background:rgba(138,164,255,.16);color:#8aa4ff } }
  .msg { opacity:.7 }
  .err { color:#d1242f; max-width:70%; text-align:center; white-space:pre-wrap }
  .spin { width:18px;height:18px;border-radius:50%;border:2px solid currentColor;
          border-top-color:transparent;animation:s .8s linear infinite; opacity:.45 }
  @keyframes s { to { transform: rotate(360deg) } }
</style></head><body>
  <div class="logo">π</div>
  <div class="spin"></div>
  <div class="msg" id="msg">starting pi…</div>
  <div class="err" id="err"></div>
</body></html>`;

let win = null;
let server = null;
let serverUrl = null;
let restarting = false;

function createWindow() {
  const state = loadState();
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 720,
    minHeight: 480,
    title: 'π GUI',
    // Native window chrome: no title bar of our own, and let the sidebar show the
    // system material. The page goes transparent behind it (html.is-electron).
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'followWindow' : undefined,
    backgroundColor: isMac ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f5f6f8',
    transparent: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveState(win));
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML));
}

function loadingError(message) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(
    `(() => { const m=document.getElementById('msg'); if(m) m.textContent='failed to start'; const e=document.getElementById('err'); if(e) e.textContent=${JSON.stringify(
      message,
    )}; })()`,
  );
}

/* --------------------------------------------------------------- server */

/**
 * Environment for the Node server child process.
 * - A GUI app launched from Finder gets a minimal PATH, so add the usual places
 *   `pi` and `git` live.
 * - Traces must go somewhere writable; inside an app bundle that is userData.
 */
function childEnv() {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const extra = [
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), 'bin'),
  ];
  const parts = String(env.PATH || '').split(':').filter(Boolean);
  for (const p of extra) if (!parts.includes(p) && fs.existsSync(p)) parts.push(p);
  env.PATH = parts.join(':');
  if (app.isPackaged) env.PI_GUI_TRACE_DIR = path.join(app.getPath('userData'), 'traces');
  return env;
}

function startServer(cwd) {
  return new Promise((resolve, reject) => {
    const args = [SERVER, '--port', '0', '--cwd', cwd];
    if (cli.piArgs.length) args.push('--', ...cli.piArgs);

    server = spawn(process.execPath, args, {
      cwd: ROOT,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('server did not become ready within 20s'));
      }
    }, 20000);

    server.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.startsWith('__PI_GUI_READY__ ')) {
          try {
            const info = JSON.parse(line.slice('__PI_GUI_READY__ '.length));
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(info);
            }
          } catch {}
        } else if (line.trim()) {
          console.log('[pi-gui]', line);
        }
      }
    });

    server.stderr.on('data', (chunk) => process.stderr.write(chunk));

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    server.on('exit', (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`server exited early (code=${code} signal=${signal})`));
        return;
      }
      server = null;
      if (!restarting && code !== 0 && code !== null) {
        loadingError(`pi-gui server exited (code=${code} signal=${signal})`);
      }
    });
  });
}

async function launch(cwd) {
  try {
    const info = await startServer(cwd);
    serverUrl = info.url;
    if (win && !win.isDestroyed()) win.loadURL(info.url);
  } catch (err) {
    loadingError(String(err && err.message ? err.message : err));
  }
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    server = null;
    s.once('exit', () => resolve());
    s.kill('SIGTERM');
    setTimeout(() => {
      try {
        s.kill('SIGKILL');
      } catch {}
      resolve();
    }, 1500);
  });
}

async function restartAll(cwd) {
  restarting = true;
  await stopServer();
  restarting = false;
  cli.cwd = cwd;
  if (win && !win.isDestroyed()) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML));
  await launch(cwd);
}

/* ------------------------------------------------------------------ theme */

// The page is transparent in Electron (so the sidebar can show the system
// material), which means the native window background has to match the app
// theme or a light page renders on a dark window.
let lastThemeMode = 'system';

function applyWindowTheme(mode) {
  lastThemeMode = mode === 'light' || mode === 'dark' ? mode : 'system';
  if (!win || win.isDestroyed()) return;
  const dark = lastThemeMode === 'dark' || (lastThemeMode === 'system' && nativeTheme.shouldUseDarkColors);
  try {
    win.setBackgroundColor(dark ? '#0f1115' : '#f5f6f8');
  } catch {}
  if (process.platform === 'darwin') {
    try {
      win.setVibrancy(dark ? 'sidebar' : null);
    } catch {}
  }
}

ipcMain.on('pi-gui:set-theme', (_event, mode) => applyWindowTheme(mode));

/* ------------------------------------------------------------------ menu */

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const r = await dialog.showOpenDialog(win, {
              title: 'Choose the folder pi should work in',
              defaultPath: cli.cwd,
              properties: ['openDirectory', 'createDirectory'],
            });
            if (!r.canceled && r.filePaths[0]) await restartAll(r.filePaths[0]);
          },
        },
        {
          label: 'Restart pi',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: async () => {
            try {
              await fetch(`${serverUrl}api/restart`, { method: 'POST' });
            } catch {}
          },
        },
        { type: 'separator' },
        { label: 'Reveal Working Folder', click: () => shell.openPath(cli.cwd) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'editMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'pi documentation', click: () => shell.openExternal('https://pi.dev') },
        {
          label: 'Open README',
          click: () => shell.openPath(path.join(ROOT, 'README.md')),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ----------------------------------------------------------------- boot */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    createWindow();
    await launch(cli.cwd);
    nativeTheme.on('updated', () => {
      applyWindowTheme(lastThemeMode);
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (serverUrl) win.loadURL(serverUrl);
      else launch(cli.cwd);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', async (ev) => {
    if (server) {
      ev.preventDefault();
      await stopServer();
      app.quit();
    }
  });
}
