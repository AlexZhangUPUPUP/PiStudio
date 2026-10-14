'use strict';

/**
 * PiStudio SQLite usage index — a zero-dependency, *derived* index over saved
 * session transcripts. The JSONL session files remain the source of truth:
 * this database can be dropped and rebuilt at any time.
 *
 * Driver: Node's built-in `node:sqlite` (Node >= 22.5). When the module is
 * missing (older Node) or disabled, every accessor degrades to a safe no-op so
 * the server never crashes because of the index.
 *
 * This is a pure storage layer: it must not require any project file.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions(
    session_file TEXT PRIMARY KEY,
    workspace TEXT,
    label TEXT,
    title TEXT,
    preview TEXT,
    model TEXT,
    turns INTEGER,
    cost REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    updated_at INTEGER,
    size INTEGER,
    mtime INTEGER
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    session_file UNINDEXED,
    title,
    body,
    tokenize='unicode61'
  )`,
  `CREATE TABLE IF NOT EXISTS runs(
    run_file TEXT PRIMARY KEY,
    session TEXT,
    cwd TEXT,
    model TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    cost REAL,
    tokens INTEGER,
    turns INTEGER,
    status TEXT,
    mtime INTEGER,
    size INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS tasks(
    id TEXT PRIMARY KEY,
    label TEXT,
    cwd TEXT,
    status TEXT,
    created_at INTEGER,
    ended_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS task_agents(
    task_id TEXT,
    agent_id TEXT,
    name TEXT,
    model TEXT,
    status TEXT,
    turns INTEGER,
    tokens INTEGER,
    cost REAL,
    elapsed_ms INTEGER,
    PRIMARY KEY(task_id, agent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS kv(
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
].join(';\n');

/** Local calendar day key, e.g. "2026-10-14". */
function dayKey(ms) {
  const n = Number(ms);
  if (!n) return null;
  const d = new Date(n);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** Turn a free-text query into a safe FTS5 query (each token becomes a phrase). */
function toFtsQuery(q) {
  const terms = String(q || '').trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  return terms.map((t) => '"' + t.replace(/"/g, '""') + '"').join(' AND ');
}

/** A compact snippet in the same style as server.js's substring search. */
function makeSnippet(body, q) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  const needle = String(q || '').toLowerCase().trim();
  let at = lower.indexOf(needle);
  if (at === -1) {
    const first = needle.split(/\s+/)[0];
    at = first ? lower.indexOf(first) : -1;
  }
  if (at === -1) return text.slice(0, 140);
  const from = Math.max(0, at - 60);
  const end = at + Math.max(needle.length, 1) + 90;
  return (from > 0 ? '…' : '') + text.slice(from, end).trim();
}

function zeroTotals() {
  return { cost: 0, tokensIn: 0, tokensOut: 0, tokens: 0, turns: 0, sessions: 0, tasks: 0 };
}

function emptyUsage(days) {
  return {
    available: false,
    days: Number(days) || 30,
    totals: zeroTotals(),
    prev: zeroTotals(),
    series: [],
    byModel: [],
    byWorkspace: [],
  };
}

function noopAdapter(reason) {
  return {
    available: false,
    reason: reason || 'unavailable',
    search: (query, limit) => ({
      query: String(query || ''),
      scanned: 0,
      truncated: false,
      results: [],
    }),
    usage: ({ days } = {}) => emptyUsage(days),
    status: () => ({ available: false, db: null, sessions: 0, runs: 0, tasks: 0, updatedAt: 0 }),
    meta: () => new Map(),
    upsertSessions: () => 0,
    upsertTasks: () => 0,
    runMeta: () => new Map(),
    upsertRuns: () => 0,
    runs: () => [],
    rebuild: () => {},
    close: () => {},
  };
}

/**
 * Open (or create) the derived index. Returns an adapter whose every method is
 * a safe no-op when the driver is unavailable or the database cannot be opened.
 *
 * @param {{ dbFile?: string|null, log?: (msg:string)=>void, cwd?: string }} opts
 */
function openIndex({ dbFile, log, cwd } = {}) {
  const logFn = typeof log === 'function' ? log : () => {};

  let sqlite = null;
  try {
    sqlite = require('node:sqlite');
  } catch {
    sqlite = null;
  }
  if (!sqlite || !sqlite.DatabaseSync) {
    logFn('[pistudio] index: node:sqlite unavailable (Node < 22.5)');
    return noopAdapter('node:sqlite unavailable');
  }
  if (!dbFile) {
    return noopAdapter('disabled');
  }

  let db;
  try {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    db = new sqlite.DatabaseSync(dbFile);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(SCHEMA);
    // Older index DBs may already have a runs table without the columns added
    // for trace-run indexing. Each ALTER is guarded so fresh databases (whose
    // CREATE TABLE already includes them) simply report "duplicate column".
    for (const add of [
      'ALTER TABLE runs ADD COLUMN turns INTEGER',
      'ALTER TABLE runs ADD COLUMN mtime INTEGER',
      'ALTER TABLE runs ADD COLUMN size INTEGER',
    ]) {
      try {
        db.exec(add);
      } catch {}
    }
  } catch (err) {
    const msg = (err && err.message) || String(err);
    logFn(`[pistudio] index: cannot open ${dbFile}: ${msg}`);
    try {
      if (db) db.close();
    } catch {}
    return noopAdapter('open failed: ' + msg);
  }

  let stmts;
  try {
    stmts = {
      upsertSession: db.prepare(
        `INSERT INTO sessions(session_file, workspace, label, title, preview, model, turns, cost, tokens_in, tokens_out, updated_at, size, mtime)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(session_file) DO UPDATE SET
           workspace=excluded.workspace, label=excluded.label, title=excluded.title,
           preview=excluded.preview, model=excluded.model, turns=excluded.turns,
           cost=excluded.cost, tokens_in=excluded.tokens_in, tokens_out=excluded.tokens_out,
           updated_at=excluded.updated_at, size=excluded.size, mtime=excluded.mtime`,
      ),
      ftsDelete: db.prepare('DELETE FROM sessions_fts WHERE session_file = ?'),
      ftsInsert: db.prepare('INSERT INTO sessions_fts(session_file, title, body) VALUES(?,?,?)'),
      upsertTask: db.prepare(
        `INSERT INTO tasks(id, label, cwd, status, created_at, ended_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           label=excluded.label, cwd=excluded.cwd, status=excluded.status,
           created_at=excluded.created_at, ended_at=excluded.ended_at`,
      ),
      upsertAgent: db.prepare(
        `INSERT INTO task_agents(task_id, agent_id, name, model, status, turns, tokens, cost, elapsed_ms)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(task_id, agent_id) DO UPDATE SET
           name=excluded.name, model=excluded.model, status=excluded.status,
           turns=excluded.turns, tokens=excluded.tokens, cost=excluded.cost, elapsed_ms=excluded.elapsed_ms`,
      ),
      search: db.prepare(
        `SELECT s.session_file, s.workspace, s.title, s.preview, s.updated_at,
                snippet(sessions_fts, 2, '', '', '…', 16) AS snip
         FROM sessions_fts
         JOIN sessions s ON s.session_file = sessions_fts.session_file
         WHERE sessions_fts MATCH ?
         ORDER BY s.updated_at DESC
         LIMIT ?`,
      ),
      countSessions: db.prepare('SELECT COUNT(*) AS n FROM sessions'),
      countRuns: db.prepare('SELECT COUNT(*) AS n FROM runs'),
      countTasks: db.prepare('SELECT COUNT(*) AS n FROM tasks'),
      maxUpdated: db.prepare('SELECT MAX(updated_at) AS n FROM sessions'),
      allMeta: db.prepare('SELECT session_file, mtime, size FROM sessions'),
      runMeta: db.prepare('SELECT run_file, mtime, size FROM runs'),
      listRuns: db.prepare(
        'SELECT run_file, model, started_at, ended_at, cost, tokens, turns, status FROM runs ORDER BY COALESCE(started_at, mtime) DESC LIMIT ?',
      ),
      upsertRun: db.prepare(
        `INSERT INTO runs(run_file, session, cwd, model, started_at, ended_at, cost, tokens, turns, status, mtime, size)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(run_file) DO UPDATE SET
           session=excluded.session, cwd=excluded.cwd, model=excluded.model,
           started_at=excluded.started_at, ended_at=excluded.ended_at,
           cost=excluded.cost, tokens=excluded.tokens, turns=excluded.turns,
           status=excluded.status, mtime=excluded.mtime, size=excluded.size`,
      ),
      kvGet: db.prepare('SELECT value FROM kv WHERE key = ?'),
      kvSet: db.prepare(
        'INSERT INTO kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ),
      usageSessions: db.prepare(
        'SELECT workspace, label, model, turns, cost, tokens_in, tokens_out, updated_at FROM sessions WHERE updated_at >= ?',
      ),
      usageTasks: db.prepare(
        'SELECT t.id AS task_id, t.created_at, t.ended_at, ta.model, ta.turns, ta.tokens, ta.cost FROM task_agents ta JOIN tasks t ON t.id = ta.task_id',
      ),
    };
    // One-off migration: FTS used to index only title+preview. Clear the index so
    // the scanner re-reads full transcripts (bump when the indexed body changes).
    try {
      const v = db.prepare('SELECT value FROM kv WHERE key = ?').get('fts_body_version');
      if (!v || v.value !== '2') {
        db.exec('DELETE FROM sessions_fts');
        db.exec('DELETE FROM sessions');
        db.prepare('INSERT INTO kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
          'fts_body_version',
          '2',
        );
      }
    } catch {}
  } catch (err) {
    const msg = (err && err.message) || String(err);
    logFn(`[pistudio] index: prepare failed: ${msg}`);
    try {
      db.close();
    } catch {}
    return noopAdapter('prepare failed: ' + msg);
  }

  const adapter = {
    available: true,
    reason: null,
    db: dbFile,

    /**
     * FTS5 search over sessions_fts joined to sessions. Returns the exact shape
     * of server.js `searchSessions()` so the client needs no changes.
     */
    search(query, limit) {
      const q = String(query || '');
      const lim = Math.max(1, Math.min(40, Number(limit) || 12));
      if (q.trim().length < 2) return { query: q, scanned: 0, truncated: false, results: [] };
      try {
        const fq = toFtsQuery(q);
        if (!fq) return { query: q, scanned: 0, truncated: false, results: [] };
        const rows = stmts.search.all(fq, lim + 1);
        const truncated = rows.length > lim;
        const results = rows.slice(0, lim).map((r) => {
          const snip =
            String(r.snip || '').replace(/\s+/g, ' ').trim() ||
            makeSnippet([r.title, r.preview].filter(Boolean).join(' '), q);
          return {
            path: r.session_file,
            file: path.basename(r.session_file),
            cwd: r.workspace || null,
            id: null,
            name: r.title || null,
            here: !!(cwd && r.workspace && r.workspace === cwd),
            mtime: Number(r.updated_at) || 0,
            hits: [{ role: 'content', index: 0, at: 0, snippet: snip }],
          };
        });
        return { query: q, scanned: rows.length, truncated, results };
      } catch (err) {
        logFn(`[pistudio] index: search error: ${(err && err.message) || err}`);
        return { query: q, scanned: 0, truncated: false, results: [] };
      }
    },

    /** Aggregate usage for the last `days` days (FROZEN /api/usage contract). */
    usage({ days } = {}) {
      const d = Math.max(1, Number(days) || 30);
      const out = emptyUsage(d);
      try {
        const now = Date.now();
        const since = now - d * 86400000;
        const prevSince = now - 2 * d * 86400000;
        const totals = zeroTotals();
        const prev = zeroTotals();
        const seriesMap = new Map();
        const modelMap = new Map();
        const wsMap = new Map();

        const addSeries = (key, cost, tokens, turns) => {
          if (!key) return;
          const cur = seriesMap.get(key) || { key, cost: 0, tokens: 0, turns: 0 };
          cur.cost += cost;
          cur.tokens += tokens;
          cur.turns += turns;
          seriesMap.set(key, cur);
        };
        const addModel = (key, cost, tokens, turns, count) => {
          if (!key) return;
          const cur = modelMap.get(key) || { key, cost: 0, tokens: 0, turns: 0, count: 0 };
          cur.cost += cost;
          cur.tokens += tokens;
          cur.turns += turns;
          cur.count += count;
          modelMap.set(key, cur);
        };
        const addWorkspace = (key, label, cost, tokens, turns) => {
          const cur = wsMap.get(key) || { key, label: label || key, cost: 0, tokens: 0, turns: 0, count: 0 };
          cur.cost += cost;
          cur.tokens += tokens;
          cur.turns += turns;
          cur.count += 1;
          wsMap.set(key, cur);
        };

        // Sessions contribute per-session cost / in-out tokens / turns.
        for (const s of stmts.usageSessions.all(since)) {
          const tin = Number(s.tokens_in) || 0;
          const tout = Number(s.tokens_out) || 0;
          const cost = Number(s.cost) || 0;
          const turns = Number(s.turns) || 0;
          totals.cost += cost;
          totals.tokensIn += tin;
          totals.tokensOut += tout;
          totals.tokens += tin + tout;
          totals.turns += turns;
          totals.sessions += 1;
          addSeries(dayKey(s.updated_at), cost, tin + tout, turns);
          if (s.model) addModel(String(s.model), cost, tin + tout, turns, 1);
          const wkey = s.workspace || s.label || '(unknown)';
          addWorkspace(wkey, s.label || path.basename(String(s.workspace || wkey)) || wkey, cost, tin + tout, turns);
        }

        // Tasks contribute cost / tokens / turns (grouped by finish/start day).
        const taskIds = new Set();
        for (const t of stmts.usageTasks.all()) {
          const created = Number(t.created_at) || 0;
          const ended = Number(t.ended_at) || 0;
          const at = ended || created;
          if (!at || at < since) continue;
          taskIds.add(String(t.task_id));
          const cost = Number(t.cost) || 0;
          const tokens = Number(t.tokens) || 0;
          const turns = Number(t.turns) || 0;
          totals.cost += cost;
          totals.tokens += tokens;
          totals.turns += turns;
          addSeries(dayKey(at), cost, tokens, turns);
          if (t.model) addModel(String(t.model), cost, tokens, turns, 1);
        }
        totals.tasks = taskIds.size;

        // Preceding equal-length window [now - 2*days, now - days). Same keys
        // as `totals` so the UI can render a delta without special-casing.
        for (const s of stmts.usageSessions.all(prevSince)) {
          const updated = Number(s.updated_at) || 0;
          if (updated >= since) continue;
          const tin = Number(s.tokens_in) || 0;
          const tout = Number(s.tokens_out) || 0;
          prev.cost += Number(s.cost) || 0;
          prev.tokensIn += tin;
          prev.tokensOut += tout;
          prev.tokens += tin + tout;
          prev.turns += Number(s.turns) || 0;
          prev.sessions += 1;
        }
        const prevTaskIds = new Set();
        for (const t of stmts.usageTasks.all()) {
          const created = Number(t.created_at) || 0;
          const ended = Number(t.ended_at) || 0;
          const at = ended || created;
          if (!at || at < prevSince || at >= since) continue;
          prevTaskIds.add(String(t.task_id));
          prev.cost += Number(t.cost) || 0;
          prev.tokens += Number(t.tokens) || 0;
          prev.turns += Number(t.turns) || 0;
        }
        prev.tasks = prevTaskIds.size;

        out.available = true;
        out.days = d;
        out.totals = totals;
        out.prev = prev;
        out.series = [...seriesMap.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        out.byModel = [...modelMap.values()].sort((a, b) => b.cost - a.cost);
        out.byWorkspace = [...wsMap.values()].sort((a, b) => b.cost - a.cost);
        return out;
      } catch (err) {
        logFn(`[pistudio] index: usage error: ${(err && err.message) || err}`);
        return out;
      }
    },

    /** Index health: availability, db path, row counts, last-updated time. */
    status() {
      try {
        const s = stmts.countSessions.get();
        const r = stmts.countRuns.get();
        const t = stmts.countTasks.get();
        const mx = stmts.maxUpdated.get();
        const idx = stmts.kvGet.get('indexed_at');
        return {
          available: true,
          db: dbFile,
          sessions: Number(s && s.n) || 0,
          runs: Number(r && r.n) || 0,
          tasks: Number(t && t.n) || 0,
          updatedAt: idx ? Number(idx.value) || 0 : Number(mx && mx.n) || 0,
        };
      } catch (err) {
        logFn(`[pistudio] index: status error: ${(err && err.message) || err}`);
        return { available: false, db: dbFile, sessions: 0, runs: 0, tasks: 0, updatedAt: 0 };
      }
    },

    /** Stored {mtime,size} per session file — lets the scanner skip unchanged files. */
    meta() {
      const out = new Map();
      try {
        for (const r of stmts.allMeta.all()) {
          out.set(String(r.session_file), { mtime: Number(r.mtime) || 0, size: Number(r.size) || 0 });
        }
      } catch {}
      return out;
    },

    /** Stored {mtime,size} per trace run — lets the scanner skip unchanged runs. */
    runMeta() {
      const out = new Map();
      try {
        for (const r of stmts.runMeta.all()) {
          out.set(String(r.run_file), { mtime: Number(r.mtime) || 0, size: Number(r.size) || 0 });
        }
      } catch {}
      return out;
    },

    /** Newest indexed trace runs (FROZEN /api/runs contract). */
    runs(limit) {
      const lim = Math.max(1, Math.min(200, Number(limit) || 20));
      try {
        return stmts.listRuns.all(lim).map((r) => ({
          runFile: path.basename(String(r.run_file || '')),
          startedAt: Number(r.started_at) || null,
          endedAt: Number(r.ended_at) || null,
          cost: Number(r.cost) || 0,
          tokens: Number(r.tokens) || 0,
          turns: Number(r.turns) || 0,
          status: r.status != null ? String(r.status) : null,
          model: r.model != null ? String(r.model) : null,
        }));
      } catch (err) {
        logFn(`[pistudio] index: runs error: ${(err && err.message) || err}`);
        return [];
      }
    },

    /** Upsert session rows and refresh their FTS entries. */
    upsertSessions(rows) {
      if (!Array.isArray(rows) || !rows.length) return 0;
      let n = 0;
      try {
        db.exec('BEGIN');
        for (const r of rows) {
          const sessionFile = String(r.session_file || r.path || '');
          if (!sessionFile) continue;
          const title = r.title != null ? String(r.title) : '';
          const preview = r.preview != null ? String(r.preview) : '';
          const body = r.body != null ? String(r.body) : [title, preview].filter(Boolean).join(' ');
          stmts.upsertSession.run(
            sessionFile,
            r.workspace != null ? String(r.workspace) : null,
            r.label != null ? String(r.label) : null,
            title,
            preview,
            r.model != null ? String(r.model) : null,
            Number(r.turns) || 0,
            Number(r.cost) || 0,
            Number(r.tokens_in) || 0,
            Number(r.tokens_out) || 0,
            Number(r.updated_at) || 0,
            Number(r.size) || 0,
            Number(r.mtime) || 0,
          );
          stmts.ftsDelete.run(sessionFile);
          stmts.ftsInsert.run(sessionFile, title, body);
          n += 1;
        }
        if (n) stmts.kvSet.run('indexed_at', String(Date.now()));
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        logFn(`[pistudio] index: upsertSessions error: ${(err && err.message) || err}`);
      }
      return n;
    },

    /** Upsert trace-run rows derived from run-*.jsonl files. */
    upsertRuns(rows) {
      if (!Array.isArray(rows) || !rows.length) return 0;
      let n = 0;
      try {
        db.exec('BEGIN');
        for (const r of rows) {
          const runFile = String(r.run_file || r.path || '');
          if (!runFile) continue;
          stmts.upsertRun.run(
            runFile,
            r.session != null ? String(r.session) : null,
            r.cwd != null ? String(r.cwd) : null,
            r.model != null ? String(r.model) : null,
            r.started_at != null ? Number(r.started_at) : null,
            r.ended_at != null ? Number(r.ended_at) : null,
            Number(r.cost) || 0,
            Number(r.tokens) || 0,
            Number(r.turns) || 0,
            r.status != null ? String(r.status) : null,
            Number(r.mtime) || 0,
            Number(r.size) || 0,
          );
          n += 1;
        }
        if (n) stmts.kvSet.run('indexed_at', String(Date.now()));
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        logFn(`[pistudio] index: upsertRuns error: ${(err && err.message) || err}`);
      }
      return n;
    },

    /** Upsert task + agent rows from server `taskInfo()` objects. */
    upsertTasks(list) {
      if (!Array.isArray(list) || !list.length) return 0;
      let n = 0;
      try {
        db.exec('BEGIN');
        for (const t of list) {
          if (!t || !t.id) continue;
          stmts.upsertTask.run(
            String(t.id),
            t.label != null ? String(t.label) : null,
            t.cwd != null ? String(t.cwd) : null,
            t.status != null ? String(t.status) : null,
            Number(t.createdAt) || Date.now(),
            t.endedAt != null ? Number(t.endedAt) : null,
          );
          n += 1;
          for (const a of Array.isArray(t.agents) ? t.agents : []) {
            const usage = a && a.usage ? a.usage : {};
            const tokens = Number(usage.input || 0) + Number(usage.output || 0);
            const cost =
              typeof usage.cost === 'number'
                ? Number(usage.cost)
                : Number((usage.cost && usage.cost.total) || 0);
            const elapsed =
              a && a.startedAt && a.endedAt ? Math.max(0, Number(a.endedAt) - Number(a.startedAt)) : null;
            stmts.upsertAgent.run(
              String(t.id),
              String(a.id),
              a.name != null ? String(a.name) : null,
              a.model != null ? String(a.model) : null,
              a.status != null ? String(a.status) : null,
              Number(a.turns) || 0,
              tokens,
              cost,
              elapsed,
            );
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        logFn(`[pistudio] index: upsertTasks error: ${(err && err.message) || err}`);
      }
      return n;
    },

    /** Drop every derived row (JSONL remains the source of truth). */
    rebuild() {
      try {
        db.exec('BEGIN');
        db.exec('DELETE FROM sessions_fts');
        db.exec('DELETE FROM sessions');
        db.exec('DELETE FROM runs');
        db.exec('DELETE FROM tasks');
        db.exec('DELETE FROM task_agents');
        db.exec("DELETE FROM kv WHERE key = 'indexed_at'");
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        logFn(`[pistudio] index: rebuild error: ${(err && err.message) || err}`);
      }
    },

    close() {
      if (!db) return;
      try {
        db.close();
      } catch {}
      db = null;
    },
  };

  return adapter;
}

module.exports = { openIndex };
