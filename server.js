#!/usr/bin/env node
'use strict';

/**
 * PiStudio — a tiny zero-dependency web GUI for pi.
 *
 * Spawns `pi --mode rpc` as a child process and exposes it to the browser.
 * Each browser tab gets its own pi process, keyed by the `c` query parameter
 * (the client keeps its id in sessionStorage, so a reload stays on the same
 * session and a new tab starts an independent one).
 *
 *   GET  /                     -> index.html
 *   GET  /api/events?c=<id>    -> Server-Sent Events stream for that session
 *   POST /api/command?c=<id>   -> forward a raw RPC command to that pi
 *   GET  /api/info?c=<id>      -> cwd / pid / alive / trace file
 *   GET  /api/diagnostics?c=   -> self-check counters
 *   POST /api/restart?c=<id>   -> restart that pi subprocess
 *   GET  /api/files?q=&limit=  -> project file index for @-completion
 *   GET  /api/traces           -> list persisted trace files
 *   GET  /api/trace?c=&file=   -> read a trace (that session's run by default)
 *   POST /api/trace/marker?c=  -> append a marker to that session's trace
 *   GET  /api/sessions         -> saved pi sessions for the cwd
 *   POST /api/session/delete   -> delete a saved session file
 *   GET  /api/search?q=        -> full-text search across saved sessions
 *   GET  /api/changes?c=       -> working-tree changes (git) + per-file diff
 *   POST /api/changes/revert   -> back up and revert one file
 *
 * Usage:
 *   node server.js [--port 4173] [--host 127.0.0.1] [--cwd DIR] [--pi /path/to/pi] [-- <pi args>]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { StringDecoder } = require('string_decoder');

// ---------------------------------------------------------------- options

const argv = process.argv.slice(2);
function opt(name, fallback) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
}

const SEP = argv.indexOf('--');
const PI_ARGS = SEP === -1 ? [] : argv.slice(SEP + 1);

const PORT = Number(opt('port', process.env.PORT || 4173));
const HOST = opt('host', '127.0.0.1');
const CWD = path.resolve(opt('cwd', process.env.PI_GUI_CWD || process.cwd()));
const PI_BIN = opt('pi', process.env.PI_BIN || 'pi');
// The React UI is built by Vite into dist/. The original vanilla frontend was
// retired; it lives in legacy/vanilla-ui/ for reference only.
const PUBLIC_DIR = path.join(__dirname, 'dist');
if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  process.stderr.write('[pistudio] dist/index.html not found — run `npm run build` first\n');
}
const TRACE_DIR = path.resolve(opt('trace-dir', process.env.PI_GUI_TRACE_DIR || path.join(__dirname, 'traces')));
const MAX_BUFFER = 20000; // hard count cap
const MAX_BUFFER_BYTES = 8 * 1024 * 1024; // per session, trace events
const INSPECT_MAX_BYTES = 4 * 1024 * 1024; // per session, inspector records
const INSPECT_MAX_RECORD = 512 * 1024;
const TRACE_KEEP = Math.max(1, Number(opt('trace-keep', process.env.PI_GUI_TRACE_KEEP || 30)));
const SESSIONS_ROOT = path.join(require('os').homedir(), '.pi', 'agent', 'sessions');
const GUI_EXTENSION = path.join(__dirname, 'extensions', 'gui-bridge.ts');
const INSPECTOR_EXTENSION = path.join(__dirname, 'extensions', 'inspector.ts');
const NO_GUI_EXTENSION = argv.includes('--no-gui-extension');
const NO_INSPECTOR = argv.includes('--no-inspector');
// runtime-toggleable from the GUI (see /api/extensions/toggle)
let guiBridgeDisabled = NO_GUI_EXTENSION;
let inspectorDisabled = NO_INSPECTOR;
const INSPECT_KEEP = 400;
const SESSION_IDLE_MS = Math.max(60_000, Number(opt('session-idle', process.env.PI_GUI_SESSION_IDLE || 10 * 60_000)));

const IS_LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1' || HOST === '[::1]';
const TOKEN = opt('token', process.env.PI_GUI_TOKEN || '');
/** Binding beyond loopback exposes a shell-capable agent, so require a token. */
const AUTH_TOKEN = TOKEN || (IS_LOOPBACK ? '' : require('crypto').randomBytes(16).toString('hex'));

fs.mkdirSync(TRACE_DIR, { recursive: true });

// ------------------------------------------------------------ file index

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.next',
  '.turbo',
  'coverage',
  '.idea',
  '.vscode',
  'vendor',
  'Pods',
]);

let fileCache = { at: 0, cwd: null, files: [] };

/** All files under CWD. git first (respects .gitignore, fast), else a bounded walk. */
function listFiles() {
  const now = Date.now();
  if (fileCache.cwd === CWD && now - fileCache.at < 5000) return fileCache.files;

  let files = [];
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: CWD,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    files = out.toString('utf8').split('\0').filter(Boolean);
  } catch {
    const walk = (dir, prefix, depth) => {
      if (depth > 8 || files.length > 50000) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), rel, depth + 1);
        else files.push(rel);
      }
    };
    walk(CWD, '', 0);
  }

  files.sort();
  fileCache = { at: now, cwd: CWD, files };
  return files;
}

function searchFiles(query, limit) {
  const files = listFiles();
  const q = String(query || '').toLowerCase();
  if (!q) return files.slice(0, limit);

  const scored = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    let score = -1;
    if (base.startsWith(q)) score = 0;
    else if (lower.startsWith(q)) score = 1;
    else if (base.includes(q)) score = 2;
    else if (lower.includes(q)) score = 3;
    if (score >= 0) scored.push({ f, score });
  }
  scored.sort((a, b) => a.score - b.score || a.f.length - b.f.length || a.f.localeCompare(b.f));
  return scored.slice(0, limit).map((s) => s.f);
}

// ---------------------------------------------------------------- trace

function pruneTraces() {
  try {
    const files = fs
      .readdirSync(TRACE_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, at: fs.statSync(path.join(TRACE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const { f } of files.slice(TRACE_KEEP)) {
      try {
        fs.unlinkSync(path.join(TRACE_DIR, f));
      } catch {}
    }
  } catch {}
}

/** Revert backups are a safety net, not an archive — keep the newest few. */
function pruneRevertDirs(keep = 20) {
  try {
    const dirs = fs
      .readdirSync(TRACE_DIR)
      .filter((f) => f.startsWith('revert-'))
      .map((f) => ({ f, at: fs.statSync(path.join(TRACE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const { f } of dirs.slice(keep)) {
      try {
        fs.rmSync(path.join(TRACE_DIR, f), { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

function readTraceRecords(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

// ------------------------------------------------------------- pi sessions

/** @type {Map<string, any>} */
const sessions = new Map();

function createSession(id) {
  const sess = {
    id,
    child: null,
    alive: false,
    clients: new Set(),
    seq: 0,
    buffer: [],
    traceFile: null,
    traceStream: null,
    runStartedAt: 0,
    lastCommand: null,
    lastEvent: null,
    pendingDialogs: new Map(),
    agents: new Map(),
    inspect: [],
    inspectSizes: [],
    inspectBytes: 0,
    bufferSizes: [],
    bufferBytes: 0,
    lastSeen: Date.now(),
  };
  sessions.set(id, sess);
  startPi(sess);
  return sess;
}

function peekSession(id) {
  return sessions.get(id) || null;
}

/** Sessions are created (and their pi started) on first real use. */
function ensureSession(id) {
  const sess = sessions.get(id);
  if (sess) {
    sess.lastSeen = Date.now();
    if (!sess.alive && !sess.child) startPi(sess);
    return sess;
  }
  return createSession(id);
}

function newTraceFile(sess) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  sess.traceFile = path.join(TRACE_DIR, `run-${stamp}.jsonl`);
  try {
    sess.traceStream = fs.createWriteStream(sess.traceFile, { flags: 'a' });
  } catch (err) {
    process.stderr.write(`[pistudio] cannot open trace file: ${err.message}\n`);
    sess.traceStream = null;
  }
  pruneTraces();
  pruneRevertDirs();
  sess.buffer = [];
  sess.seq = 0;
  sess.runStartedAt = Date.now();
  return sess.traceFile;
}

function record(sess, evt) {
  sess.seq += 1;
  const rec = { seq: sess.seq, t: Date.now(), evt };
  let line = '';
  try {
    line = JSON.stringify(rec);
  } catch {}
  sess.buffer.push(rec);
  sess.bufferSizes.push(line.length);
  sess.bufferBytes += line.length;
  // newest is always kept; older records go once the session exceeds its budget
  while (sess.buffer.length > 200 && (sess.buffer.length > MAX_BUFFER || sess.bufferBytes > MAX_BUFFER_BYTES)) {
    sess.buffer.shift();
    sess.bufferBytes -= sess.bufferSizes.shift() || 0;
  }
  if (sess.traceStream && line) {
    try {
      sess.traceStream.write(line + '\n');
    } catch {}
  }
  return rec;
}

function broadcast(sess, obj) {
  trackDialog(sess, obj);
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sess.clients) {
    try {
      res.write(payload);
    } catch {
      /* client gone; cleaned up on close */
    }
  }
}

/** Record + fan out a server-generated event for one session. */
function emit(sess, obj) {
  try {
    for (const rel of toolPaths(obj)) noteChange(sess, rel, obj);
  } catch {
    /* change tracking must never break the stream */
  }
  const rec = record(sess, obj);
  sess.lastEvent = { type: obj.type, at: rec.t };
  broadcast(sess, { ...obj, __seq: rec.seq, __t: rec.t });
  return rec;
}

function attachJsonlReader(stream, onLine) {
  const decoder = new StringDecoder('utf8');
  let buf = '';
  stream.on('data', (chunk) => {
    buf += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    for (;;) {
      const nl = buf.indexOf('\n');
      if (nl === -1) break;
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length) onLine(line);
    }
  });
  stream.on('end', () => {
    buf += decoder.end();
    if (buf.length) onLine(buf.endsWith('\r') ? buf.slice(0, -1) : buf);
  });
}

function startPi(sess) {
  if (sess.child) return;
  newTraceFile(sess);
  process.stderr.write(`[pistudio] session ${sess.id}: spawn ${PI_BIN} --mode rpc ${PI_ARGS.join(' ')} (cwd: ${CWD})\n`);
  process.stderr.write(`[pistudio] session ${sess.id}: trace ${sess.traceFile}\n`);

  const launchArgs = ['--mode', 'rpc'];
  if (!guiBridgeDisabled && fs.existsSync(GUI_EXTENSION)) launchArgs.push('--extension', GUI_EXTENSION);
  if (!inspectorDisabled && fs.existsSync(INSPECTOR_EXTENSION)) launchArgs.push('--extension', INSPECTOR_EXTENSION);
  launchArgs.push(...PI_ARGS);

  sess.child = spawn(PI_BIN, launchArgs, {
    cwd: CWD,
    env: { ...process.env, PI_GUI_URL: serverUrl, PI_GUI_SESSION: sess.id },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  sess.alive = true;
  sess.agents = new Map();
  ensureAgent(sess, { pid: sess.child.pid, child: false });

  emit(sess, {
    type: '__proc',
    status: 'started',
    pid: sess.child.pid,
    cwd: CWD,
    piBin: PI_BIN,
    traceFile: sess.traceFile,
  });

  attachJsonlReader(sess.child.stdout, (line) => {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      emit(sess, { type: '__raw', stream: 'stdout', text: line });
      return;
    }
    emit(sess, evt);
  });

  attachJsonlReader(sess.child.stderr, (text) => {
    emit(sess, { type: '__stderr', text });
    process.stderr.write(`[pi ${sess.id}] ${text}\n`);
  });

  sess.child.on('error', (err) => {
    sess.alive = false;
    emit(sess, { type: '__proc', status: 'error', message: String(err && err.message ? err.message : err) });
  });

  sess.child.on('exit', (code, signal) => {
    sess.alive = false;
    sess.child = null;
    sess.pendingDialogs.clear();
    emit(sess, { type: '__proc', status: 'exit', code, signal });
    process.stderr.write(`[pistudio] session ${sess.id}: pi exited (code=${code} signal=${signal})\n`);
  });
}

function sendToPi(sess, cmd) {
  if (!sess.child || !sess.child.stdin.writable) return false;
  sess.child.stdin.write(JSON.stringify(cmd) + '\n');
  return true;
}

function stopPi(sess, callback) {
  const c = sess.child;
  if (!c) {
    sess.alive = false;
    return callback();
  }
  c.once('exit', () => callback());
  c.kill('SIGTERM');
  setTimeout(() => {
    if (sess.child === c) {
      try {
        c.kill('SIGKILL');
      } catch {}
    }
  }, 2000).unref?.();
}

/* ------------------------------------------------------- pending dialogs */

const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

/**
 * Extension UI requests are broadcast and only live in page memory, so a tab
 * that misses the response (offline, still loading, …) keeps a dead modal
 * forever. Track what is actually pending and hand it to every client on
 * connect so stale dialogs get pruned.
 */
function trackDialog(sess, obj) {
  if (obj.type === 'extension_ui_request' && obj.id && DIALOG_METHODS.has(obj.method)) {
    sess.pendingDialogs.set(obj.id, obj.timeout ? Date.now() + obj.timeout + 500 : Infinity);
  } else if (obj.type === 'extension_ui_response' && obj.id) {
    sess.pendingDialogs.delete(obj.id);
  } else if (obj.type === '__ui_response' && obj.response && obj.response.id) {
    sess.pendingDialogs.delete(obj.response.id);
  }
}

function liveDialogIds(sess) {
  const now = Date.now();
  for (const [id, exp] of sess.pendingDialogs) if (exp !== Infinity && exp < now) sess.pendingDialogs.delete(id);
  return [...sess.pendingDialogs.keys()];
}

/* ------------------------------------------------------------- inspector */

let serverUrl = '';

/**
 * Who is reporting? The server spawned the main pi itself, so that pid is the
 * main agent; everything else reporting for this session is a sub-agent (the
 * subagent tool spawns `pi --mode json`, which inherits PI_GUI_URL/SESSION and
 * picks up the inspector from ~/.pi/agent/extensions).
 */
function agentKeyFor(sess, info) {
  const pid = Number(info && info.pid) || 0;
  const mainPid = sess.child ? sess.child.pid : 0;
  if (!pid || (mainPid && pid === mainPid)) return 'main';
  return `pid:${pid}`;
}

function ensureAgent(sess, info) {
  const key = agentKeyFor(sess, info);
  let a = sess.agents.get(key);
  if (!a) {
    const ppid = Number(info && info.ppid) || 0;
    let parentKey = 'main';
    for (const [k, v] of sess.agents) if (v.pid && v.pid === ppid) parentKey = k;
    a = {
      key,
      pid: Number(info && info.pid) || (key === 'main' && sess.child ? sess.child.pid : null),
      parentKey,
      child: key !== 'main',
      task: (info && info.task) || null,
      model: (info && info.model) || null,
      startedAt: Date.now(),
      lastAt: Date.now(),
      count: 0,
    };
    sess.agents.set(key, a);
    broadcast(sess, { type: '__agent', event: 'start', agent: a });
  }
  a.lastAt = Date.now();
  if (info) {
    if (info.task && !a.task) a.task = info.task;
    if (info.model && !a.model) a.model = info.model;
  }
  return a;
}

function inspectFileFor(sess) {
  if (!sess.traceFile) return null;
  const base = path.basename(sess.traceFile).replace(/^run-/, 'inspect-');
  return path.join(path.dirname(sess.traceFile), base);
}

/**
 * Records captured by extensions/inspector.ts. Kept per session in memory for
 * the panel and appended to the trace directory so a reload can replay them.
 */
function addInspect(sess, rec) {
  const agent = ensureAgent(sess, rec.agent);
  agent.count += 1;
  const entry = { at: Number(rec.at) || Date.now(), kind: String(rec.kind), data: rec.data ?? null, agent: agent.key };
  let line = '';
  try {
    line = JSON.stringify(entry);
  } catch {}
  // one outsized record must not eat the whole budget
  if (line.length > INSPECT_MAX_RECORD) {
    entry.data = { truncated: true, bytes: line.length };
    try {
      line = JSON.stringify(entry);
    } catch {
      line = '';
    }
  }
  sess.inspect.push(entry);
  sess.inspectSizes.push(line.length);
  sess.inspectBytes += line.length;
  while (sess.inspect.length > 50 && (sess.inspect.length > INSPECT_KEEP || sess.inspectBytes > INSPECT_MAX_BYTES)) {
    sess.inspect.shift();
    sess.inspectBytes -= sess.inspectSizes.shift() || 0;
  }
  broadcast(sess, { type: '__inspect', kind: entry.kind, at: entry.at, data: entry.data, agent: agent.key });
  try {
    const file = inspectFileFor(sess);
    if (file && line) fs.appendFileSync(file, line + '\n');
  } catch {}
}

/* ---------------------------------------------------------- saved sessions */

function sessionsDir(cwd) {
  return path.join(SESSIONS_ROOT, '--' + cwd.replace(/^\/+/, '').replace(/\//g, '-') + '--');
}

/* ---------------------------------------------------- extensions (for GUI) */

/** Auto-discovered extensions in the global and project locations. */
function discoverExtensions() {
  const home = require('os').homedir();
  const roots = [
    { scope: 'global', dir: path.join(home, '.pi', 'agent', 'extensions') },
    { scope: 'project', dir: path.join(CWD, '.pi', 'extensions') },
  ];
  const out = [];
  for (const { scope, dir } of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      const link = e.isSymbolicLink();
      if (link) {
        try {
          const st = fs.statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {}
      }
      if (isFile && e.name.endsWith('.ts')) out.push({ scope, name: e.name, path: full, kind: 'file', link });
      else if (isDir) {
        const idx = path.join(full, 'index.ts');
        if (fs.existsSync(idx)) out.push({ scope, name: e.name, path: idx, kind: 'dir', link });
      }
    }
  }
  return out;
}

/** Extra extension/package paths declared in pi settings.json. */
function readSettingsExtras() {
  const home = require('os').homedir();
  const files = [
    path.join(home, '.pi', 'agent', 'settings.json'),
    path.join(CWD, '.pi', 'settings.json'),
  ];
  const extensions = [];
  const packages = [];
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(s.extensions)) extensions.push(...s.extensions);
      if (Array.isArray(s.packages)) packages.push(...s.packages);
    } catch {}
  }
  return { extensions, packages };
}

function readFirstChunk(file, maxBytes = 384 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function previewContent(content, max = 140) {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content))
    text = content
      .map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join(' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const summaryCache = new Map(); // path -> { key, summary }

/**
 * Titles come from the first user message, with the instruction wrapper stripped:
 * "Reply with exactly: PIPE OK" is a useful title, the prefix is not. Cheap,
 * local, no model call — and it makes a list of 100 sessions scannable.
 */
const TITLE_STRIP = [
  /^\s*(?:please\s+)?(?:reply|respond|answer|say|output|write|print)\s+(?:with\s+)?(?:exactly|only|just)\s*[:,-]?\s*/i,
  /^\s*(?:please\s+)?(?:use|call|run)\s+the\s+[\w-]+\s+(?:tool|command)\s*(?:on|with|to|for)?\s*[:,-]?\s*/i,
  /^\s*(?:please\s+)?(?:can you|could you|would you)\s+/i,
  /^\s*(?:please\s+)/i,
];

function deriveTitle(text, fallback) {
  let t = String(text || '');
  if (!t.trim()) return fallback || null;
  // drop fenced blocks and markdown noise before anything else
  t = t.replace(/\`\`\`[\s\S]*?\`\`\`/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\/[\w-]+\s*/, '');
  for (const re of TITLE_STRIP) t = t.replace(re, '');
  // "Use the read tool on package.json" -> "package.json"
  const colon = t.match(/^([^:：]{0,40})[:：]\s*(.+)$/);
  if (colon && /\b(?:reply|say|use|run|read|edit|write|list|check|find|explain|search|show|create|fix)\b/i.test(colon[1])) {
    t = colon[2];
  }
  t = t.replace(/^[\s\-–—:：,，.。]+/, '').replace(/\s+/g, ' ').trim();
  if (!t) return fallback || null;
  // first sentence, then a hard cap on a word boundary
  const sentence = t.split(/(?<=[.。!！?？])\s+/)[0] || t;
  const capped = sentence.length > 52 ? sentence.slice(0, 52).replace(/\s+\S*$/, '') + '…' : sentence;
  return capped || fallback || null;
}

/** Turns / tool calls / tokens / cost need the whole file — 33 MB of transcripts
 *  parse in ~85 ms, and the mtime:size cache makes it a one-off per change. */
function scanSessionUsage(file, stat) {
  const out = { turns: 0, toolCalls: 0, tokens: 0, cost: 0, firstUser: null, partial: false };
  const MAX = 8 * 1024 * 1024;
  let text = '';
  try {
    if (stat.size > MAX) {
      text = readFirstChunk(file, MAX);
      out.partial = true;
    } else {
      text = fs.readFileSync(file, 'utf8');
    }
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    if (!line) continue;
    // cheap pre-filter: only lines that can possibly carry what we count
    if (line.indexOf('"assistant"') === -1 && line.indexOf('"toolCall"') === -1 && line.indexOf('"user"') === -1) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const m = o.message;
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'user' && !out.firstUser) out.firstUser = previewContent(m.content, 400);
    if (m.role !== 'assistant') continue;
    out.turns += 1;
    const u = m.usage;
    if (u) {
      out.tokens += u.totalTokens || 0;
      out.cost += (u.cost && u.cost.total) || 0;
    }
    if (Array.isArray(m.content)) for (const c of m.content) if (c && c.type === 'toolCall') out.toolCalls += 1;
  }
  return out;
}

function readSessionSummary(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  const hit = summaryCache.get(file);
  if (hit && hit.key === key) return hit.summary;
  let text = '';
  try {
    text = readFirstChunk(file, 128 * 1024);
  } catch {
    return null;
  }
  let header = null;
  let name = null;
  let preview = null;
  let entries = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === 'session') {
      header = o;
      continue;
    }
    entries += 1;
    if (o.type === 'session_info' && o.name) name = o.name;
    if (!preview && o.type === 'message' && o.message && o.message.role === 'user') preview = previewContent(o.message.content);
  }
  const usage = scanSessionUsage(file, stat);
  const summary = {
    file: path.basename(file),
    path: file,
    id: header ? header.id : null,
    cwd: header ? header.cwd : null,
    name,
    preview,
    title: deriveTitle(usage.firstUser || preview, name || preview),
    turns: usage.turns,
    toolCalls: usage.toolCalls,
    tokens: usage.tokens,
    cost: usage.cost,
    counted: !usage.partial,
    entries,
    mtime: stat.mtimeMs,
    size: stat.size,
  };
  if (summaryCache.size > 800) summaryCache.clear();
  summaryCache.set(file, { key, summary });
  return summary;
}

/** Human label for a workspace directory: prefer the cwd its sessions record. */
function workspaceLabel(cwd, dir) {
  if (!cwd) return path.basename(dir) || dir;
  const home = require('os').homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home + path.sep)) return '~/' + path.relative(home, cwd);
  return cwd;
}

/**
 * Sessions across *every* workspace, not just the server's cwd — the sidebar is
 * useless if it hides the sessions you actually worked in yesterday.
 */
function listSessions({ scope = 'all', limit = 300 } = {}) {
  const here = sessionsDir(CWD);
  const dirs = [];
  try {
    for (const d of fs.readdirSync(SESSIONS_ROOT)) {
      const full = path.join(SESSIONS_ROOT, d);
      try {
        if (fs.statSync(full).isDirectory()) dirs.push(full);
      } catch {}
    }
  } catch {}
  if (!dirs.includes(here)) dirs.push(here);

  const wanted = scope === 'workspace' ? [here] : dirs;
  const sessions = [];
  for (const dir of wanted) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const summary = readSessionSummary(path.join(dir, n));
      if (!summary) continue;
      summary.workspace = summary.cwd || null;
      summary.workspaceLabel = workspaceLabel(summary.cwd, dir);
      summary.isCurrentWorkspace = dir === here;
      sessions.push(summary);
    }
  }
  sessions.sort((a, b) => b.mtime - a.mtime);
  const truncated = sessions.length > limit;
  const kept = truncated ? sessions.slice(0, limit) : sessions;

  const byWorkspace = new Map();
  for (const s of sessions) {
    const key = s.workspace || s.workspaceLabel;
    const cur = byWorkspace.get(key) || { cwd: s.workspace, label: s.workspaceLabel, dir: path.dirname(s.path), count: 0, isCurrent: s.isCurrentWorkspace };
    cur.count += 1;
    byWorkspace.set(key, cur);
  }

  return {
    dir: here,
    root: SESSIONS_ROOT,
    cwd: CWD,
    scope,
    total: sessions.length,
    truncated,
    workspaces: [...byWorkspace.values()].sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0) || b.count - a.count),
    sessions: kept,
  };
}

/* --------------------------------------------------------------- changes */

/**
 * Session-scoped change tracking.
 *
 * The GUI cannot rely on `git diff`: the working directory is often not a
 * repository, and even when it is, the interesting question is "what did *this
 * session* touch". So every file-writing tool call is recorded here — the
 * content before the first touch and the content on disk now — and the diff is
 * computed on demand. Git, when present, adds repo-wide status on top.
 */
const CHANGE_MAX_BYTES = 1024 * 1024;
const CHANGE_MAX_FILES = 200;

let gitCache = { at: 0, ok: false };

/** Is the working directory inside a git work tree? (cached: shells out) */
function gitOk() {
  const now = Date.now();
  if (now - gitCache.at < 10_000) return gitCache.ok;
  let ok = false;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: CWD,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    });
    ok = true;
  } catch {
    ok = false;
  }
  gitCache = { at: now, ok };
  return ok;
}

function git(args, timeout = 8000) {
  return execFileSync('git', args, {
    cwd: CWD,
    maxBuffer: 48 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  }).toString('utf8');
}

/** Resolve a client-supplied path and refuse anything outside the project. */
function safeProjectPath(rel) {
  const abs = path.resolve(CWD, String(rel || ''));
  if (abs !== CWD && !abs.startsWith(CWD + path.sep)) return null;
  return abs;
}

function changesOf(sess) {
  if (!sess) return new Map();
  if (!sess.changes) sess.changes = new Map();
  return sess.changes;
}

/** The paths an edit/write tool call is about to touch. */
function toolPaths(evt) {
  if (!evt || evt.type !== 'tool_execution_start') return [];
  const name = String(evt.toolName || '').toLowerCase();
  if (name !== 'edit' && name !== 'write' && name !== 'multiedit' && name !== 'notebook') return [];
  const args = evt.args || {};
  const out = [];
  if (typeof args.path === 'string') out.push(args.path);
  if (Array.isArray(args.files)) for (const f of args.files) if (f && typeof f.path === 'string') out.push(f.path);
  return out;
}

function readProjectFile(rel) {
  const abs = safeProjectPath(rel);
  if (!abs) return { ok: false, reason: 'outside the project' };
  try {
    const st = fs.statSync(abs);
    if (st.size > CHANGE_MAX_BYTES) return { ok: false, reason: 'too large', size: st.size };
    return { ok: true, text: fs.readFileSync(abs, 'utf8'), abs };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, text: null, missing: true, abs };
    return { ok: false, reason: err.message };
  }
}

/** Record the "before" content the first time a path is touched. */
function noteChange(sess, rel, evt) {
  const map = changesOf(sess);
  if (map.has(rel)) {
    map.get(rel).count += 1;
    map.get(rel).lastAt = Date.now();
    return;
  }
  if (map.size >= CHANGE_MAX_FILES) return;
  const snap = readProjectFile(rel);
  const entry = {
    path: rel,
    before: snap.ok ? snap.text : null,
    beforeKnown: snap.ok,
    missing: !!snap.missing,
    count: 1,
    firstAt: Date.now(),
    lastAt: Date.now(),
    tool: String(evt.toolName || ''),
  };
  // For `edit` the arguments alone tell us what the file looked like, even if
  // this snapshot raced the write.
  const args = (evt && evt.args) || {};
  if (entry.beforeKnown && entry.before != null) {
    const edits = Array.isArray(args.edits) ? args.edits : typeof args.oldText === 'string' ? [{ oldText: args.oldText, newText: args.newText }] : [];
    if (edits.length === 1 && typeof edits[0].newText === 'string' && entry.before.includes(edits[0].newText)) {
      entry.before = entry.before.replace(edits[0].newText, edits[0].oldText ?? '');
      entry.reconstructed = true;
    }
  }
  map.set(rel, entry);
}

/** Line diff with common prefix/suffix trimming, so big files stay cheap. */
function lineDiff(before, after, maxCells = 2_000_000) {
  const A = String(before ?? '').split('\n');
  const B = String(after ?? '').split('\n');
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start += 1;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = A.slice(start, endA);
  const midB = B.slice(start, endB);
  const lines = [];
  for (let i = 0; i < start; i += 1) lines.push({ t: ' ', text: A[i], a: i + 1, b: i + 1 });

  let add = 0;
  let del = 0;
  const emitBlock = (from, to, sign) => {
    for (let i = from; i < to; i += 1) {
      if (sign === '-') {
        lines.push({ t: '-', text: A[i], a: i + 1 });
        del += 1;
      } else {
        lines.push({ t: '+', text: B[i], b: i + 1 });
        add += 1;
      }
    }
  };

  if (midA.length * midB.length > maxCells) {
    emitBlock(start, endA, '-');
    emitBlock(start, endB, '+');
  } else if (midA.length || midB.length) {
    // LCS table
    const n = midA.length;
    const m = midB.length;
    const dp = new Int32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i * (m + 1) + j] =
          midA[i] === midB[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        lines.push({ t: ' ', text: midA[i], a: start + i + 1, b: start + j + 1 });
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) {
        lines.push({ t: '-', text: midA[i], a: start + i + 1 });
        del += 1;
        i += 1;
      } else {
        lines.push({ t: '+', text: midB[j], b: start + j + 1 });
        add += 1;
        j += 1;
      }
    }
    while (i < n) {
      lines.push({ t: '-', text: midA[i], a: start + i + 1 });
      del += 1;
      i += 1;
    }
    while (j < m) {
      lines.push({ t: '+', text: midB[j], b: start + j + 1 });
      add += 1;
      j += 1;
    }
  }

  for (let i = endA; i < A.length; i += 1) {
    lines.push({ t: ' ', text: A[i], a: i + 1, b: endB + (i - endA) + 1 });
  }
  return { lines, add, del };
}

/** Git is optional: it adds repo-wide status for files this session never touched. */
function gitStatusMap() {
  const out = new Map();
  if (!gitOk()) return out;
  try {
    const raw = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], 6000);
    const parts = raw.split('\0');
    for (let i = 0; i < parts.length; i += 1) {
      const entry = parts[i];
      if (!entry || entry.length < 4) continue;
      const code = entry.slice(0, 2);
      const file = entry.slice(3);
      if (code[0] === 'R' || code[1] === 'R' || code[0] === 'C') i += 1;
      out.set(file, code);
    }
  } catch {}
  return out;
}

function gitNumstat() {
  const out = new Map();
  if (!gitOk()) return out;
  for (const args of [['diff', '--numstat', 'HEAD'], ['diff', '--numstat', '--cached']]) {
    try {
      for (const line of git(args, 6000).split('\n')) {
        if (!line) continue;
        const [a, d, ...rest] = line.split('\t');
        const file = rest.join('\t');
        if (!file || out.has(file)) continue;
        out.set(file, { add: a === '-' ? null : Number(a) || 0, del: d === '-' ? null : Number(d) || 0 });
      }
    } catch {}
  }
  return out;
}

function changesList(sess) {
  const map = changesOf(sess);
  const status = gitStatusMap();
  const nums = gitNumstat();
  const files = [];
  let add = 0;
  let del = 0;

  for (const [rel, entry] of map) {
    const now = readProjectFile(rel);
    const after = now.ok ? now.text : null;
    let a = null;
    let d = null;
    if (entry.beforeKnown && now.ok && !now.missing) {
      const diff = lineDiff(entry.before ?? '', after ?? '');
      a = diff.add;
      d = diff.del;
      add += a;
      del += d;
    } else if (nums.has(rel)) {
      const n = nums.get(rel);
      a = n.add;
      d = n.del;
      if (a) add += a;
      if (d) del += d;
    }
    files.push({
      path: rel,
      code: status.get(rel) || null,
      tool: entry.tool,
      count: entry.count,
      missing: !!now.missing,
      revertable: entry.beforeKnown,
      add: a,
      del: d,
      lastAt: entry.lastAt,
    });
  }

  // git knows about files this session never touched (shell commands, manual edits)
  for (const [rel, code] of status) {
    if (map.has(rel)) continue;
    const n = nums.get(rel);
    files.push({
      path: rel,
      code,
      tool: null,
      count: 0,
      missing: false,
      revertable: gitOk(),
      add: n ? n.add : null,
      del: n ? n.del : null,
      lastAt: Date.now(),
    });
  }

  files.sort((x, y) => (y.tool ? 1 : 0) - (x.tool ? 1 : 0) || x.path.localeCompare(y.path));
  return {
    git: gitOk(),
    cwd: CWD,
    files,
    totals: { files: files.length, add, del, session: map.size },
  };
}

function changesDiff(sess, rel) {
  const entry = changesOf(sess).get(rel);
  const now = readProjectFile(rel);
  if (!now.ok) return { error: now.reason };
  if (entry && entry.beforeKnown) {
    const diff = lineDiff(entry.before ?? '', now.text ?? '');
    return { path: rel, ...diff, source: 'session' };
  }
  // no session baseline: fall back to git, or show the file as all-new
  if (gitOk()) {
    try {
      const text = git(['diff', '--no-color', 'HEAD', '--', rel], 8000);
      if (text.trim()) {
        const lines = text.split('\n').filter((l, i, arr) => i < arr.length - 1 || l).map((l) => ({
          t: l.startsWith('+') && !l.startsWith('+++') ? '+' : l.startsWith('-') && !l.startsWith('---') ? '-' : ' ',
          text: l,
        }));
        return { path: rel, lines, add: lines.filter((l) => l.t === '+').length, del: lines.filter((l) => l.t === '-').length, source: 'git' };
      }
    } catch {}
  }
  if (now.missing) return { path: rel, lines: [], add: 0, del: 0, source: 'none' };
  if ((now.text || '').length > 2 * 1024 * 1024) return { error: 'file too large to preview' };
  const diff = lineDiff('', now.text ?? '');
  return { path: rel, ...diff, source: 'file' };
}

function changesRevert(sess, rel) {
  const entry = changesOf(sess).get(rel);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(TRACE_DIR, `revert-${stamp}`);
  const abs = safeProjectPath(rel);
  if (!abs) return { error: 'path escapes the project' };
  // Normalise before building the backup path: the client-supplied `rel` may be
  // a traversal that still resolves inside CWD (e.g. ../../<cwd>/<file>).
  const relSafe = path.relative(CWD, abs);
  pruneRevertDirs();

  // always keep a copy of what is on disk right now
  let backup = null;
  try {
    if (fs.existsSync(abs)) {
      fs.mkdirSync(path.join(backupDir, path.dirname(relSafe)), { recursive: true });
      backup = path.join(backupDir, relSafe);
      fs.copyFileSync(abs, backup);
    }
  } catch (err) {
    return { error: `backup failed: ${err.message}` };
  }

  if (entry && entry.beforeKnown) {
    try {
      if (entry.before == null) {
        fs.unlinkSync(abs);
        return { ok: true, backup, action: 'delete', source: 'session' };
      }
      fs.writeFileSync(abs, entry.before);
      changesOf(sess).delete(rel);
      return { ok: true, backup, action: 'restore', source: 'session' };
    } catch (err) {
      return { error: err.message };
    }
  }

  if (gitOk()) {
    try {
      git(['checkout', 'HEAD', '--', relSafe], 8000);
      return { ok: true, backup, action: 'checkout', source: 'git' };
    } catch {
      try {
        fs.unlinkSync(abs);
        return { ok: true, backup, action: 'delete', source: 'git' };
      } catch (err) {
        return { error: err.message };
      }
    }
  }
  return { error: 'no baseline for this file — nothing to revert to' };
}

/* ---------------------------------------------------------------- search */

let sessionFileCache = { at: 0, files: [] };

/** Every saved session file on disk, this project first. */
function allSessionFiles() {
  const now = Date.now();
  if (now - sessionFileCache.at < 20_000) return sessionFileCache.files;
  const files = [];
  const here = sessionsDir(CWD);
  const push = (dir, isHere) => {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const full = path.join(dir, n);
      try {
        const st = fs.statSync(full);
        files.push({ path: full, file: n, dir, here: isHere, mtime: st.mtimeMs, size: st.size });
      } catch {}
    }
  };
  push(here, true);
  try {
    for (const d of fs.readdirSync(SESSIONS_ROOT)) {
      const full = path.join(SESSIONS_ROOT, d);
      if (full !== here) push(full, false);
    }
  } catch {}
  files.sort((a, b) => (b.here ? 1 : 0) - (a.here ? 1 : 0) || b.mtime - a.mtime);
  sessionFileCache = { at: now, files };
  return files;
}

const SEARCH_MAX_FILES = 400;
const SEARCH_MAX_BYTES = 24 * 1024 * 1024;

function messageText(o) {
  const m = o.message || o;
  const content = m && m.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && c.type === 'text' ? c.text : c && c.type === 'thinking' ? c.thinking || '' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Substring search over the session transcripts. Cheap enough to run on every
 * keystroke: files are skipped when they obviously cannot match, and only
 * matching lines are parsed.
 */
function searchSessions(query, limit) {
  const q = String(query || '');
  const needle = q.toLowerCase();
  if (needle.length < 2) return { query: q, scanned: 0, truncated: false, results: [] };

  const results = [];
  let scanned = 0;
  let bytes = 0;
  let truncated = false;
  let header = null;
  let name = null;

  for (const f of allSessionFiles()) {
    if (scanned >= SEARCH_MAX_FILES || bytes >= SEARCH_MAX_BYTES) {
      truncated = true;
      break;
    }
    if (f.size > 24 * 1024 * 1024) continue;
    let text = '';
    try {
      text = fs.readFileSync(f.path, 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    bytes += text.length;
    if (!text.toLowerCase().includes(needle)) continue;

    header = null;
    name = null;
    const hits = [];
    let index = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (!line.toLowerCase().includes(needle)) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.type === 'session') header = o;
      if (o.type === 'session_info' && o.name) name = o.name;
      const body = messageText(o);
      if (!body) continue;
      const at = body.toLowerCase().indexOf(needle);
      if (at === -1) continue;
      const role = (o.message && o.message.role) || o.type || '?';
      const from = Math.max(0, at - 60);
      const snippet = (from > 0 ? '…' : '') + body.slice(from, at + needle.length + 90).replace(/\s+/g, ' ').trim();
      hits.push({ role, index, at, snippet });
      if (hits.length >= 6) break;
      index += 1;
    }
    if (!hits.length) continue;
    results.push({
      path: f.path,
      file: f.file,
      cwd: header ? header.cwd : null,
      id: header ? header.id : null,
      name,
      here: f.here,
      mtime: f.mtime,
      hits,
    });
    if (results.length >= limit) break;
  }
  results.sort((a, b) => (b.here ? 1 : 0) - (a.here ? 1 : 0) || b.mtime - a.mtime);
  return { query: q, scanned, truncated, results };
}

// ---------------------------------------------------------------- http

/** No inline scripts anywhere, so scripts stay 'self'; inline *styles* are used by
 *  the waterfall/share bars, hence 'unsafe-inline' for style-src only. */
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

function readBody(req, cb) {
  let data = '';
  req.on('data', (c) => {
    data += c;
    if (data.length > 64 * 1024 * 1024) req.destroy();
  });
  req.on('end', () => cb(data));
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(buf);
  });
}

function sessionInfo(sess, url) {
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : PORT;
  return {
    session: sess ? sess.id : null,
    cwd: CWD,
    piBin: PI_BIN,
    pid: sess && sess.child ? sess.child.pid : null,
    alive: !!(sess && sess.alive),
    traceFile: sess ? sess.traceFile : null,
    startedAt: sess ? sess.runStartedAt : null,
    sessions: sessions.size,
    url: `http://${HOST}:${port}/`,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const cid = url.searchParams.get('c') || 'default';

  if (AUTH_TOKEN && p.startsWith('/api/')) {
    const supplied = url.searchParams.get('token') || req.headers['x-pi-gui-token'];
    if (supplied !== AUTH_TOKEN) {
      return sendJson(res, 401, { error: 'unauthorized: missing or wrong token' });
    }
  }

  if (p === '/api/events') {
    const sess = ensureSession(cid);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...SECURITY_HEADERS,
    });
    res.write('retry: 1000\n\n');
    sess.clients.add(res);
    res.write(
      `data: ${JSON.stringify({
        type: '__hello',
        ...sessionInfo(sess, url),
        dialogs: liveDialogIds(sess),
        seq: sess.seq,
        buffered: sess.buffer.length,
      })}\n\n`,
    );

    // Late clients still need the inspector's one-shot captures (inventory,
    // agents): those go through broadcast(), which is not replayed like the
    // trace buffer, so a client that connects after startup would miss them.
    for (const rec of sess.inspect) {
      try {
        res.write(
          `data: ${JSON.stringify({
            type: '__inspect',
            kind: rec.kind,
            at: rec.at,
            data: rec.data,
            agent: rec.agent,
            __replay: true,
          })}\n\n`,
        );
      } catch {}
    }
    for (const a of sess.agents.values()) {
      try {
        res.write(`data: ${JSON.stringify({ type: '__agent', event: 'start', agent: a })}\n\n`);
      } catch {}
    }

    // A client that reconnects can ask for everything it missed. If the buffer
    // already dropped part of that range, say so and let the client fully resync.
    const since = Number(url.searchParams.get('since') || 0);
    if (since > 0 && sess.buffer.length) {
      const oldest = sess.buffer[0].seq;
      if (oldest > since + 1) {
        res.write(`data: ${JSON.stringify({ type: '__gap', from: since + 1, to: oldest - 1, seq: sess.seq })}\n\n`);
      }
      for (const rec of sess.buffer) {
        if (rec.seq <= since) continue;
        try {
          res.write(`data: ${JSON.stringify({ ...rec.evt, __seq: rec.seq, __t: rec.t, __replay: true })}\n\n`);
        } catch {}
      }
    }
    const hb = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {}
    }, 15000);
    req.on('close', () => {
      clearInterval(hb);
      sess.clients.delete(res);
      sess.lastSeen = Date.now();
    });
    return;
  }

  if (p === '/api/command' && req.method === 'POST') {
    readBody(req, (body) => {
      let cmd;
      try {
        cmd = JSON.parse(body);
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON' });
      }
      const sess = ensureSession(cid);
      // Dialog answers are recorded (and broadcast) so every client's trace and
      // modal state stays in sync.
      if (cmd && cmd.type === 'extension_ui_response') emit(sess, { type: '__ui_response', response: cmd });
      // A session switch starts a different conversation: the file-change
      // baseline and the agent registry belong to the old one.
      if (cmd && ['switch_session', 'new_session', 'fork', 'clone'].includes(cmd.type)) {
        sess.changes = new Map();
        sess.agents = new Map();
        sess.inspect = [];
        sess.inspectSizes = [];
        sess.inspectBytes = 0;
        emit(sess, { type: '__marker', kind: 'session_switch', text: cmd.type });
      }
      sess.lastCommand = { type: cmd && cmd.type, at: Date.now() };
      if (!sess.alive) startPi(sess);
      const ok = sendToPi(sess, cmd);
      sendJson(res, ok ? 200 : 503, ok ? { ok: true } : { error: 'pi is not running' });
    });
    return;
  }

  if (p === '/api/info') {
    return sendJson(res, 200, sessionInfo(peekSession(cid) || (cid !== 'default' ? null : peekSession('default')), url));
  }

  // Connection self-check: if sseClients is 0, no browser is attached.
  if (p === '/api/diagnostics') {
    const sess = peekSession(cid);
    return sendJson(res, 200, {
      ok: true,
      session: sess ? sess.id : null,
      pid: sess && sess.child ? sess.child.pid : null,
      alive: !!(sess && sess.alive),
      sseClients: sess ? sess.clients.size : 0,
      lastCommand: sess ? sess.lastCommand : null,
      lastEvent: sess ? sess.lastEvent : null,
      traceFile: sess ? sess.traceFile : null,
      startedAt: sess ? sess.runStartedAt : null,
      uptimeMs: sess && sess.runStartedAt ? Date.now() - sess.runStartedAt : 0,
      bufferedEvents: sess ? sess.buffer.length : 0,
      memory: sess ? { traceBytes: sess.bufferBytes, inspectBytes: sess.inspectBytes } : null,
      activeSessions: sessions.size,
      traceKeep: TRACE_KEEP,
      url: sessionInfo(sess, url).url,
    });
  }

  if (p === '/api/restart' && req.method === 'POST') {
    const sess = ensureSession(cid);
    stopPi(sess, () => {
      startPi(sess);
      sendJson(res, 200, { ok: true, traceFile: sess.traceFile });
    });
    return;
  }

  if (p === '/api/inspect') {
    const sess = ensureSession(cid);
    if (req.method === 'POST') {
      readBody(req, (body) => {
        let rec = null;
        try {
          rec = JSON.parse(body);
        } catch {}
        if (!rec || typeof rec.kind !== 'string') return sendJson(res, 400, { error: 'invalid record' });
        addInspect(sess, rec);
        sendJson(res, 200, { ok: true });
      });
      return;
    }
    let records = sess.inspect;
    if (!records.length) {
      const file = inspectFileFor(sess);
      try {
        if (file && fs.existsSync(file)) records = readTraceRecords(file);
      } catch {}
    }
    return sendJson(res, 200, {
      session: sess.id,
      count: records.length,
      records,
      agents: [...sess.agents.values()],
    });
  }

  if (p === '/api/extensions') {
    return sendJson(res, 200, {
      gui: [
        { key: 'gui-bridge', path: GUI_EXTENSION, enabled: !guiBridgeDisabled, exists: fs.existsSync(GUI_EXTENSION) },
        { key: 'inspector', path: INSPECTOR_EXTENSION, enabled: !inspectorDisabled, exists: fs.existsSync(INSPECTOR_EXTENSION) },
      ],
      discovered: discoverExtensions(),
      settings: readSettingsExtras(),
      cwd: CWD,
    });
  }

  if (p === '/api/extensions/toggle' && req.method === 'POST') {
    readBody(req, (body) => {
      let b = {};
      try {
        b = JSON.parse(body);
      } catch {}
      if (b.key === 'gui-bridge') guiBridgeDisabled = !b.enabled;
      else if (b.key === 'inspector') inspectorDisabled = !b.enabled;
      else return sendJson(res, 400, { error: 'unknown extension key' });
      // the flag only takes effect on (re)spawn, so restart this session's pi
      const sess = ensureSession(cid);
      stopPi(sess, () => {
        startPi(sess);
        sendJson(res, 200, { ok: true, key: b.key, enabled: !!b.enabled });
      });
    });
    return;
  }

  if (p === '/api/agents') {
    const sess = peekSession(cid);
    return sendJson(res, 200, { session: cid, agents: sess ? [...sess.agents.values()] : [] });
  }

  if (p === '/api/files') {
    const q = url.searchParams.get('q') || '';
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 60)));
    let files = [];
    try {
      files = searchFiles(q, limit);
    } catch {}
    return sendJson(res, 200, { cwd: CWD, query: q, count: files.length, files });
  }

  if (p === '/api/traces') {
    let files = [];
    try {
      files = fs
        .readdirSync(TRACE_DIR)
        .filter((f) => f.startsWith('run-') && f.endsWith('.jsonl'))
        .map((f) => {
          const st = fs.statSync(path.join(TRACE_DIR, f));
          return { file: f, size: st.size, mtime: st.mtimeMs, current: path.join(TRACE_DIR, f) === (peekSession(cid) || {}).traceFile };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch {}
    return sendJson(res, 200, {
      dir: TRACE_DIR,
      keep: TRACE_KEEP,
      current: peekSession(cid) && peekSession(cid).traceFile ? path.basename(peekSession(cid).traceFile) : null,
      files,
    });
  }

  if (p === '/api/trace') {
    const sess = peekSession(cid);
    const want = url.searchParams.get('file');
    const file = want ? path.join(TRACE_DIR, path.basename(want)) : sess && sess.traceFile;
    if (!file || !file.startsWith(TRACE_DIR) || !fs.existsSync(file)) {
      return sendJson(res, 200, { file: null, pinned: false, records: [] });
    }
    try {
      return sendJson(res, 200, { file: path.basename(file), pinned: !!want, records: readTraceRecords(file) });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (p === '/api/trace/marker' && req.method === 'POST') {
    readBody(req, (body) => {
      let m = {};
      try {
        m = JSON.parse(body || '{}');
      } catch {}
      const sess = ensureSession(cid);
      emit(sess, { type: '__marker', kind: m.kind || 'note', text: m.text || '', meta: m.meta || null });
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  if (p === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const limit = Math.min(40, Math.max(1, Number(url.searchParams.get('limit') || 12)));
    return sendJson(res, 200, searchSessions(q, limit));
  }

  if (p === '/api/changes') {
    const sess = peekSession(cid);
    try {
      return sendJson(res, 200, changesList(sess));
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (p === '/api/changes/diff') {
    const sess = peekSession(cid);
    const rel = url.searchParams.get('path') || '';
    try {
      return sendJson(res, 200, changesDiff(sess, rel));
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (p === '/api/changes/revert' && req.method === 'POST') {
    readBody(req, (body) => {
      let b = {};
      try {
        b = JSON.parse(body || '{}');
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON' });
      }
      const out = changesRevert(peekSession(cid), String(b.path || ''));
      sendJson(res, out.error ? 400 : 200, out);
    });
    return;
  }

  if (p === '/api/sessions') {
    const scope = url.searchParams.get('scope') === 'workspace' ? 'workspace' : 'all';
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 300)));
    try {
      return sendJson(res, 200, listSessions({ scope, limit }));
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (p === '/api/session/delete' && req.method === 'POST') {
    readBody(req, (body) => {
      let b = {};
      try {
        b = JSON.parse(body || '{}');
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON' });
      }
      const dir = path.resolve(sessionsDir(CWD));
      const target = path.resolve(String(b.path || ''));
      if (!target.startsWith(dir + path.sep) || !target.endsWith('.jsonl') || !fs.existsSync(target)) {
        return sendJson(res, 403, { error: 'refusing to delete that path' });
      }
      try {
        fs.unlinkSync(target);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  serveStatic(res, p);
});

// ---------------------------------------------------------------- boot

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    process.stderr.write(`\n[pistudio] port ${PORT} is already in use — another PiStudio is probably running.\n`);
    process.stderr.write(`[pistudio] stop it with:  pkill -f "pi/server.js"   (or use --port)\n\n`);
    process.exit(1);
  }
  throw err;
});

/** Reap pi processes whose tab is long gone. */
const reaper = setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of sessions) {
    if (sess.clients.size > 0 || now - sess.lastSeen < SESSION_IDLE_MS) continue;
    process.stderr.write(`[pistudio] reaping idle session ${id}\n`);
    sessions.delete(id);
    stopPi(sess, () => {});
  }
}, 60_000);
reaper.unref?.();

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const actualPort = addr && typeof addr === 'object' ? addr.port : PORT;
  serverUrl = `http://${HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST}:${actualPort}`;
  const suffix = AUTH_TOKEN ? `?token=${AUTH_TOKEN}` : '';
  const url = `${serverUrl}/${suffix}`;
  process.stdout.write(`\n  PiStudio running at ${url}\n  cwd:   ${CWD}\n\n`);
  process.stdout.write(
    `  pi processes are started per browser tab (idle ones are reaped after ${Math.round(SESSION_IDLE_MS / 60000)} min)\n`,
  );
  if (!IS_LOOPBACK) {
    process.stderr.write(
      `\n  !! binding to ${HOST} exposes a shell-capable agent beyond this machine.\n` +
        `  !! API access requires the token above ${AUTH_TOKEN ? '(append it to the URL)' : ''}.\n\n`,
    );
  }
  process.stdout.write(`__PI_GUI_READY__ ${JSON.stringify({ url, host: HOST, port: actualPort, cwd: CWD, token: AUTH_TOKEN || null })}\n`);
});

function shutdown() {
  process.stdout.write('\n[pistudio] shutting down\n');
  for (const sess of sessions.values()) {
    for (const res of sess.clients) {
      try {
        res.end();
      } catch {}
    }
    try {
      if (sess.child) sess.child.kill('SIGTERM');
    } catch {}
  }
  setTimeout(() => process.exit(0), 800).unref?.();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
