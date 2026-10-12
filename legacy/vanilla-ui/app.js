'use strict';

/* -------------------------------------------------------------------- i18n */

const I18N = window.PI_I18N || { en: {} };
const LANG_KEY = 'pi-gui-lang';

function detectLang() {
  let stored = null;
  try {
    stored = localStorage.getItem(LANG_KEY);
  } catch {}
  if (stored && I18N[stored]) return stored;
  const nav = String(navigator.language || 'en').toLowerCase();
  for (const code of Object.keys(I18N)) if (nav.startsWith(code)) return code;
  return 'en';
}

let lang = detectLang();

function t(key, vars) {
  const dict = I18N[lang] || {};
  let s = dict[key];
  if (s == null) {
    // surfacing these is the whole point: a typo would otherwise render as the key
    try {
      window.__i18nFallback = window.__i18nFallback || {};
      const bucket = (window.__i18nFallback[lang] = window.__i18nFallback[lang] || []);
      if (!bucket.includes(key)) bucket.push(key);
    } catch {}
    s = (I18N.en || {})[key];
  }
  if (s == null) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  return s;
}

/** plural helper: tp('a.one', 'a.other', n, vars) */
function tp(oneKey, otherKey, n, vars) {
  return t(n === 1 ? oneKey : otherKey, { n, ...(vars || {}) });
}

function setLang(next) {
  lang = I18N[next] ? next : 'en';
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {}
  applyI18n();
  refreshI18n();
}

/** static markup: [data-i18n], [data-i18n-placeholder], [data-i18n-title] */
function applyI18n() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', el.title);
  }
  const app = $('#app');
  if (app) app.dataset.offlineLabel = t('toolbar.offline');
  const btn = $('#btn-lang');
  if (btn) {
    btn.textContent = lang === 'zh' ? 'EN' : '中';
    btn.title = lang === 'zh' ? 'Switch to English' : '切换到中文';
    btn.setAttribute('aria-label', btn.title);
  }
  const themeBtn = $('#btn-theme');
  if (themeBtn) themeBtn.textContent = resolveTheme(themeMode) === 'light' ? '☀️' : '🌙';
  for (const el of document.querySelectorAll('.trace-jump')) {
    el.textContent = t('chat.traceJump');
    el.title = t('chat.traceJumpTitle');
  }
  // notices remember the key they were rendered from
  for (const el of document.querySelectorAll('[data-i18n-notice]')) {
    let vars = null;
    try {
      vars = el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : null;
    } catch {}
    const body = el.querySelector('.md');
    if (body) body.textContent = t(el.dataset.i18nNotice, vars);
  }
}

/** re-render everything that is built from JS after a language switch */
function refreshI18n() {
  applyI18n();
  // blocks built from JS carry translated labels ("thinking", badges, copy)
  for (const msg of state.msgs) {
    for (const b of msg.blocks || []) {
      if (b.type === 'thinking' || b.type === 'toolCall') updateBlock(b);
    }
  }
  for (const pre of chat.querySelectorAll('pre')) decoratePre(pre);
  if (!chgEl.classList.contains('hidden')) renderChanges();
  if (!inspEl.classList.contains('hidden')) renderInspect();
  syncAgentSelect();
  if (trace.raw.length) traceRebuild();
  if (lastTree.length) renderTree(lastTree, lastLeafId);
  if (sessionCache.length) renderSessionList();
  renderSessionInfo();
  updateSelectionButtons();
  refreshUserActions();
  refreshStats();
  if (lastStatus) {
    if (lastStatus.key) setStatusK(lastStatus.key, lastStatus.vars, lastStatus.kind);
    else setStatus(lastStatus.text, lastStatus.kind);
  }
}

/* -------------------------------------------------------------- api client */

/**
 * Every browser tab gets its own pi process. The id lives in sessionStorage so
 * a reload stays on the same session while a new tab starts an independent one.
 */
const CLIENT_ID = (() => {
  try {
    let id = sessionStorage.getItem('pi-gui-client');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('pi-gui-client', id);
    }
    return id;
  } catch {
    return 'default';
  }
})();

/** Only set when the server is bound beyond loopback (see --host). */
const AUTH_TOKEN = (() => {
  try {
    const fromUrl = new URLSearchParams(location.search).get('token');
    if (fromUrl) {
      sessionStorage.setItem('pi-gui-token', fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem('pi-gui-token') || '';
  } catch {
    return '';
  }
})();

/** Append the session id (and token, when the server requires one). */
function api(path) {
  let out = path + (path.includes('?') ? '&' : '?') + 'c=' + encodeURIComponent(CLIENT_ID);
  if (AUTH_TOKEN) out += '&token=' + encodeURIComponent(AUTH_TOKEN);
  return out;
}

/** Keep Tab inside a dialog and hand focus back on close. */
function trapFocus(container) {
  const selector =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const onKey = (ev) => {
    if (ev.key !== 'Tab') return;
    const items = [...container.querySelectorAll(selector)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

/** role=dialog + aria-modal + focus trap + focus restore for any modal shell. */
function makeDialogA11y(backdrop, modal, labelId) {
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  if (labelId) modal.setAttribute('aria-labelledby', labelId);
  const previouslyFocused = document.activeElement;
  const release = trapFocus(modal);
  const focusFirst = () => {
    const target = modal.querySelector(
      'input:not([disabled]), textarea:not([disabled]), button.primary, button:not([disabled])',
    );
    target?.focus();
  };
  setTimeout(focusFirst, 0);
  return () => {
    release();
    try {
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    } catch {}
  };
}

/* ------------------------------------------------------------------ utils */

const $ = (s) => document.querySelector(s);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Minimal markdown: code fences, headings, lists, tables, quotes, links. */
function md(src) {
  if (src == null) return '';
  const parts = String(src).split('```');
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      let body = parts[i];
      let lang = '';
      const nl = body.indexOf('\n');
      if (nl !== -1 && !body.slice(0, nl).includes(' ')) {
        lang = body.slice(0, nl).trim();
        body = body.slice(nl + 1);
      }
      let code = body.replace(/\n$/, '');
      // fenced json is almost always a payload — make it readable
      if (/^json$/i.test(lang)) code = prettyJson(code) ?? code;
      const label = lang ? `<span class="code-lang">${esc(lang)}</span>` : '';
      out += `<div class="codeblock">${label}<pre class="code"><code>${highlightCode(code, lang)}</code></pre></div>`;
    } else {
      out += blockMd(parts[i]);
    }
  }
  return out;
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function tableHtml(header, rows) {
  const head = header.map((h) => `<th>${inlineMd(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Block-level markdown. Block tags are emitted without stray newlines so the
 *  container's `white-space: pre-wrap` cannot introduce phantom blank lines. */
function blockMd(text) {
  const lines = String(text).split('\n');
  const out = [];
  const para = [];
  const flush = () => {
    if (!para.length) return;
    out.push(`<p>${para.join('\n')}</p>`);
    para.length = 0;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // table: header row followed by a |---|---| separator
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flush();
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      out.push(tableHtml(header, rows));
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const lvl = h[1].length;
      out.push(`<h${lvl} class="md-h md-h${lvl}">${inlineMd(h[2])}</h${lvl}>`);
      i += 1;
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flush();
      out.push('<hr class="md-hr">');
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote class="md-quote">${inlineMd(buf.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i += 1;
      }
      const li = items.map((t) => `<li>${inlineMd(t)}</li>`).join('');
      out.push(ordered ? `<ol class="md-list">${li}</ol>` : `<ul class="md-list">${li}</ul>`);
      continue;
    }

    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }

    para.push(inlineMd(line));
    i += 1;
  }
  flush();
  return out.join('');
}

function inlineMd(text) {
  let t = esc(text);
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return t;
}

/** Pretty-print a JSON string, or null when it is not JSON. */
function prettyJson(text) {
  const trimmed = String(text).trim();
  if (!/^[[{]/.test(trimmed)) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object') return null;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------ syntax highlight */

/**
 * Zero-dependency highlighting. Each language is a list of sticky regexes tried
 * in order at the current offset; anything unmatched is emitted as plain text,
 * so this can never produce broken markup.
 */
const HL_KEYWORDS = {
  js: 'const let var function return if else for while do break continue new class extends super this typeof instanceof in of delete void yield await async try catch finally throw switch case default import export from as static get set null undefined true false',
  py: 'def class return if elif else for while break continue import from as pass raise try except finally with lambda None True False and or not in is global nonlocal yield async await del assert',
  go: 'package import func var const type struct interface return if else for range break continue go defer chan map make new nil true false switch case default select',
  rust: 'fn let mut const struct enum impl trait for while loop if else match return use mod pub crate self super where async await move ref dyn box true false Some None Ok Err',
  java: 'public private protected class interface extends implements new return if else for while do switch case default break continue import package static final void int long double float boolean char String try catch finally throw throws this super null true false',
  sql: 'select from where insert update delete into values join left right inner outer on group by order having limit offset create table drop alter index as and or not null distinct count sum avg min max union',
};

function cLikeRules(keywords) {
  const kw = new RegExp(`\\b(?:${keywords.split(/\s+/).filter(Boolean).join('|')})\\b`, 'y');
  return [
    ['c', /\/\/[^\n]*/y],
    ['c', /\/\*[\s\S]*?\*\//y],
    ['s', /`(?:[^`\\]|\\.)*`/y],
    ['s', /'(?:[^'\\\n]|\\.)*'/y],
    ['s', /"(?:[^"\\\n]|\\.)*"/y],
    ['n', /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
    ['k', kw],
    ['f', /[A-Za-z_$][\w$]*(?=\s*\()/y],
    ['p', /[{}()\[\];,.:=+\-*/%<>!&|?~^@]+/y],
  ];
}

function rulesFor(lang) {
  const l = String(lang || '').toLowerCase();
  if (l === 'json' || l === 'jsonc') {
    return [
      ['k', /"(?:[^"\\]|\\.)*"(?=\s*:)/y],
      ['s', /"(?:[^"\\]|\\.)*"/y],
      ['n', /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
      ['c', /\b(?:true|false|null)\b/y],
      ['p', /[{}\[\],:]/y],
    ];
  }
  if (l === 'diff' || l === 'patch') {
    return [
      ['c', /^@@[^\n]*/my],
      ['f', /^\+\+\+[^\n]*/my],
      ['f', /^---[^\n]*/my],
      ['a', /^\+[^\n]*/my],
      ['d', /^-[^\n]*/my],
    ];
  }
  if (l === 'yaml' || l === 'yml' || l === 'toml' || l === 'ini') {
    return [
      ['c', /#[^\n]*/y],
      ['k', /^[ \t]*[\w.$-]+(?=\s*[:=])/my],
      ['s', /'(?:[^'\\\n]|\\.)*'/y],
      ['s', /"(?:[^"\\\n]|\\.)*"/y],
      ['n', /\b\d+(?:\.\d+)?\b/y],
      ['p', /[-:,\[\]{}]/y],
    ];
  }
  if (l === 'bash' || l === 'sh' || l === 'shell' || l === 'zsh' || l === 'console') {
    return [
      ['c', /#[^\n]*/y],
      ['s', /'(?:[^'\\\n]|\\.)*'/y],
      ['s', /"(?:[^"\\\n]|\\.)*"/y],
      ['v', /\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\$[0-9?@#$!*-]/y],
      ['k', /\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|return|export|local|source|set|unset|exit|echo|printf|read)\b/y],
      ['n', /\b\d+\b/y],
      ['p', /[|&;(){}<>=]/y],
    ];
  }
  if (l === 'html' || l === 'xml' || l === 'svg' || l === 'vue') {
    return [
      ['c', /<!--[\s\S]*?-->/y],
      ['t', /<\/?[A-Za-z][\w:-]*/y],
      ['a', /[A-Za-z_:][\w:.-]*(?==)/y],
      ['s', /"(?:[^"\\]|\\.)*"/y],
      ['s', /'(?:[^'\\]|\\.)*'/y],
      ['p', /[<>/=]/y],
    ];
  }
  if (l === 'css' || l === 'scss' || l === 'less') {
    return [
      ['c', /\/\*[\s\S]*?\*\//y],
      ['k', /@[\w-]+/y],
      ['a', /[.#][\w-]+/y],
      ['f', /[\w-]+(?=\s*:)/y],
      ['s', /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/y],
      ['n', /-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?/y],
      ['p', /[{}();:,>+~*]/y],
    ];
  }
  if (l === 'py' || l === 'python') {
    return [
      ['c', /#[^\n]*/y],
      ['s', /"""[\s\S]*?"""/y],
      ['s', /'{3}[\s\S]*?'{3}/y],
      ['s', /f?"(?:[^"\\\n]|\\.)*"/y],
      ['s', /f?'(?:[^'\\\n]|\\.)*'/y],
      ['a', /@[\w.]+/y],
      ['n', /\b\d+(?:\.\d+)?\b/y],
      ['k', new RegExp(`\\b(?:${HL_KEYWORDS.py.split(/\s+/).join('|')})\\b`, 'y')],
      ['f', /[A-Za-z_]\w*(?=\s*\()/y],
      ['p', /[{}()\[\];,.:=+\-*/%<>!&|]+/y],
    ];
  }
  if (l === 'sql') {
    return [
      ['c', /--[^\n]*/y],
      ['s', /'(?:[^'\\\n]|\\.)*'/y],
      ['k', new RegExp(`\\b(?:${HL_KEYWORDS.sql.split(/\s+/).join('|')})\\b`, 'iy')],
      ['n', /\b\d+(?:\.\d+)?\b/y],
      ['p', /[();,.*=<>]/y],
    ];
  }
  if (/^(?:js|jsx|ts|tsx|mjs|cjs|javascript|typescript|json5)$/.test(l)) return cLikeRules(HL_KEYWORDS.js);
  if (/^(?:go|golang)$/.test(l)) return cLikeRules(HL_KEYWORDS.go);
  if (/^(?:rs|rust)$/.test(l)) return cLikeRules(HL_KEYWORDS.rust);
  if (/^(?:java|kt|kotlin)$/.test(l)) return cLikeRules(HL_KEYWORDS.java);
  if (/^(?:c|cpp|cc|h|hpp|cs|swift|php|scala)$/.test(l)) return cLikeRules(HL_KEYWORDS.java);
  return null;
}

const HL_MAX = 200_000;

function highlightCode(code, lang) {
  const src = String(code ?? '');
  const rules = src.length > HL_MAX ? null : rulesFor(lang);
  if (!rules) return esc(src);
  let out = '';
  let plain = '';
  let i = 0;
  const flush = () => {
    if (plain) {
      out += esc(plain);
      plain = '';
    }
  };
  while (i < src.length) {
    let hit = null;
    for (const rule of rules) {
      rule[1].lastIndex = i;
      const m = rule[1].exec(src);
      if (m && m[0]) {
        hit = [rule[0], m[0]];
        break;
      }
    }
    if (hit) {
      flush();
      out += `<span class="tok-${hit[0]}">${esc(hit[1])}</span>`;
      i += hit[1].length;
    } else {
      plain += src[i];
      i += 1;
    }
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ ansi */

const ANSI_FG = {
  30: 'var(--muted)', 31: 'var(--danger)', 32: 'var(--ok)', 33: 'var(--warn)',
  34: 'var(--blue)', 35: 'var(--purple)', 36: 'var(--teal)', 37: 'var(--text)',
  90: 'var(--faint)', 91: 'var(--danger)', 92: 'var(--ok)', 93: 'var(--warn)',
  94: 'var(--blue)', 95: 'var(--purple)', 96: 'var(--teal)', 97: 'var(--text)',
};

const ANSI_RE = /\u001b\[([0-9;]*)m/g;

/** Turn SGR escape codes into spans so `ls --color`, logs and test output stay readable. */
function ansiToHtml(text) {
  let html = '';
  let last = 0;
  let style = {};
  const emit = (chunk) => {
    if (!chunk) return;
    const css = [];
    if (style.bold) css.push('font-weight:700');
    if (style.fg) css.push(`color:${style.fg}`);
    html += css.length ? `<span style="${css.join(';')}">${esc(chunk)}</span>` : esc(chunk);
  };
  for (const m of String(text).matchAll(ANSI_RE)) {
    emit(text.slice(last, m.index));
    last = m.index + m[0].length;
    const codes = m[1].split(';').filter(Boolean).map(Number);
    if (!codes.length || codes.includes(0)) style = {};
    for (const c of codes) {
      if (c === 1) style.bold = true;
      else if (c === 22) style.bold = false;
      else if (c === 39) style.fg = null;
      else if (ANSI_FG[c]) style.fg = ANSI_FG[c];
    }
  }
  emit(text.slice(last));
  return html;
}

function fmtTokens(n) {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}

/** Money people can read: never a misleading "$0.0000". */
function fmtCost(c) {
  const n = Number(c) || 0;
  if (n <= 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtDur(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60_000) return (ms / 1000).toFixed(ms < 10_000 ? 2 : 1) + 's';
  const m = Math.floor(ms / 60000);
  return m + 'm' + Math.round((ms % 60000) / 1000) + 's';
}

function shortJson(v, max = 90) {
  if (v == null) return '';
  let s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  s = s.replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function extractText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  const content = result.content ?? result;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && c.type === 'text' ? c.text : c && c.type === 'image' ? '[image]' : typeof c === 'string' ? c : JSON.stringify(c)))
      .join('\n');
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function send(cmd, opts = {}) {
  const attempts = opts.attempts ?? 4;
  const silent = !!opts.silent;
  let lastErr = null;

  const attempt = (n) =>
    fetch(api('/api/command'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((j) => {
        setOnline(true);
        return j;
      })
      .catch(async (err) => {
        lastErr = err;
        if (n < attempts) {
          await new Promise((res) => setTimeout(res, 250 * n));
          return attempt(n + 1);
        }
        setOnline(false);
        if (!silent) {
          notice(t('fatal.serverHint', { msg: err.message }) + '\n' + t('fatal.serverCheck'), 'error');
        }
        return null;
      });

  return attempt(1);
}

function setOnline(online) {
  if (state.online === online) return;
  state.online = online;
  document.getElementById('app')?.classList.toggle('offline', !online);
  if (!online) setStatusK('status.serverUnreachable', null, 'error');
  else if (!state.streaming) setStatusK('status.ready', null, 'ok');
}

function postJson(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).catch(() => {});
}

/* ------------------------------------------------------------------ dom */

const chat = $('#chat');
const input = $('#input');
const btnSend = $('#btn-send');
const btnStop = $('#btn-stop');
const btnNew = $('#btn-new');
const modelSel = $('#model');
const thinkSel = $('#thinking');
const statusEl = $('#status');
const extStatusEl = $('#ext-status');
const statsEl = $('#stats');
const cwdEl = $('#cwd');
const tracePanel = $('#trace');
const traceList = $('#trace-list');
const traceFileEl = $('#trace-file');
const traceDeltasEl = $('#trace-deltas');
const traceFollowEl = $('#trace-follow');
const traceHistoryEl = $('#trace-history');
const bodyEl = $('#body');
const widgetsAbove = $('#widgets-above');
const widgetsBelow = $('#widgets-below');
const modalRoot = $('#modal-root');
const toastsEl = $('#toasts');
const runStateEl = $('#run-state');
const acEl = $('#ac');
const histHintEl = $('#hist-hint');
const sessionsEl = $('#sessions');
const attachmentsEl = $('#attachments');
const fileInput = $('#file-input');

/* ------------------------------------------------------------------ toasts */

function toast(message, type = 'info', ms = 5200) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'warning' || type === 'error' ? type : '');
  el.textContent = message;
  toastsEl.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ------------------------------------------------------------------ chat */

const state = {
  msgs: [],
  liveAssistant: null,
  toolBlocks: new Map(),
  streaming: false,
  models: [],
  currentModel: null,
  ready: false,
  online: true,
  lastUserMsg: null,
  pendingUser: null,
  sessionId: null,
  sessionName: null,
  sessionFile: null,
  attachments: [],
  commands: [],
  allMessages: [],
  windowSize: 30,
  lastUsage: null,
  agents: [],
  inspectAgent: 'main',
  inspect: [],
  inspectSizes: [],
  inspectBytes: 0,
  entries: [],
  leafId: null,
  lastSeq: 0,
  cwd: '',
};

const PAGE_SIZE = 30;

let autoScroll = true;
const toLatestEl = $('#to-latest');

function updateToLatest() {
  if (toLatestEl) toLatestEl.classList.toggle('on', !autoScroll);
}

chat.addEventListener('scroll', () => {
  autoScroll = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  updateToLatest();
});
function toBottom(force) {
  if (force || autoScroll) chat.scrollTop = chat.scrollHeight;
}
toLatestEl?.addEventListener('click', () => {
  autoScroll = true;
  chat.scrollTop = chat.scrollHeight;
  updateToLatest();
});

function addMessage(role, opts = {}) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  if (opts.className) el.classList.add(...String(opts.className).split(/\s+/).filter(Boolean));
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  el.appendChild(bubble);
  chat.appendChild(el);
  const msg = { id: opts.id || 'm' + Math.random().toString(36).slice(2), role, el, bubble, blocks: [] };
  state.msgs.push(msg);
  // a real conversation makes the "no messages yet" placeholder obsolete
  if ((role === 'user' || role === 'assistant') && emptyNotice) {
    emptyNotice.el.remove();
    emptyNotice = null;
  }
  toBottom();
  return msg;
}

function notice(text, kind = '') {
  const msg = addMessage('system');
  if (kind) msg.el.classList.add(kind);
  const d = document.createElement('div');
  d.className = 'md';
  d.textContent = text;
  msg.bubble.appendChild(d);
  toBottom();
  return msg;
}

/** translated notice; remembers the key so a language switch can re-render it */
function noticeT(key, vars, kind = '') {
  const msg = notice(t(key, vars), kind);
  msg.el.dataset.i18nNotice = key;
  if (vars) msg.el.dataset.i18nVars = JSON.stringify(vars);
  return msg;
}

/** Placeholder shown for an empty session; removed by the first real message. */
let emptyNotice = null;

/** First-run affordances: the palette, @/ and the panels are otherwise invisible. */
function firstRunHint() {
  const msg = addMessage('system');
  msg.el.classList.add('first-run-host');
  const box = document.createElement('div');
  box.className = 'first-run';
  const title = document.createElement('h4');
  title.textContent = t('firstRun.title');
  const ul = document.createElement('ul');
  for (const line of [t('firstRun.keyboard'), t('firstRun.files'), t('firstRun.panels'), t('firstRun.input')]) {
    const li = document.createElement('li');
    li.innerHTML = line; // trusted, translated markup with <kbd>
    ul.appendChild(li);
  }
  box.append(title, ul);
  msg.bubble.appendChild(box);
  emptyNotice = msg;
  toBottom();
}

/* -------------------------------------------------------------- blocks */

function addBlock(msg, block) {
  block.msg = msg;
  msg.blocks.push(block);
  block.node = buildBlockNode(block);
  msg.bubble.appendChild(block.node);
  toBottom();
  return block;
}

/** Split markdown into chunks that only change at the tail while streaming.
 *  Chunks are slices of the original string, so `chunks.join('') === source`
 *  holds exactly — no whitespace is ever lost or invented. */
function mdChunks(text) {
  const src = String(text ?? '');
  if (!src) return [];
  const out = [];
  let start = 0;
  let pos = 0;
  let inFence = false;
  for (const line of src.split('\n')) {
    pos += line.length + 1; // +1 for the newline this line consumed
    const isFence = /^\s*```/.test(line);
    if (isFence) {
      inFence = !inFence;
      if (!inFence) {
        const end = Math.min(pos, src.length);
        out.push(src.slice(start, end));
        start = end;
      }
      continue;
    }
    if (!inFence && !line.trim()) {
      const end = Math.min(pos, src.length);
      if (end > start) out.push(src.slice(start, end));
      start = end;
    }
  }
  if (start < src.length) out.push(src.slice(start));
  return out;
}

/** Repaint only the chunks whose source changed — the whole point is that a
 *  streaming reply must not re-parse its entire markdown on every frame. */
function renderMdChunks(block, container) {
  const chunks = mdChunks(block.text);
  if (!block._chunkSrc) {
    block._chunkSrc = [];
    block._chunkNodes = [];
  }
  for (let i = 0; i < chunks.length; i += 1) {
    let node = block._chunkNodes[i];
    if (block._chunkSrc[i] !== chunks[i] || !node) {
      if (!node) {
        node = document.createElement('div');
        node.className = 'md-chunk';
        container.appendChild(node);
        block._chunkNodes[i] = node;
      }
      node.innerHTML = md(chunks[i]);
      block._chunkSrc[i] = chunks[i];
      if (!block.streaming) decoratePres(node);
    }
  }
  while (block._chunkNodes.length > chunks.length) {
    block._chunkNodes.pop().remove();
    block._chunkSrc.pop();
  }
}

function buildBlockNode(block) {
  if (block.type === 'text') {
    const d = document.createElement('div');
    d.className = 'md';
    renderMdChunks(block, d);
    block._md = d;
    return d;
  }
  if (block.type === 'thinking') {
    const det = document.createElement('details');
    det.className = 'thinking';
    if (block.streaming) det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = t('chat.thinking');
    const d = document.createElement('div');
    d.className = 'md';
    d.textContent = block.text || '';
    det.append(sum, d);
    block._md = d;
    block._summary = sum;
    return det;
  }
  if (block.type === 'image') {
    const img = document.createElement('img');
    img.className = 'msg-image';
    img.src = `data:${block.mimeType || 'image/png'};base64,${block.data}`;
    img.alt = 'attachment';
    return img;
  }
  const det = document.createElement('details');
  det.className = 'tool';
  const sum = document.createElement('summary');
  const name = document.createElement('span');
  name.className = 'tool-name';
  const hint = document.createElement('span');
  hint.className = 'tool-hint';
  const stat = document.createElement('span');
  stat.className = 'tool-stat';
  const badge = document.createElement('span');
  badge.className = 'tool-badge';
  sum.append(name, hint, stat, badge);
  const preArgs = document.createElement('pre');
  preArgs.className = 'args';
  const preOut = document.createElement('pre');
  preOut.className = 'out';
  det.append(sum, preArgs, preOut);
  block._name = name;
  block._hint = hint;
  block._stat = stat;
  block._badge = badge;
  block._args = preArgs;
  block._out = preOut;
  return det;
}

function updateBlock(block) {
  if (!block.node) return;
  if (block.type === 'text') {
    if (block._md) renderMdChunks(block, block._md);
  } else if (block.type === 'thinking') {
    if (block._md) block._md.textContent = block.text || '';
    if (block._summary) block._summary.textContent = block.streaming ? t('chat.thinking') : t('chat.thinkingDone');
  } else if (block.type === 'toolCall') {
    updateTool(block);
  }
  toBottom();
}

/* Batches streaming deltas into one DOM update per animation frame — without
   this, a long reply re-parses its whole markdown on every token. */
const dirtyBlocks = new Set();
let renderQueued = false;

function scheduleBlockRender(block) {
  dirtyBlocks.add(block);
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    for (const b of dirtyBlocks) updateBlock(b);
    dirtyBlocks.clear();
    toBottom();
  });
}

/* ------------------------------------------------------- code decorations */

function lineCountOf(pre) {
  const diffLines = pre.querySelectorAll('.diff-line').length;
  if (diffLines) return diffLines;
  return (pre.textContent || '').split('\n').length;
}

function decoratePre(pre) {
  if (!pre) return;
  if (pre.dataset.decorated === '1') {
    // already wrapped: a language switch must still relabel the buttons
    const wrap = pre.parentNode;
    const copy = wrap && wrap.querySelector(':scope > .copy-btn');
    const expand = wrap && wrap.querySelector(':scope > .expand-btn');
    if (copy && !copy.dataset.busy) copy.textContent = t('common.copy');
    if (expand) {
      const n = lineCountOf(pre);
      expand.textContent = pre.classList.contains('clamped') ? t('common.expandLines', { n }) : t('common.collapse');
    }
    return;
  }
  const parent = pre.parentNode;
  if (!parent) return;
  pre.dataset.decorated = '1';

  const wrap = document.createElement('div');
  wrap.className = 'codewrap';
  parent.insertBefore(wrap, pre);
  wrap.appendChild(pre);

  const copy = document.createElement('button');
  copy.className = 'copy-btn';
  copy.textContent = t('common.copy');
  copy.title = t('common.copyTitle');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.innerText);
      copy.textContent = t('common.copied');
      setTimeout(() => {
        copy.textContent = t('common.copy');
      }, 1200);
    } catch {}
  });
  wrap.appendChild(copy);

  const lines = lineCountOf(pre);
  if (lines > 40) {
    pre.classList.add('clamped');
    const expand = document.createElement('button');
    expand.className = 'expand-btn';
    expand.textContent = t('common.expandLines', { n: lines });
    expand.addEventListener('click', () => {
      const clamped = pre.classList.toggle('clamped');
      expand.textContent = clamped ? t('common.expandLines', { n: lines }) : t('common.collapse');
    });
    wrap.appendChild(expand);
  }
}

function decoratePres(root) {
  if (!root) return;
  for (const pre of root.querySelectorAll('pre')) decoratePre(pre);
}

function toolHintText(block) {
  const a = block.args || {};
  const name = String(block.name || '').toLowerCase();
  if (name === 'bash' || name === 'powershell' || a.command) return a.command || '';
  if (name === 'grep' && a.pattern) return `${a.pattern}${a.path ? '  in ' + a.path : ''}`;
  if (name === 'find' && a.pattern) return a.pattern;
  if (a.path) {
    const bits = [a.path];
    if (a.offset || a.limit) bits.push(`offset=${a.offset ?? 0}${a.limit ? ` limit=${a.limit}` : ''}`);
    return bits.join('  ');
  }
  if (a.pattern) return a.pattern;
  return shortJson(a);
}

/** pi's edit tool already ships a display-oriented diff in result.details */
function diffStats(diff) {
  let add = 0;
  let del = 0;
  for (const line of String(diff).split('\n')) {
    if (line.startsWith('+')) add += 1;
    else if (line.startsWith('-')) del += 1;
  }
  return { add, del };
}

/** ripgrep-style `path:line:content` (also produced by bash searches). */
function looksLikeGrep(text) {
  const lines = String(text).split('\n').filter(Boolean).slice(0, 24);
  if (!lines.length) return false;
  const hits = lines.filter((l) => /^[^\s:][^:]*:\d+(?::\d+)?:/.test(l)).length;
  return hits >= Math.max(1, Math.ceil(lines.length * 0.7));
}

function renderGrepBody(pre, text) {
  const groups = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^([^:]+):(\d+)(?::(\d+))?:(.*)$/.exec(line);
    if (!m) continue;
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push({ ln: Number(m[2]), text: m[4] });
  }
  if (!groups.size) return false;
  let html = '';
  for (const [file, hits] of groups) {
    html += `<div class="grep-file">${esc(file)}<span class="insp-flag">${hits.length}</span></div>`;
    for (const h of hits.slice(0, 40)) {
      html += `<div class="grep-hit"><span class="grep-ln">${h.ln}</span><span>${esc(h.text)}</span></div>`;
    }
    if (hits.length > 40) html += `<div class="grep-more">… ${hits.length - 40} more</div>`;
  }
  pre.innerHTML = html;
  return groups.size;
}

function renderReadBody(pre, text) {
  const lines = String(text).split('\n');
  const numbered = lines.slice(0, 6).some((l) => /^\s*\d+[\u2192\t|]/.test(l));
  if (numbered) {
    pre.textContent = text;
    return lines.length;
  }
  pre.innerHTML = lines
    .map((l, i) => `<div class="read-line"><span class="read-ln">${i + 1}</span><span>${esc(l) || '&nbsp;'}</span></div>`)
    .join('');
  return lines.length;
}

function renderListBody(pre, text) {
  const lines = String(text).split('\n').filter(Boolean);
  pre.innerHTML = lines.map((l) => `<div class="list-line">${esc(l)}</div>`).join('');
  return lines.length;
}

function renderToolBody(block) {
  const pre = block._out;
  if (!pre) return;
  const name = String(block.name || '').toLowerCase();
  const diff = block.details && typeof block.details.diff === 'string' ? block.details.diff : null;
  const out = block.result ?? block.partial ?? '';

  // every tool gets the renderer that fits it, falling back to plain text
  if (!block.isError) {
    if (name === 'read' && out) {
      pre.className = 'out';
      renderReadBody(pre, out);
      return;
    }
    if ((name === 'grep' || name === 'bash' || name === 'powershell') && out && looksLikeGrep(out)) {
      pre.className = 'out';
      if (renderGrepBody(pre, out)) return;
    }
    if ((name === 'find' || name === 'ls') && out) {
      pre.className = 'out';
      renderListBody(pre, out);
      return;
    }
    if (name === 'write') {
      const content = String((block.args && block.args.content) || '');
      if (content) {
        const lines = content.split('\n');
        const shown = lines.slice(0, 80);
        pre.className = 'out';
        pre.innerHTML =
          shown.map((l) => `<div class="diff-line diff-add">+ ${esc(l)}</div>`).join('') +
          (lines.length > shown.length
            ? `<div class="diff-line diff-hunk">… ${lines.length - shown.length} more lines</div>`
            : '');
        return;
      }
    }
  }

  if (name === 'edit' && diff) {
    pre.className = 'out' + (block.isError ? ' error' : '');
    pre.innerHTML = diff
      .split('\n')
      .map((line) => {
        const cls = line.startsWith('+')
          ? 'diff-add'
          : line.startsWith('-')
            ? 'diff-del'
            : line.startsWith('@@')
              ? 'diff-hunk'
              : '';
        return `<div class="diff-line ${cls}">${esc(line) || '&nbsp;'}</div>`;
      })
      .join('');
    return;
  }

  const text = block.result ?? block.partial ?? '';

  // raw escape codes in bash output (ls --color, test runners, logs)
  if (ANSI_RE.test(text)) {
    ANSI_RE.lastIndex = 0;
    pre.className = 'out' + (block.isError ? ' error' : '');
    pre.innerHTML = ansiToHtml(text);
    return;
  }
  ANSI_RE.lastIndex = 0;

  // a JSON payload (read on a .json file, an API response, …)
  const pretty = name === 'read' || name === 'bash' || name === 'powershell' ? prettyJson(text) : null;
  if (pretty) {
    pre.className = 'out' + (block.isError ? ' error' : '');
    pre.textContent = pretty;
    return;
  }

  pre.className = 'out' + (block.isError ? ' error' : '');
  pre.textContent = text;
}

function updateTool(block) {
  if (!block.node) return;
  const status = block.status || 'pending';
  if (block._name) block._name.textContent = block.name || t('label.tool');
  if (block._hint) block._hint.textContent = toolHintText(block) || '';
  if (block._badge) {
    block._badge.textContent = t('badge.' + status);
    block._badge.className =
      'tool-badge ' + (status === 'running' ? 'running' : status === 'done' ? 'done' : status === 'error' ? 'error' : '');
  }

  const diff = block.details && typeof block.details.diff === 'string' ? block.details.diff : null;
  if (block._stat) {
    if (diff) {
      const st = diffStats(diff);
      block._stat.innerHTML = `<span class="add">+${st.add}</span> <span class="del">−${st.del}</span>`;
    } else if (String(block.name || '').toLowerCase() === 'write') {
      const lines = String((block.args && block.args.content) || '').split('\n').length;
      block._stat.innerHTML = lines ? `<span class="add">+${lines}</span>` : '';
    } else if (block.result) {
      const n = String(block.result).split('\n').length;
      block._stat.textContent = n > 1 ? `${n} lines` : '';
    } else {
      block._stat.textContent = '';
    }
  }

  if (block._args) block._args.textContent = block.argsText || '';
  renderToolBody(block);
  if (status === 'done' || status === 'error') decoratePre(block._out);

  if (block.node.tagName === 'DETAILS') {
    if (status === 'running') block.node.open = true;
    else if (status === 'done' && !block.node.dataset.touched) block.node.open = false;
  }
}

/* ------------------------------------------------------- normalization */

function contentBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content
    .map((c) => {
      if (!c || typeof c !== 'object') return { type: 'text', text: String(c ?? '') };
      if (c.type === 'text') return { type: 'text', text: c.text ?? '' };
      if (c.type === 'thinking') return { type: 'thinking', text: c.thinking ?? c.text ?? '' };
      if (c.type === 'toolCall')
        return {
          type: 'toolCall',
          id: c.id,
          name: c.name,
          args: c.arguments,
          argsText: JSON.stringify(c.arguments ?? {}, null, 2),
          status: 'pending',
        };
      if (c.type === 'image') return { type: 'image', data: c.data, mimeType: c.mimeType };
      return { type: 'text', text: JSON.stringify(c) };
    })
    .filter(Boolean);
}

/* ================================================================== dock */

/**
 * The right-hand dock replaced the Trace side panel and the Changes modal: the
 * transcript, what pi sent, what the files look like now and what is in the
 * context are all a glance away instead of behind a dialog. Tabs, a draggable
 * width, and every view keeps its own scroll position.
 */
const dockEl = $('#trace');
const dockTabsEl = $('#dock-tabs');
const dockPaneTrace = $('#dock-pane-trace');
const dockPaneChanges = $('#dock-pane-changes');
const dockPaneContext = $('#dock-pane-context');
const dockContextBody = $('#dock-context-body');
const DOCK_KEY = 'pi-gui-dock';
const DOCK_MIN = 320;
const DOCK_MAX = 820;

let dockTab = 'trace';

function dockPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_KEY) || '{}');
    return {
      width: Math.min(DOCK_MAX, Math.max(DOCK_MIN, Number(raw.width) || 420)),
      tab: ['trace', 'changes', 'context'].includes(raw.tab) ? raw.tab : 'trace',
    };
  } catch {
    return { width: 420, tab: 'trace' };
  }
}

function dockSavePrefs() {
  try {
    const width = parseInt(getComputedStyle(bodyEl).getPropertyValue('--dock-w'), 10) || 420;
    localStorage.setItem(DOCK_KEY, JSON.stringify({ width, tab: dockTab }));
  } catch {}
}

function dockIsOpen() {
  return !dockEl.classList.contains('hidden');
}

const DOCK_PANES = () => ({ trace: dockPaneTrace, changes: dockPaneChanges, context: dockPaneContext });

function dockSetTab(name) {
  if (!DOCK_PANES()[name]) return;
  dockTab = name;
  for (const [key, pane] of Object.entries(DOCK_PANES())) pane.classList.toggle('hidden', key !== name);
  for (const btn of dockTabsEl.querySelectorAll('.tab')) {
    const on = btn.dataset.dock === name;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  }
  if (name === 'trace') {
    if (trace.rows.some((r) => !r.el)) traceRebuild();
    traceFollow();
  } else if (name === 'changes') {
    loadChanges(true);
  } else {
    renderDockContext();
  }
  dockSavePrefs();
}

function dockOpen(name) {
  dockEl.classList.remove('hidden');
  bodyEl.classList.add('with-trace');
  $('#btn-trace')?.classList.add('active');
  $('#btn-changes')?.classList.toggle('active', name === 'changes');
  dockSetTab(name || dockTab);
}

function dockClose() {
  dockEl.classList.add('hidden');
  bodyEl.classList.remove('with-trace');
  $('#btn-trace')?.classList.remove('active');
  $('#btn-changes')?.classList.remove('active');
  trace.open = false;
}

function dockToggle(name) {
  if (dockIsOpen() && dockTab === name) dockClose();
  else dockOpen(name);
}

function dockSetWidth(px) {
  const w = Math.min(DOCK_MAX, Math.max(DOCK_MIN, Math.round(px)));
  bodyEl.style.setProperty('--dock-w', w + 'px');
  dockSavePrefs();
}

function dockInitResize() {
  const handle = $('#dock-resize');
  if (!handle) return;
  let dragging = false;
  handle.addEventListener('pointerdown', (ev) => {
    dragging = true;
    handle.setPointerCapture(ev.pointerId);
    document.body.classList.add('resizing');
    ev.preventDefault();
  });
  handle.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    dockSetWidth(window.innerWidth - ev.clientX - 8);
  });
  const stop = (ev) => {
    if (!dragging) return;
    dragging = false;
    try {
      handle.releasePointerCapture(ev.pointerId);
    } catch {}
    document.body.classList.remove('resizing');
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', (ev) => {
    const cur = parseInt(getComputedStyle(bodyEl).getPropertyValue('--dock-w'), 10) || 420;
    if (ev.key === 'ArrowLeft') dockSetWidth(cur + 24);
    else if (ev.key === 'ArrowRight') dockSetWidth(cur - 24);
    else return;
    ev.preventDefault();
  });
}

/* --------------------------------------------------------- context glance */

/** What is actually in the model's context right now, without opening the
 *  Inspector: prompt size, tools, files, the message ledger and the last request. */
function renderDockContext() {
  if (!dockContextBody) return;
  const sys = inspLatest('system_prompt');
  const ctx = inspLatest('context');
  const req = inspLatest('request');
  if (!sys && !ctx && !req) {
    dockContextBody.innerHTML = `<div class="insp-empty">${esc(t('dock.contextEmpty'))}</div>`;
    return;
  }
  let html = '';
  const meta = [];
  if (state.currentModel) meta.push(state.currentModel.name || `${state.currentModel.provider}/${state.currentModel.id}`);
  if (thinkSel.value) meta.push(thinkSel.value);
  if (meta.length) html += `<div class="dock-meta">${esc(meta.join(' · '))}</div>`;

  // kvRows(label, value, right) — the value goes in the third slot so the dock
  // can stack it under its label instead of truncating a narrow column
  if (sys) {
    const d = sys.data || {};
    const tools = d.selectedTools || [];
    const files = (d.contextFiles || []).map((f) => (typeof f === 'string' ? f : f.path || f.name || '')).filter(Boolean);
    html += inspSection(
      t('dock.prompt'),
      kvRows([
        [t('dock.promptChars'), `${fmtChars(d.chars || 0)} · ~${estTokens(d.chars || 0)} tok`],
        [t('dock.tools'), tools.length ? tools.join(', ') : '—'],
        [t('dock.files'), files.length ? files.join(', ') : '—'],
      ]),
    );
  }

  if (ctx) {
    const d = ctx.data || {};
    const msgs = d.messages || [];
    const total = Math.max(1, d.chars || 1);
    const bar = msgs
      .map((m) => `<i style="width:${(((m.chars || 0) / total) * 100).toFixed(2)}%;background:${ROLE_COLOR[m.role] || 'var(--faint)'}"></i>`)
      .join('');
    const legend = Object.entries(ROLE_COLOR)
      .filter(([role]) => msgs.some((m) => m.role === role))
      .map(([role, c]) => `<span><b style="background:${c}"></b>${esc(role)}</span>`)
      .join('');
    const byRole = {};
    for (const m of msgs) byRole[m.role] = (byRole[m.role] || 0) + 1;
    html += inspSection(
      t('dock.context'),
      kvRows([
        [t('dock.messages'), `${d.count ?? msgs.length} · ${Object.entries(byRole).map(([r, n]) => `${r} ${n}`).join(', ')}`],
        [t('dock.contextChars'), `${fmtChars(d.chars)} · ~${estTokens(d.chars)} tok`],
      ]) + `<div class="insp-bar">${bar}</div><div class="insp-legend">${legend}</div>`,
    );
  }

  if (req) {
    const d = req.data || {};
    html += inspSection(
      t('dock.lastRequest'),
      kvRows([
        [t('dock.model'), (d.params && d.params.model) || '—'],
        [t('dock.requestTools'), d.toolCount != null ? `${d.toolCount}${d.toolNames && d.toolNames.length ? ' (' + d.toolNames.join(', ') + ')' : ''}` : '—'],
        [t('dock.requestMessages'), `${d.messageCount ?? '—'}`],
        [t('dock.requestBytes'), fmtChars(d.bytes || 0)],
      ]),
    );
  }
  dockContextBody.innerHTML = html;
}


/* ================================================================== trace */

const TRACE_MAX_BYTES = 8 * 1024 * 1024;
const INSPECT_MAX_BYTES = 4 * 1024 * 1024;

const TRACE_ROWS_PER_GROUP = 40;

const trace = {
  raw: [],
  rawSizes: [],
  rawBytes: 0,
  rows: [],
  groups: [],
  curGroup: null,
  toolRows: new Map(),
  dialogRows: new Map(),
  open: false,
  follow: true,
  showDeltas: false,
  pinned: false,
  t0: null,
};

function traceSetOpen(open) {
  trace.open = open;
  if (open) dockOpen('trace');
  else if (dockTab === 'trace') dockClose();
  else $('#btn-trace')?.classList.toggle('active', false);
}

function traceFollow() {
  if (trace.follow) traceList.scrollTop = traceList.scrollHeight;
}

function tracePushRaw(rec) {
  let size = 0;
  try {
    size = JSON.stringify(rec).length;
  } catch {}
  trace.raw.push(rec);
  trace.rawSizes.push(size);
  trace.rawBytes += size;
  while (trace.raw.length > 500 && (trace.raw.length > 20000 || trace.rawBytes > TRACE_MAX_BYTES)) {
    trace.raw.shift();
    trace.rawBytes -= trace.rawSizes.shift() || 0;
  }
}

function setTraceRaw(records) {
  trace.raw = Array.isArray(records) ? records : [];
  trace.rawSizes = [];
  trace.rawBytes = 0;
  for (const rec of trace.raw) {
    let size = 0;
    try {
      size = JSON.stringify(rec).length;
    } catch {}
    trace.rawSizes.push(size);
    trace.rawBytes += size;
  }
}

function traceReset() {
  trace.raw = [];
  trace.rawSizes = [];
  trace.rawBytes = 0;
  trace.rows = [];
  trace.groups = [];
  trace.curGroup = null;
  trace.toolRows.clear();
  trace.dialogRows.clear();
  traceList.innerHTML = '';
  trace.t0 = null;
  trace.panelCleared = false;
}

function traceStartGroup(prompt, t) {
  const g = {
    index: trace.groups.length,
    isPrompt: true,
    prompt: prompt || '(empty prompt)',
    startT: t,
    endT: t,
    tokens: 0,
    cost: 0,
    tools: 0,
    rows: [],
    el: null,
    rowsEl: null,
    headEl: null,
    metaEl: null,
    moreEl: null,
    domRows: [],
    rendered: 0,
    hidden: 0,
    expandAll: false,
    collapsed: false,
  };
  trace.groups.push(g);
  trace.curGroup = g;
  return g;
}

function tracePushRow(row) {
  if (!trace.curGroup) {
    traceStartGroup('(session start)', row.t);
    trace.curGroup.isPrompt = false;
    trace.curGroup.prompt = '(session start)';
  }
  row.group = trace.curGroup;
  trace.curGroup.rows.push(row);
  trace.curGroup.endT = row.t;
  trace.rows.push(row);
  if (trace.open) traceMaybeRenderRow(row);
  traceUpdateGroupHead(trace.curGroup);
  if (trace.follow && trace.open) traceFollow();
}

function traceEnsureGroupEl(g) {
  if (g.el) return;
  const wrap = document.createElement('div');
  wrap.className = 'tr-group';
  const head = document.createElement('div');
  head.className = 'tr-group-head';
  const idx = document.createElement('span');
  idx.className = 'tr-group-idx';
  idx.textContent = g.isPrompt ? '#' + g.promptOrdinal() : '·';
  const prompt = document.createElement('span');
  prompt.className = 'tr-group-prompt';
  prompt.textContent = g.prompt;
  prompt.title = g.prompt;
  const wf = document.createElement('div');
  wf.className = 'tr-wf';
  wf.title = 'tool durations';
  const files = document.createElement('span');
  files.className = 'tr-files';
  const meta = document.createElement('span');
  meta.className = 'tr-group-meta';
  head.append(idx, prompt, wf, files, meta);
  head.addEventListener('click', () => {
    g.collapsed = !g.collapsed;
    wrap.classList.toggle('collapsed', g.collapsed);
  });
  const rows = document.createElement('div');
  rows.className = 'tr-group-rows';
  const more = document.createElement('div');
  more.className = 'tr-more';
  more.style.display = 'none';
  more.addEventListener('click', () => traceExpandGroup(g));
  wrap.append(head, rows, more);
  traceList.appendChild(wrap);
  g.moreEl = more;
  g.el = wrap;
  g.headEl = head;
  g.rowsEl = rows;
  g.metaEl = meta;
  g.idxEl = idx;
  g.wfEl = wf;
  g.filesEl = files;
}

function traceUpdateGroupHead(g) {
  if (!g || !g.metaEl) return;
  const dur = g.endT && g.startT ? g.endT - g.startT : 0;

  // waterfall: each tool as a bar positioned inside the group's time window
  if (g.wfEl && dur > 0) {
    const spans = g.toolSpans || [];
    g.wfEl.innerHTML = spans
      .slice(-40)
      .map((s) => {
        const left = Math.max(0, ((s.start - g.startT) / dur) * 100);
        const width = Math.max(2, ((Math.max(s.end, s.start + 1) - s.start) / dur) * 100);
        return `<i class="${s.isError ? 'error' : ''}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${esc(
          `${s.name} ${fmtDur(s.end - s.start)}`,
        )}"></i>`;
      })
      .join('');
  }

  // files touched in this exchange
  if (g.filesEl) {
    const files = [...(g.files || [])];
    g.filesEl.textContent = files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : '';
    g.filesEl.title = files.join('\n');
  }

  const parts = [fmtDur(dur)];
  if (g.tools) parts.push(tp('trace.oneTool', 'trace.otherTools', g.tools));
  if (g.tokens) parts.push(fmtTokens(g.tokens) + ' ' + t('stats.tokens'));
  if (g.cost) parts.push('$' + g.cost.toFixed(5));
  g.metaEl.textContent = parts.join(' · ');
}

const TRACE_ICON = {
  user: '👤',
  assistant: '🤖',
  thinking: '🧠',
  tool: '🔧',
  llm: '◇',
  error: '⚠',
  meta: '·',
  dialog: '❓',
  marker: '⚑',
};

/**
 * The trace can hold thousands of events; only the newest few per group get real
 * DOM nodes. Streaming deltas are skipped entirely unless the user asks for them.
 */
function traceMaybeRenderRow(row) {
  const g = row.group;
  if (row.delta && !trace.showDeltas) {
    g.hidden += 1;
    traceUpdateGroupMore(g);
    return;
  }
  if (!g.expandAll && g.rendered >= TRACE_ROWS_PER_GROUP && g.domRows.length) {
    const oldest = g.domRows.shift();
    oldest.el?.remove();
    oldest.el = null;
    g.rendered -= 1;
    g.hidden += 1;
  }
  traceRenderRow(row);
  g.rendered += 1;
  g.domRows.push(row);
  traceUpdateGroupMore(g);
}

function traceUpdateGroupMore(g) {
  if (!g.moreEl) return;
  if (g.hidden > 0 && !g.expandAll) {
    g.moreEl.style.display = '';
    g.moreEl.textContent = `${g.hidden} more rows hidden — click to show all`;
  } else {
    g.moreEl.style.display = 'none';
  }
}

/** Re-render one group in full (bounded by what the group actually contains). */
function traceExpandGroup(g) {
  g.expandAll = true;
  g.rowsEl.innerHTML = '';
  g.domRows = [];
  g.rendered = 0;
  g.hidden = 0;
  for (const row of g.rows) {
    if (row.delta && !trace.showDeltas) {
      g.hidden += 1;
      continue;
    }
    traceRenderRow(row);
    g.rendered += 1;
    g.domRows.push(row);
  }
  traceUpdateGroupMore(g);
}

function traceRenderRow(row) {
  const g = row.group;
  traceEnsureGroupEl(g);
  const el = document.createElement('div');
  el.className = 'tr-row kind-' + row.kind + (row.isError ? ' error' : '');

  const tEl = document.createElement('div');
  tEl.className = 'tr-t';
  const rel = row.t - g.startT;
  tEl.textContent = (rel >= 0 ? '+' : '') + (rel / 1000).toFixed(2) + 's';
  tEl.title = new Date(row.t).toLocaleTimeString();

  const iEl = document.createElement('div');
  iEl.className = 'tr-icon';
  iEl.textContent = row.icon || TRACE_ICON[row.kind] || '·';

  const main = document.createElement('div');
  main.className = 'tr-main';
  if (row.label) {
    const l = document.createElement('span');
    l.className = 'tr-label';
    l.textContent = row.label + ' ';
    main.appendChild(l);
  }
  const txt = document.createElement('span');
  txt.className = 'tr-text' + (row.dim ? ' dim' : '') + (row.isError ? ' error' : '');
  txt.textContent = row.text || '';
  main.appendChild(txt);
  row.txtEl = txt;

  if (row.detail != null) {
    const det = document.createElement('details');
    det.className = 'tr-detail';
    const sum = document.createElement('summary');
    sum.textContent = row.detailLabel || 'detail';
    const pre = document.createElement('pre');
    pre.textContent = typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail, null, 2);
    det.append(sum, pre);
    main.appendChild(det);
  }

  el.append(tEl, iEl, main);
  row.el = el;
  g.rowsEl.appendChild(el);
}

function traceSetRowText(row, text) {
  row.text = text;
  if (row.txtEl) row.txtEl.textContent = text;
}

function traceIngest(evt, meta) {
  const t = meta && meta.t ? meta.t : Date.now();
  const record = { seq: meta && meta.seq, t, evt };
  return record;
}

/** Normalize one raw record into trace rows. */
function traceNormalize(rec) {
  const evt = rec && rec.evt;
  if (!evt || typeof evt !== 'object') return; // ignore foreign records (e.g. inspect files)
  const ts = rec.t;
  const seq = rec.seq;
  const push = (row) => {
    row.t = ts;
    row.seq = seq;
    tracePushRow(row);
    return row;
  };

  switch (evt.type) {
    case 'message_start': {
      const m = evt.message || {};
      if (m.role === 'user') {
        const g = traceStartGroup(extractText(m.content), ts);
        g.promptOrdinal = () => trace.groups.filter((x) => x.isPrompt).indexOf(g) + 1;
        push({ kind: 'user', icon: '👤', label: t('label.prompt'), text: shortJson(extractText(m.content), 160), detail: m });
        return;
      }
      if (m.role === 'custom') {
        if (m.display === false) return;
        push({
          kind: 'marker',
          icon: '✦',
          label: m.customType || t('role.custom'),
          text: shortJson(extractText(m.content), 200),
          detail: m,
        });
        return;
      }
      if (m.role === 'assistant')
        push({ kind: 'llm', icon: '◇', label: t('label.assistant'), text: t('trace.text.started'), dim: true });
      return;
    }

    case 'message_end': {
      const m = evt.message || {};
      if (m.role !== 'assistant') return;
      const u = m.usage || {};
      const cost = u.cost?.total ?? 0;
      const summary = `stop=${m.stopReason || 'stop'} · in ${u.input ?? 0} / out ${u.output ?? 0}${cost ? ` · $${cost.toFixed(5)}` : ''}`;
      push({
        kind: 'llm',
        icon: '◇',
        label: t('label.assistant'),
        text: summary,
        detail: m,
        detailLabel: t('trace.detail.message'),
      });
      if (m.stopReason === 'error')
        push({
          kind: 'error',
          icon: '⚠',
          label: t('label.error'),
          text: m.errorMessage || t('trace.text.modelError'),
          isError: true,
        });
      if (trace.curGroup) {
        trace.curGroup.tokens += (u.input ?? 0) + (u.output ?? 0);
        trace.curGroup.cost += cost;
      }
      return;
    }

    case 'message_update': {
      const ae = evt.assistantMessageEvent || {};
      if (!ae.type) return;
      let kind = 'llm';
      let label = ae.type;
      let text = '';
      if (ae.type.startsWith('text')) {
        kind = 'assistant';
        label = 'text';
        text = ae.delta ?? ae.content ?? '';
      } else if (ae.type.startsWith('thinking')) {
        kind = 'thinking';
        label = 'thinking';
        text = ae.delta ?? ae.content ?? '';
      } else if (ae.type.startsWith('toolcall')) {
        kind = 'tool';
        label = 'toolargs';
        text = ae.toolName || ae.id || ae.delta || '';
      }
      if (!text) return;
      push({
        kind,
        icon: TRACE_ICON[kind],
        label,
        text: shortJson(text, 220),
        delta: true,
        detail: ae,
        detailLabel: t('trace.detail.event'),
      });
      return;
    }

    case 'tool_execution_start': {
      const row = push({
        kind: 'tool',
        icon: '🔧',
        label: evt.toolName || t('label.tool'),
        text: shortJson(evt.args, 200),
        detail: evt.args,
        detailLabel: t('trace.detail.args'),
      });
      row.toolCallId = evt.toolCallId;
      row.startedAt = ts;
      if (evt.toolCallId) trace.toolRows.set(evt.toolCallId, row);
      if (trace.curGroup) {
        trace.curGroup.tools += 1;
        const p = evt.args && (evt.args.path || evt.args.file);
        if (p) (trace.curGroup.files || (trace.curGroup.files = new Set())).add(p);
      }
      return;
    }

    case 'tool_execution_update': {
      const row = evt.toolCallId && trace.toolRows.get(evt.toolCallId);
      const partial = extractText(evt.partialResult);
      if (row) traceSetRowText(row, t('trace.text.streaming', { dur: fmtDur(ts - row.startedAt), n: partial.length }));
      return;
    }

    case 'tool_execution_end': {
      const row = evt.toolCallId && trace.toolRows.get(evt.toolCallId);
      const out = extractText(evt.result);
      const durMs = row ? ts - row.startedAt : null;
      const text = evt.isError
        ? t('trace.text.toolFail', { dur: fmtDur(durMs), n: out.length })
        : t('trace.text.toolOk', { dur: fmtDur(durMs), n: out.length });
      if (row) {
        traceSetRowText(row, text);
        row.isError = !!evt.isError;
        row.el?.classList.toggle('error', row.isError);
        row.detail = out;
        row.detailLabel = t('trace.detail.output');
        if (row.el && !row._detailEl) {
          const det = document.createElement('details');
          det.className = 'tr-detail';
          const sum = document.createElement('summary');
          sum.textContent = t('trace.detail.output');
          const pre = document.createElement('pre');
          pre.textContent = out;
          det.append(sum, pre);
          row.el.querySelector('.tr-main').appendChild(det);
          row._detailEl = det;
        } else if (row._detailEl) {
          row._detailEl.querySelector('pre').textContent = out;
        }
      } else {
        push({
          kind: 'tool',
          icon: '🔧',
          label: evt.toolName || t('label.tool'),
          text,
          isError: !!evt.isError,
          detail: out,
          detailLabel: t('trace.detail.output'),
        });
      }
      if (trace.curGroup) {
        const start = row && row.startedAt ? row.startedAt : ts;
        (trace.curGroup.toolSpans || (trace.curGroup.toolSpans = [])).push({
          name: evt.toolName || 'tool',
          start,
          end: ts,
          isError: !!evt.isError,
        });
      }
      return;
    }

    case 'turn_start':
      push({ kind: 'meta', icon: '·', label: t('label.turn'), text: t('trace.text.start'), dim: true });
      return;

    case 'turn_end': {
      const n = Array.isArray(evt.toolResults) ? evt.toolResults.length : 0;
      push({
        kind: 'meta',
        icon: '·',
        label: t('label.turn'),
        text: t('trace.text.end') + (n ? tp('trace.text.toolResult', 'trace.text.toolResults', n) : ''),
        dim: true,
      });
      return;
    }

    case 'agent_start':
      push({ kind: 'meta', icon: '▶', label: t('label.agent'), text: t('trace.text.started'), dim: true });
      return;

    case 'agent_end':
      push({
        kind: 'meta',
        icon: '■',
        label: t('label.agent'),
        text: t('trace.text.ended') + (evt.willRetry ? t('trace.text.willRetry') : ''),
        dim: true,
      });
      return;

    case 'agent_settled':
      push({ kind: 'meta', icon: '✓', label: t('label.agent'), text: t('trace.text.settled'), dim: true });
      return;

    case 'queue_update':
      if (evt.steering?.length || evt.followUp?.length)
        push({
          kind: 'meta',
          icon: '⇢',
          label: t('label.queue'),
          text: t('trace.text.steer', { steer: evt.steering?.length || 0, follow: evt.followUp?.length || 0 }),
        });
      return;

    case 'compaction_start':
      push({
        kind: 'meta',
        icon: '⛶',
        label: t('label.compaction'),
        text: t('trace.text.compactionStart', { reason: evt.reason || t('trace.text.auto') }),
      });
      return;

    case 'compaction_end': {
      const r = evt.result;
      const text = evt.errorMessage
        ? t('trace.text.failed', { msg: evt.errorMessage })
        : r
          ? t('trace.text.compacted', {
              before: fmtTokens(r.tokensBefore),
              after: fmtTokens(r.estimatedTokensAfter),
            })
          : evt.aborted
            ? t('chat.aborted')
            : t('trace.text.done');
      push({ kind: 'meta', icon: '⛶', label: t('label.compaction'), text, isError: !!evt.errorMessage, detail: evt });
      return;
    }

    case 'auto_retry_start':
      push({
        kind: 'meta',
        icon: '↻',
        label: t('label.retry'),
        text: t('trace.text.retry', { attempt: evt.attempt, max: evt.maxAttempts, msg: evt.errorMessage || '' }),
        detail: evt,
      });
      return;

    case 'auto_retry_end':
      push({
        kind: 'meta',
        icon: '↻',
        label: t('label.retry'),
        text: evt.errorMessage ? t('trace.text.failed', { msg: evt.errorMessage }) : t('trace.text.recovered'),
        isError: !!evt.errorMessage,
      });
      return;

    case 'extension_error':
      push({
        kind: 'error',
        icon: '⚠',
        label: t('label.extension'),
        text: evt.errorMessage || evt.message || t('label.error'),
        isError: true,
        detail: evt,
      });
      return;

    case 'extension_ui_request': {
      const row = push({
        kind: 'dialog',
        icon: '❓',
        label: t('label.dialog'),
        text: `${evt.method}${evt.title ? ': ' + evt.title : evt.message ? ': ' + evt.message : ''}`,
        detail: evt,
        detailLabel: t('trace.detail.request'),
      });
      if (evt.id) trace.dialogRows.set(evt.id, row);
      return;
    }

    case '__ui_response': {
      const r = evt.response || {};
      const row = r.id && trace.dialogRows.get(r.id);
      const answer = r.cancelled
        ? t('trace.text.cancelled')
        : r.confirmed != null
          ? t(r.confirmed ? 'common.yes' : 'common.no')
          : r.value;
      const text = t('trace.text.answered', { value: shortJson(answer, 120) });
      if (row) traceSetRowText(row, text);
      else push({ kind: 'dialog', icon: '❓', label: t('label.dialog'), text, dim: true });
      return;
    }

    case '__marker':
      push({ kind: 'marker', icon: '⚑', label: evt.kind || t('role.marker'), text: evt.text || '', detail: evt.meta });
      return;

    case '__proc':
      push({
        kind: 'meta',
        icon: '⚙',
        label: t('label.process'),
        text: `${evt.status}${evt.pid ? ' pid=' + evt.pid : ''}${evt.code != null ? ' code=' + evt.code : ''}`,
        isError: evt.status === 'error',
      });
      return;

    case '__stderr':
      push({ kind: 'error', icon: '⚠', label: t('label.stderr'), text: evt.text, dim: true });
      return;

    case 'response': {
      const interesting = ['prompt', 'new_session', 'abort', 'compact', 'set_model', 'bash', 'clear_queue', 'fork', 'clone', 'switch_session', 'set_session_name', 'export_html'];
      if (evt.success && !interesting.includes(evt.command)) return;
      push({
        kind: evt.success ? 'meta' : 'error',
        icon: evt.success ? '·' : '⚠',
        label: evt.command,
        text: evt.success ? t('trace.text.ok') : t('trace.text.failed', { msg: shortJson(evt.error, 160) }),
        isError: !evt.success,
        dim: evt.success,
      });
      return;
    }
  }
}

function traceIngestLive(evt, meta) {
  const rec = { seq: meta?.seq, t: meta?.t || Date.now(), evt };
  tracePushRaw(rec);
  if (trace.t0 == null) trace.t0 = rec.t;
  traceNormalize(rec);
}

function traceRebuild() {
  trace.rows = [];
  trace.groups = [];
  trace.curGroup = null;
  trace.toolRows.clear();
  trace.dialogRows.clear();
  traceList.innerHTML = '';
  for (const rec of trace.raw) traceNormalize(rec);
  // apply delta visibility
  for (const row of trace.rows) {
    if (row.el && row.delta) row.el.style.display = trace.showDeltas ? '' : 'none';
  }
  linkTraceJumps();
  traceFollow();
}

function traceToggleDeltas(on) {
  trace.showDeltas = on;
  traceRebuild(); // deltas are not in the DOM at all unless enabled
  traceFollow();
}

async function loadTraceHistory() {
  try {
    const [list, cur] = await Promise.all([fetch(api('/api/traces')).then((r) => r.json()), fetch(api('/api/trace')).then((r) => r.json())]);
    traceHistoryEl.innerHTML = `<option value="">${esc(t('trace.current'))}</option>`;
    for (const f of list.files || []) {
      const o = document.createElement('option');
      o.value = f.file;
      const when = new Date(f.mtime).toLocaleString();
      o.textContent = `${f.current ? '● ' : ''}${when} · ${(f.size / 1024).toFixed(0)}kB`;
      traceHistoryEl.appendChild(o);
    }
    if (!trace.pinned && cur.file) {
      traceFileEl.textContent = cur.file;
      traceFileEl.title = cur.file;
    }
    if (!trace.pinned && Array.isArray(cur.records) && cur.records.length) {
      trace.raw = cur.records;
      traceRebuild();
    }
  } catch {}
}

async function selectTraceFile(file) {
  if (!file) {
    trace.pinned = false;
    const cur = await fetch(api('/api/trace')).then((r) => r.json()).catch(() => null);
    if (cur && cur.records) {
      setTraceRaw(cur.records);
      trace.pinned = false;
      traceFileEl.textContent = cur.file || '';
      traceRebuild();
    }
    return;
  }
  try {
    const data = await fetch(api('/api/trace?file=' + encodeURIComponent(file))).then((r) => r.json());
    trace.pinned = true;
    setTraceRaw(data.records || []);
    traceFileEl.textContent = data.file || file;
    traceFileEl.title = data.file || file;
    traceRebuild();
  } catch (err) {
    toast(t('trace.loadFailed', { msg: err.message }), 'error');
  }
}

/* ============================================================ extension ui */

const extStatus = new Map();
const extWidgets = new Map();
const dialogQueue = [];
let activeDialog = null;

function renderExtStatus() {
  const parts = [];
  for (const [k, v] of extStatus) if (v) parts.push(v);
  extStatusEl.textContent = parts.join('  ·  ');
}

function renderWidgets() {
  const above = [];
  const below = [];
  for (const w of extWidgets.values()) {
    if (!w.lines || !w.lines.length) continue;
    (w.placement === 'belowEditor' ? below : above).push(w.lines.join('\n'));
  }
  widgetsAbove.textContent = above.join('\n');
  widgetsBelow.textContent = below.join('\n');
}

function handleExtensionUI(req) {
  switch (req.method) {
    case 'notify':
      toast(req.message || '', req.notifyType || 'info');
      return;
    case 'setStatus':
      if (req.statusText) extStatus.set(req.statusKey || 'ext', req.statusText);
      else extStatus.delete(req.statusKey || 'ext');
      renderExtStatus();
      return;
    case 'setWidget':
      if (req.widgetLines && req.widgetLines.length) extWidgets.set(req.widgetKey || 'ext', { lines: req.widgetLines, placement: req.widgetPlacement });
      else extWidgets.delete(req.widgetKey || 'ext');
      renderWidgets();
      return;
    case 'setTitle':
      document.title = req.title || 'π GUI';
      return;
    case 'set_editor_text':
      input.value = req.text || '';
      autosize();
      input.classList.add('ext-prefill');
      input.focus();
      return;
    case 'select':
    case 'confirm':
    case 'input':
    case 'editor':
      dialogQueue.push(req);
      pumpDialogs();
      return;
  }
}

function respondDialog(id, payload) {
  send({ type: 'extension_ui_response', id, ...payload });
}

/**
 * The server sends the ids of dialogs that are still pending. Anything else we
 * are showing or queueing is stale — a tab that missed the response (offline,
 * still loading, …) would otherwise keep a dead modal forever.
 */
function pruneDialogs(pending) {
  if (!Array.isArray(pending)) return;
  const live = new Set(pending);
  for (let i = dialogQueue.length - 1; i >= 0; i--) {
    if (!live.has(dialogQueue[i].id)) dialogQueue.splice(i, 1);
  }
  if (activeDialog && !live.has(activeDialog.req.id) && activeDialog.close) {
    activeDialog.close(null);
  }
}

function pumpDialogs() {
  if (activeDialog) return;
  const req = dialogQueue.shift();
  if (!req) return;
  const api = { req, close: null };
  activeDialog = api;
  showDialog(
    req,
    (payload) => {
      if (activeDialog === api) activeDialog = null;
      if (payload) respondDialog(req.id, payload);
      setTimeout(pumpDialogs, 0);
    },
    (close) => {
      api.close = close;
    },
  );
}

/**
 * Extension UI requests are broadcast to every connected client, so any tab may
 * answer first. When that happens the server broadcasts the response — close the
 * copy shown here (or drop it from the queue) instead of leaving a dead modal.
 */
function dismissDialogById(id) {
  if (!id) return false;
  if (activeDialog && activeDialog.req.id === id) {
    if (activeDialog.close) activeDialog.close(null);
    toast(t('dialog.answeredElsewhere'), 'info', 2200);
    return true;
  }
  const i = dialogQueue.findIndex((r) => r.id === id);
  if (i !== -1) {
    dialogQueue.splice(i, 1);
    toast(t('dialog.answeredElsewhere'), 'info', 2200);
    return true;
  }
  return false;
}

function showDialog(req, finish, setClose) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const head = document.createElement('div');
  head.className = 'modal-head';
  const kind = document.createElement('span');
  kind.className = 'modal-kind';
  kind.textContent = t('dialog.' + req.method);
  kind.dataset.method = req.method;
  const title = document.createElement('span');
  title.id = 'dialog-title';
  title.textContent =
    req.title ||
    t(req.method === 'confirm' ? 'dialog.confirm' : req.method === 'select' ? 'dialog.select' : 'dialog.input');
  head.append(kind, title);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  const spacer = document.createElement('span');
  spacer.className = 'spacer';

  modal.append(head, body, foot);
  backdrop.appendChild(modal);
  modalRoot.appendChild(backdrop);

  const releaseA11y = makeDialogA11y(backdrop, modal, title.id || undefined);

  let settled = false;
  let timerId = null;
  const extraCleanup = [];

  const close = (payload) => {
    if (settled) return;
    settled = true;
    if (timerId) clearInterval(timerId);
    document.removeEventListener('keydown', onGlobalKey, true);
    for (const fn of extraCleanup) {
      try {
        fn();
      } catch {}
    }
    releaseA11y();
    backdrop.remove();
    finish(payload);
  };
  const cancel = () => close({ cancelled: true });
  if (setClose) setClose((payload) => close(payload));
  const onGlobalKey = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cancel();
    }
  };
  document.addEventListener('keydown', onGlobalKey, true);
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) cancel();
  });

  const button = (label, cls, onAct) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onAct);
    return b;
  };

  if (req.timeout) {
    const deadline = Date.now() + req.timeout;
    const timer = document.createElement('span');
    timer.className = 'modal-timer';
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      timer.textContent = t('dialog.timeout', { s: (left / 1000).toFixed(1) });
      if (left <= 0) close(null); // pi resolves the dialog on its own
    };
    tick();
    timerId = setInterval(tick, 100);
    foot.appendChild(timer);
  }
  foot.appendChild(spacer);

  if (req.method === 'select') {
    const options = Array.isArray(req.options) ? req.options : [];
    const list = document.createElement('div');
    list.className = 'modal-options';
    let sel = 0;
    const setSel = (i) => {
      if (!options.length) return;
      sel = ((i % options.length) + options.length) % options.length;
      [...list.children].forEach((c, j) => c.classList.toggle('sel', j === sel));
    };
    options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'modal-option' + (i === 0 ? ' sel' : '');
      b.textContent = opt;
      b.addEventListener('click', () => close({ value: opt }));
      b.addEventListener('mousemove', () => setSel(i));
      list.appendChild(b);
    });
    body.appendChild(list);

    const onKey = (ev) => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        setSel(sel + 1);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setSel(sel - 1);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (options[sel] != null) close({ value: options[sel] });
      } else if (/^[1-9]$/.test(ev.key)) {
        const i = Number(ev.key) - 1;
        if (i < options.length) close({ value: options[i] });
      }
    };
    document.addEventListener('keydown', onKey);
    extraCleanup.push(() => document.removeEventListener('keydown', onKey));

    foot.appendChild(button(t('common.cancel'), 'ghost', cancel));
    setTimeout(() => list.children[0]?.focus(), 0);
    return;
  }

  if (req.method === 'confirm') {
    if (req.message) {
      const p = document.createElement('p');
      p.textContent = req.message;
      body.appendChild(p);
    }
    const no = button(t('common.no'), 'ghost', () => close({ confirmed: false }));
    const yes = button(t('common.yes'), 'primary', () => close({ confirmed: true }));
    foot.append(no, yes);
    setTimeout(() => yes.focus(), 0);
    return;
  }

  if (req.method === 'input') {
    const el = document.createElement('input');
    el.type = 'text';
    el.placeholder = req.placeholder || '';
    el.value = req.prefill || '';
    body.appendChild(el);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        close({ value: el.value });
      }
    });
    foot.append(
      button(t('common.cancel'), 'ghost', cancel),
      button(t('common.ok'), 'primary', () => close({ value: el.value })),
    );
    setTimeout(() => el.focus(), 0);
    return;
  }

  // editor
  const ta = document.createElement('textarea');
  ta.rows = 12;
  ta.value = req.prefill || '';
  ta.placeholder = req.placeholder || '';
  body.appendChild(ta);
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      close({ value: ta.value });
    }
  });
  foot.append(
    button(t('common.cancel'), 'ghost', cancel),
    button(t('common.save'), 'primary', () => close({ value: ta.value })),
  );
  setTimeout(() => ta.focus(), 0);
}

/* ================================================================ events */

function handleEvent(e) {
  if (typeof e.__seq === 'number' && e.__seq > state.lastSeq) state.lastSeq = e.__seq;
  // trace ingestion must never break the chat pipeline
  try {
    traceIngestLive(e, { seq: e.__seq, t: e.__t });
  } catch (err) {
    console.error('trace ingest failed for', e.type, err);
  }

  switch (e.type) {
    case '__gap':
      // the server's buffer no longer covers our gap — rebuild from the truth
      noticeT('chat.gapResync', { n: Math.max(0, (e.to || 0) - (e.from || 0) + 1) }, 'warning');
      send({ type: 'get_messages' }, { silent: true });
      send({ type: 'get_state' }, { silent: true });
      refreshStats();
      loadTraceHistory();
      break;
    case '__hello':
      state.cwd = e.cwd || state.cwd;
      cwdEl.textContent = e.cwd || '';
      cwdEl.title = e.cwd || '';
      if (e.traceFile) {
        traceFileEl.textContent = e.traceFile.split('/').pop();
        traceFileEl.title = e.traceFile;
      }
      pruneDialogs(e.dialogs);
      if (e.alive) setStatusK('status.ready', null, 'ok');
      break;

    case '__proc':
      if (e.status === 'started') setStatusK('status.piRunning', { pid: e.pid }, 'ok');
      else if (e.status === 'exit') {
        setStreaming(false);
        endRun();
        setStatusK(
          'status.piExited',
          { code: `${e.code ?? '-'}${e.signal ? ', ' + e.signal : ''}` },
          'error',
        );
        btnStop.disabled = true;
      } else if (e.status === 'error') setStatusK('status.piFailed', { msg: e.message }, 'error');
      break;

    case '__stderr':
      console.warn('[pi]', e.text);
      break;

    case '__raw':
      console.warn('[pi stdout non-JSON]', e.text);
      break;

    case 'extension_ui_request':
      handleExtensionUI(e);
      break;

    case '__ui_response': {
      // another client answered a dialog that is also open here
      const id = e.response && e.response.id;
      if (id) dismissDialogById(id);
      break;
    }

    case '__inspect': {
      pushInspect({ at: e.at, kind: e.kind, data: e.data, agent: e.agent || 'main' });
      scheduleInspectRender();
      break;
    }

    case '__agent': {
      upsertAgent(e.agent);
      scheduleInspectRender();
      break;
    }

    case 'response':
      handleResponse(e);
      break;

    case 'agent_start':
      setStreaming(true);
      startRun();
      setStatusK('status.working', null, 'working');
      break;

    case 'agent_end':
      if (e.willRetry) {
        setRunAction('retrying');
        setStatusK('status.retrying', null, 'working');
      }
      break;

    case 'agent_settled':
      setStreaming(false);
      endRun();
      setStatusK('status.ready', null, 'ok');
      announce(t('a11y.done', { dur: fmtDur(Date.now() - (runState.startedAt || Date.now())) }));
      refreshStats();
      send({ type: 'get_state' }, { silent: true });
      // the session tree grows as the turn is persisted — keep an open panel honest
      if (!sessionsEl.classList.contains('hidden')) send({ type: 'get_tree' }, { silent: true });
      refreshUserActions();
      notifyDone();
      break;

    case 'message_start':
      onMessageStart(e);
      break;
    case 'message_update':
      onMessageUpdate(e);
      break;
    case 'message_end':
      onMessageEnd(e);
      break;

    case 'tool_execution_start':
      onToolStart(e);
      break;
    case 'tool_execution_update':
      onToolUpdate(e);
      break;
    case 'tool_execution_end':
      onToolEnd(e);
      break;

    case 'queue_update':
      if (e.steering?.length || e.followUp?.length)
        setStatusK(
          'status.queued',
          { steer: e.steering?.length || 0, follow: e.followUp?.length || 0 },
          'working',
        );
      break;

    case 'compaction_start':
      setRunAction('compacting');
      noticeT('chat.compacting', { reason: e.reason || t('trace.text.auto') });
      break;
    case 'compaction_end':
      if (e.errorMessage) noticeT('chat.compactionFailed', { msg: e.errorMessage }, 'error');
      else if (e.result)
        noticeT('chat.compacted', {
          before: fmtTokens(e.result.tokensBefore),
          after: fmtTokens(e.result.estimatedTokensAfter),
        });
      refreshStats();
      break;

    case 'auto_retry_start':
      setRunAction('retrying');
      setStatusK('status.retry', { attempt: e.attempt, max: e.maxAttempts }, 'working');
      break;
    case 'auto_retry_end':
      if (e.errorMessage) noticeT('chat.retryFailed', { msg: e.errorMessage }, 'error');
      break;

    case 'extension_error':
      noticeT('chat.extensionError', { msg: e.errorMessage || e.message || t('chat.unknown') }, 'error');
      break;
  }
}

/* ---- chat event handlers (unchanged behaviour) ---- */

let curText = null;
let curThink = null;
let curTool = null;

function onMessageStart(e) {
  const m = e.message;
  if (!m) return;
  if (m.role === 'user') {
    // A user message can arrive that this tab did not type: another tab on the
    // same session, an extension calling sendUserMessage(), another client.
    // Only skip the ones we already rendered optimistically in submit().
    const text = extractText(m.content).trim();
    const imgs = Array.isArray(m.content) ? m.content.filter((c) => c && c.type === 'image').length : 0;
    const pending = state.pendingUser;
    const isOurs = !!(pending && pending.text.trim() === text && pending.images === imgs);
    state.pendingUser = null;

    if (!isOurs) {
      state.allMessages.push(m);
      const msg = addMessage('user');
      const blocks = contentBlocks(m.content);
      if (!blocks.length) addBlock(msg, { type: 'text', text: '' });
      for (const b of blocks) addBlock(msg, b);
      state.lastUserMsg = msg;
      toBottom(true);
    }

    // correlate the trace group with the bubble so it can jump there
    const g = trace.groups.find((x) => x.isPrompt && !x._linked);
    if (g) {
      g._linked = true;
      const ord = trace.groups.filter((x) => x.isPrompt).indexOf(g) + 1;
      if (state.lastUserMsg) attachTraceJump(state.lastUserMsg, ord);
      state.lastUserMsg = null;
    }
    return;
  }
  if (m.role !== 'assistant') return;
  if (state.liveAssistant) return;
  const msg = addMessage('assistant');
  state.liveAssistant = msg;
}

function attachTraceJump(msg, ordinal) {
  attachTraceJumpTo(msg && msg.bubble, ordinal);
}

function attachTraceJumpTo(bubble, ordinal) {
  if (!bubble || bubble.querySelector('.trace-jump')) return;
  const b = document.createElement('button');
  b.className = 'trace-jump';
  b.textContent = t('chat.traceJump');
  b.title = t('chat.traceJumpTitle');
  b.addEventListener('click', () => {
    traceSetOpen(true);
    const group = trace.groups.filter((x) => x.isPrompt)[ordinal - 1];
    if (!group) return;
    group.collapsed = false;
    group.el?.classList.remove('collapsed');
    group.el?.scrollIntoView({ block: 'start' });
    group.headEl?.animate?.([{ background: '#fde68a' }, { background: '' }], { duration: 900 });
  });
  let box = bubble.querySelector('.msg-actions');
  if (!box) {
    box = document.createElement('div');
    box.className = 'msg-actions';
    bubble.appendChild(box);
  }
  box.appendChild(b);
}

/**
 * Re-link chat bubbles to trace groups after a reload: the chat is rebuilt from
 * `get_messages` while the trace comes from the server, so the live path in
 * onMessageStart never runs for those messages.
 */
function linkTraceJumps() {
  const groups = trace.groups.filter((g) => g.isPrompt);
  if (!groups.length) return;
  const bubbles = [...document.querySelectorAll('.msg.user .bubble')];
  if (bubbles.length !== groups.length) return; // only link when unambiguous
  bubbles.forEach((bubble, i) => attachTraceJumpTo(bubble, i + 1));
}

function actionsBox(msg) {
  let box = msg.bubble.querySelector('.msg-actions');
  if (!box) {
    box = document.createElement('div');
    box.className = 'msg-actions';
    msg.bubble.appendChild(box);
  }
  return box;
}

/** Copy a whole answer (minus the action buttons). */
function addCopyMessageButton(msg) {
  if (!msg || msg.role !== 'assistant') return;
  const box = actionsBox(msg);
  if (box.querySelector('.act-copy')) return;
  const b = document.createElement('button');
  b.className = 'act-copy';
  b.textContent = t('common.copy');
  b.title = t('chat.copyMessage');
  b.addEventListener('click', async () => {
    try {
      const clone = msg.bubble.cloneNode(true);
      clone.querySelector('.msg-actions')?.remove();
      await navigator.clipboard.writeText(clone.innerText.trim());
      b.textContent = t('common.copied');
      setTimeout(() => {
        b.textContent = t('common.copy');
      }, 1200);
    } catch {}
  });
  box.appendChild(b);
}

/* --------------------------------------------------------- notifications */

let notifyAsked = false;

function maybeAskNotify() {
  if (notifyAsked) return;
  notifyAsked = true;
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      const r = Notification.requestPermission();
      if (r && r.catch) r.catch(() => {});
    }
  } catch {}
}

/** Tell the user a long run finished while the tab was in the background. */
function notifyDone() {
  if (!document.hidden) return;
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const last = [...document.querySelectorAll('.msg.assistant .md')].pop();
    const body = ((last && last.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 140) || t('notify.done');
    new Notification('π GUI', { body, silent: true });
  } catch {}
}

/**
 * Edit & resend / retry act on the last user message. pi picks the branch point
 * with `fork`, which returns the original text — perfect for prefilling the
 * editor. Arbitrary points stay available in Sessions → branch tree.
 */
function refreshUserActions() {
  document.querySelectorAll('.msg-actions .act-fork').forEach((b) => b.remove());
  const bubbles = [...document.querySelectorAll('.msg.user .bubble')];
  const last = bubbles[bubbles.length - 1];
  if (!last) return;
  let box = last.querySelector('.msg-actions');
  if (!box) {
    box = document.createElement('div');
    box.className = 'msg-actions';
    last.appendChild(box);
  }
  const mk = (cls, label, title, intent) => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.title = title;
    b.disabled = state.streaming;
    b.addEventListener('click', () => requestForkAction(intent));
    return b;
  };
  box.appendChild(mk('act-fork act-edit', t('chat.editResend'), t('chat.editResendTitle'), 'edit'));
  box.appendChild(mk('act-fork act-retry', t('chat.retry'), t('chat.retryTitle'), 'retry'));
}

let forkIntent = null;

function requestForkAction(intent) {
  if (state.streaming) {
    toast(t('chat.busyStopFirst'), 'warning');
    return;
  }
  forkIntent = intent;
  send({ type: 'get_fork_messages' }, { silent: true });
}

/* ---------------------------------------------------------- autocomplete */

const ac = { open: false, mode: null, items: [], index: 0, from: 0, to: 0, seq: 0 };
let acTimer = null;

function acContext() {
  const pos = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, pos);
  const cmd = /^\/([^\s/]*)$/.exec(before);
  if (cmd) return { mode: 'command', query: cmd[1], from: 0, to: pos };
  const at = before.lastIndexOf('@');
  if (at !== -1) {
    const seg = before.slice(at + 1);
    const prev = at === 0 ? '' : before[at - 1];
    if (!/\s/.test(seg) && (at === 0 || /\s|[([{]/.test(prev))) {
      return { mode: 'file', query: seg, from: at, to: pos };
    }
  }
  return null;
}

function closeAutocomplete() {
  ac.open = false;
  ac.items = [];
  if (acEl) {
    acEl.classList.add('hidden');
    acEl.innerHTML = '';
  }
}

function acRender() {
  if (!acEl || !ac.open) return closeAutocomplete();
  acEl.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'ac-head';
  head.textContent =
    ac.mode === 'command'
      ? t('ac.commands', { n: ac.items.length })
      : t('ac.files', { n: ac.items.length });
  acEl.appendChild(head);

  if (!ac.items.length) {
    const empty = document.createElement('div');
    empty.className = 'ac-empty';
    empty.textContent = ac.mode === 'command' ? t('ac.noCommands') : t('ac.noFiles');
    acEl.appendChild(empty);
  }

  ac.items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'ac-item' + (i === ac.index ? ' sel' : '');
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(i === ac.index));
    const name = document.createElement('span');
    name.className = 'ac-name';
    name.textContent = item.label;
    el.appendChild(name);
    if (item.kind) {
      const k = document.createElement('span');
      k.className = 'ac-kind';
      k.textContent = item.kind;
      el.appendChild(k);
    }
    if (item.desc) {
      const d = document.createElement('span');
      d.className = 'ac-desc';
      d.textContent = item.desc;
      el.appendChild(d);
    }
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ac.index = i;
      acAccept();
    });
    acEl.appendChild(el);
  });

  const r = input.getBoundingClientRect();
  acEl.style.left = `${Math.max(8, r.left)}px`;
  acEl.style.width = `${Math.min(620, Math.max(280, r.width))}px`;
  acEl.style.bottom = `${Math.max(8, window.innerHeight - r.top + 6)}px`;
  acEl.classList.remove('hidden');
  acEl.querySelector('.ac-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function acAccept() {
  if (!ac.open || !ac.items.length) return;
  const item = ac.items[ac.index];
  const before = input.value.slice(0, ac.from);
  const after = input.value.slice(ac.to);
  const insert = ac.mode === 'command' ? `/${item.value} ` : `@${item.value} `;
  input.value = before + insert + after;
  const caret = (before + insert).length;
  input.setSelectionRange(caret, caret);
  closeAutocomplete();
  autosize();
  input.focus();
}

function acMove(delta) {
  if (!ac.open || !ac.items.length) return;
  ac.index = (ac.index + delta + ac.items.length) % ac.items.length;
  [...acEl.querySelectorAll('.ac-item')].forEach((el, i) => {
    el.classList.toggle('sel', i === ac.index);
    el.setAttribute('aria-selected', String(i === ac.index));
  });
  acEl.querySelector('.ac-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function acUpdate() {
  const ctx = acContext();
  if (!ctx) return closeAutocomplete();
  ac.mode = ctx.mode;
  ac.from = ctx.from;
  ac.to = ctx.to;

  if (ctx.mode === 'command') {
    clearTimeout(acTimer);
    const q = ctx.query.toLowerCase();
    ac.items = (state.commands || [])
      .filter((c) => !q || String(c.name).toLowerCase().includes(q))
      .slice(0, 40)
      .map((c) => ({ value: c.name, label: `/${c.name}`, desc: c.description || '', kind: c.source }));
    ac.open = true;
    ac.index = 0;
    acRender();
    return;
  }

  clearTimeout(acTimer);
  const seq = ++ac.seq;
  acTimer = setTimeout(async () => {
    try {
      const r = await fetch(api(`/api/files?q=${encodeURIComponent(ctx.query)}&limit=40`)).then((x) => x.json());
      if (seq !== ac.seq) return;
      ac.items = (r.files || []).map((f) => ({ value: f, label: f, desc: '', kind: null }));
      ac.open = true;
      ac.index = 0;
      acRender();
    } catch {
      closeAutocomplete();
    }
  }, 90);
}

function onMessageUpdate(e) {
  const ae = e.assistantMessageEvent;
  const live = state.liveAssistant;
  if (!ae || !live) return;

  switch (ae.type) {
    case 'text_start':
      setRunAction('writing');
      curText = addBlock(live, { type: 'text', text: '' });
      curText.streaming = true;
      curText.node?.classList.add('streaming');
      break;
    case 'text_delta':
      if (!curText) {
        curText = addBlock(live, { type: 'text', text: '' });
        curText.streaming = true;
        curText.node?.classList.add('streaming');
      }
      curText.text += ae.delta;
      scheduleBlockRender(curText);
      break;
    case 'text_end':
      if (curText) {
        if (ae.content != null) curText.text = ae.content;
        curText.streaming = false;
        curText.node?.classList.remove('streaming');
        updateBlock(curText);
      }
      curText = null;
      break;

    case 'thinking_start':
      setRunAction('thinking');
      curThink = addBlock(live, { type: 'thinking', text: '', streaming: true });
      break;
    case 'thinking_delta':
      if (!curThink) curThink = addBlock(live, { type: 'thinking', text: '', streaming: true });
      curThink.text += ae.delta;
      scheduleBlockRender(curThink);
      break;
    case 'thinking_end':
      if (curThink) {
        if (ae.content != null) curThink.text = ae.content;
        curThink.streaming = false;
        updateBlock(curThink);
      }
      curThink = null;
      break;

    case 'toolcall_start':
      curTool = addBlock(live, { type: 'toolCall', id: ae.id, name: ae.toolName, argsText: '', status: 'streaming' });
      if (ae.id) state.toolBlocks.set(ae.id, curTool);
      break;
    case 'toolcall_delta':
      if (curTool) {
        curTool.argsText += ae.delta || '';
        try {
          curTool.args = JSON.parse(curTool.argsText);
        } catch {}
        updateTool(curTool);
      }
      break;
    case 'toolcall_end':
      if (curTool && ae.toolCall) {
        curTool.id = ae.toolCall.id || curTool.id;
        curTool.name = ae.toolCall.name || curTool.name;
        curTool.args = ae.toolCall.arguments;
        curTool.argsText = JSON.stringify(ae.toolCall.arguments ?? {}, null, 2);
        curTool.status = 'pending';
        if (curTool.id) state.toolBlocks.set(curTool.id, curTool);
        updateTool(curTool);
      }
      curTool = null;
      break;
  }
}

function onMessageEnd(e) {
  const m = e.message;
  if (!m) return;
  if (m.role === 'custom') {
    if (m.display === false) return;
    state.allMessages.push(m);
    const msg = addMessage('system');
    const d = document.createElement('div');
    d.className = 'md';
    d.textContent = (m.customType ? `[${m.customType}] ` : '') + extractText(m.content);
    msg.bubble.appendChild(d);
    toBottom();
    return;
  }
  if (m.role !== 'assistant') return;
  const live = state.liveAssistant;
  if (!live) return;

  const carried = new Map();
  for (const b of live.blocks) {
    if (b.type === 'toolCall')
      carried.set(b.id, {
        result: b.result,
        partial: b.partial,
        isError: b.isError,
        status: b.status,
        details: b.details,
      });
  }
  for (const b of live.blocks) b.node?.remove();
  live.blocks = [];

  for (const cb of contentBlocks(m.content)) {
    const b = addBlock(live, cb);
    if (cb.type === 'toolCall') {
      const prev = carried.get(cb.id);
      if (prev) Object.assign(b, prev);
      if (b.id) state.toolBlocks.set(b.id, b);
      updateTool(b);
    }
  }

  if (m.stopReason === 'error')
    notice(m.errorMessage ? t('chat.modelErrorWith', { msg: m.errorMessage }) : t('chat.modelError'), 'error');
  else if (m.stopReason === 'aborted') noticeT('chat.aborted', null, 'error');

  state.liveAssistant = null;
  curText = curThink = curTool = null;
  if (m.usage) state.lastUsage = m.usage;
  state.allMessages.push(m);
  decoratePres(live.bubble);
  addCopyMessageButton(live);
  toBottom();
}

function onToolStart(e) {
  setRunAction('tool', e.toolName);
  const b = state.toolBlocks.get(e.toolCallId);
  if (!b) {
    noteToolOrphan(e.toolCallId, e.toolName, e.args);
    return;
  }
  if (e.args) {
    b.args = e.args;
    b.argsText = JSON.stringify(e.args, null, 2);
  }
  b.status = 'running';
  b.partial = '';
  updateTool(b);
}

function onToolUpdate(e) {
  const b = state.toolBlocks.get(e.toolCallId);
  if (!b) return;
  b.partial = extractText(e.partialResult);
  updateTool(b);
}

function onToolEnd(e) {
  setRunAction('working');
  const b = state.toolBlocks.get(e.toolCallId);
  if (!b) return;
  b.result = extractText(e.result);
  b.details = e.result && e.result.details ? e.result.details : null;
  b.partial = undefined;
  b.isError = !!e.isError;
  b.status = b.isError ? 'error' : 'done';
  updateTool(b);
  toBottom();
}

function noteToolOrphan(id, name, args) {
  const msg = state.liveAssistant || addMessage('assistant');
  const b = addBlock(msg, {
    type: 'toolCall',
    id,
    name,
    args,
    argsText: JSON.stringify(args ?? {}, null, 2),
    status: 'running',
  });
  if (id) state.toolBlocks.set(id, b);
}

/* ------------------------------------------------------------- responses */

function handleResponse(e) {
  const cmd = e.command;
  if (!e.success) {
    if (e.error)
      notice(
        t('chat.cmdFailed', { cmd, msg: typeof e.error === 'string' ? e.error : JSON.stringify(e.error) }),
        'error',
      );
    return;
  }
  const d = e.data || {};
  switch (cmd) {
    case 'get_state':
      applyState(d);
      break;
    case 'get_available_models':
      state.models = d.models || [];
      fillModels();
      break;
    case 'get_available_thinking_levels':
      fillThinking(d.levels || []);
      break;
    case 'set_model':
      state.currentModel = d.id ? d : state.currentModel;
      applyState({ model: d });
      break;
    case 'set_thinking_level':
      thinkSel.value = d.level || thinkSel.value;
      syncPicker();
      break;
    case 'get_session_stats':
      renderStats(d);
      break;
    case 'get_messages':
      renderHistory(d.messages || []);
      break;
    case 'get_entries':
      state.entries = d.entries || [];
      state.leafId = d.leafId || null;
      if (!inspEl.classList.contains('hidden')) renderInspect();
      break;
    case 'get_tree':
      renderTree(d.tree || [], d.leafId || null);
      break;
    case 'get_commands':
      state.commands = d.commands || [];
      break;
    case 'get_fork_messages': {
      const list = d.messages || [];
      const last = list[list.length - 1];
      if (!last || !forkIntent) {
        if (forkIntent) toast(t('chat.nothingToFork'), 'warning');
        forkIntent = null;
        break;
      }
      send({ type: 'fork', entryId: last.entryId }, { silent: true });
      break;
    }
    case 'fork': {
      if (d.cancelled) {
        forkIntent = null;
        toast(t('toast.forkCancelled'), 'warning');
        break;
      }
      const intent = forkIntent;
      forkIntent = null;
      if (intent) {
        reloadSession(intent);
        const text = d.text || '';
        setTimeout(() => {
          input.value = text;
          autosize();
          if (intent === 'retry') {
            submit();
          } else {
            input.classList.add('ext-prefill');
            input.focus();
            toast(t('chat.editHint'));
          }
        }, 350);
      } else {
        toast(t('toast.forked', { text: previewText(d.text, 60) }));
        reloadSession('fork');
        closeSessions();
      }
      break;
    }
    case 'clone':
      if (d.cancelled) toast(t('toast.cloneCancelled'), 'warning');
      else {
        toast(t('toast.cloned'));
        reloadSession('clone');
        closeSessions();
      }
      break;
    case 'switch_session':
      if (d.cancelled) {
        toast(t('toast.switchCancelled'), 'warning');
        sbSyncActive();
      } else {
        toast(t('toast.switched'));
        reloadSession('switch_session');
        closeSessions();
        sbLoad();
      }
      break;
    case 'export_html':
      toast(t('toast.exported', { path: d.path || '?' }));
      break;
    case 'set_session_name':
      state.sessionName = $('#session-name-input').value.trim() || null;
      renderSessionInfo();
      toast(t('toast.renamed'));
      sbLoad();
      break;
    case 'new_session':
      if (!d.cancelled) {        chat.innerHTML = '';
        state.msgs = [];
        state.toolBlocks.clear();
        state.liveAssistant = null;
        state.lastUserMsg = null;
        noticeT('chat.newSession');
        applySavedModelPrefs(0);
        postJson(api('/api/trace/marker'), { kind: 'new_session', text: 'new session' });
        send({ type: 'get_state' }, { silent: true });
        refreshStats();
        loadTraceHistory();
        refreshChangesBadge();
        sbLoad();
      }
      break;
  }
}

function applyState(d) {
  if (d.sessionId) state.sessionId = d.sessionId;
  sbSyncActive();
  if ('sessionName' in d) state.sessionName = d.sessionName;
  if (d.model) {
    state.currentModel = d.model;
    const key = `${d.model.provider}/${d.model.id}`;
    if (![...modelSel.options].some((o) => o.value === key)) {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = d.model.name || key;
      modelSel.appendChild(o);
    }
    modelSel.value = key;
  }
  if (d.thinkingLevel != null) {
    if (![...thinkSel.options].some((o) => o.value === d.thinkingLevel)) {
      const o = document.createElement('option');
      o.value = d.thinkingLevel;
      o.textContent = d.thinkingLevel;
      thinkSel.appendChild(o);
    }
    thinkSel.value = d.thinkingLevel;
  }
  syncPicker();
  if (d.isStreaming != null) setStreaming(!!d.isStreaming);
}

function fillModels() {
  const cur = modelSel.value;
  modelSel.innerHTML = '';
  for (const m of state.models) {
    const o = document.createElement('option');
    o.value = `${m.provider}/${m.id}`;
    o.textContent = m.name || `${m.provider}/${m.id}`;
    modelSel.appendChild(o);
  }
  if (cur) modelSel.value = cur;
  syncPicker();
}

function fillThinking(levels) {
  thinkSel.innerHTML = '';
  for (const l of levels) {
    const o = document.createElement('option');
    o.value = l;
    o.textContent = l;
    thinkSel.appendChild(o);
  }
  syncPicker();
}

/* ------------------------------------------------------- model picker */

/**
 * One control for model + thinking level instead of two dropdowns. The native
 * selects stay in the DOM and remain the source of truth, so every existing
 * code path (set_model, set_thinking_level, remembered preferences) is untouched.
 */
const pickerBtn = $('#picker-btn');
const pickerPop = $('#picker-pop');
const pickerModels = $('#picker-models');
const pickerThinks = $('#picker-thinks');

function pickerGroup(host, options, current, onPick) {
  host.innerHTML = '';
  for (const o of options) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'picker-item' + (o.value === current ? ' on' : '');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(o.value === current));
    row.textContent = o.label;
    row.title = o.label;
    row.addEventListener('click', () => {
      onPick(o.value);
      closePicker();
    });
    host.appendChild(row);
  }
}

function syncPicker() {
  const modelOpts = [...modelSel.options].map((o) => ({ value: o.value, label: o.textContent }));
  const thinkOpts = [...thinkSel.options].map((o) => ({ value: o.value, label: o.textContent }));
  const pm = $('#picker-model');
  const pt = $('#picker-think');
  if (pm) pm.textContent = modelSel.selectedOptions[0]?.textContent || modelOpts[0]?.label || '—';
  if (pt) pt.textContent = thinkSel.value || thinkOpts[0]?.label || '—';
  if (pickerBtn) pickerBtn.title = `${t('toolbar.pickerTitle')}\n${modelSel.value} · ${thinkSel.value}`;
  if (!pickerPop || pickerPop.classList.contains('hidden')) return;
  pickerGroup(pickerModels, modelOpts, modelSel.value, (v) => {
    modelSel.value = v;
    modelSel.dispatchEvent(new Event('change'));
    syncPicker();
  });
  pickerGroup(pickerThinks, thinkOpts, thinkSel.value, (v) => {
    thinkSel.value = v;
    thinkSel.dispatchEvent(new Event('change'));
    syncPicker();
  });
}

function closePicker() {
  pickerPop?.classList.add('hidden');
  pickerBtn?.setAttribute('aria-expanded', 'false');
}

function openPicker() {
  if (!pickerPop) return;
  pickerPop.classList.remove('hidden');
  pickerBtn?.setAttribute('aria-expanded', 'true');
  syncPicker();
  pickerPop.querySelector('.picker-item.on')?.focus();
}

function renderStats(d) {
  if (d.sessionId) state.sessionId = d.sessionId;
  sbSyncActive();
  if (d.sessionFile) state.sessionFile = d.sessionFile;
  applySavedModelPrefs(d.messageCount ?? 0);
  const tokens = d.tokens?.total ?? 0;
  const cost = d.cost ?? 0;
  const cu = d.contextUsage;
  let s = `${fmtTokens(tokens)} ${t('stats.tokens')} · ${fmtCost(cost)}`;
  if (cu && cu.percent != null) s += ` · ${t('stats.ctx', { pct: Math.round(cu.percent) })}`;
  statsEl.textContent = s;
  const turn = state.lastUsage
    ? ` · ${t('stats.lastTurn', {
        in: fmtTokens(state.lastUsage.input ?? 0),
        out: fmtTokens(state.lastUsage.output ?? 0),
        cost: fmtCost(state.lastUsage.cost ? state.lastUsage.cost.total ?? 0 : 0),
      })}`
    : '';
  statsEl.title = `${t('toolbar.ctxLabel')}\n${tokens} tokens · ${fmtCost(cost)}${cu ? ` · ${cu.tokens}/${cu.contextWindow}` : ''}${turn}`;
  if (!sessionsEl.classList.contains('hidden')) renderSessionInfo();
}

function renderHistory(messages) {
  state.allMessages = Array.isArray(messages) ? messages : [];
  state.windowSize = PAGE_SIZE;
  renderMessageWindow(true);
}

/**
 * Only the newest PAGE_SIZE messages are in the DOM; older ones stay in memory
 * behind a "load earlier" button. Long sessions stay snappy without losing
 * anything.
 */
function renderMessageWindow(reset) {
  const all = state.allMessages;
  const start = Math.max(0, all.length - state.windowSize);
  const slice = all.slice(start);
  const prevHeight = chat.scrollHeight;
  const prevTop = chat.scrollTop;

  chat.innerHTML = '';
  state.msgs = [];
  state.toolBlocks.clear();
  state.liveAssistant = null;
  emptyNotice = null;
  curText = curThink = curTool = null;

  if (start > 0) {
    const btn = document.createElement('button');
    btn.id = 'load-earlier';
    btn.className = 'ghost';
    btn.textContent = t('chat.loadEarlier', { n: Math.min(PAGE_SIZE, start) });
    btn.addEventListener('click', () => {
      state.windowSize += PAGE_SIZE;
      renderMessageWindow(false);
    });
    chat.appendChild(btn);
  }

  const toolByCall = new Map();
  for (const m of slice) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'user') {
      const msg = addMessage('user');
      const blocks = contentBlocks(m.content);
      if (!blocks.length) addBlock(msg, { type: 'text', text: '' });
      blocks.forEach((b) => addBlock(msg, b));
    } else if (m.role === 'assistant') {
      const msg = addMessage('assistant');
      for (const b of contentBlocks(m.content)) {
        const nb = addBlock(msg, b);
        if (b.type === 'toolCall' && b.id) toolByCall.set(b.id, nb);
      }
      addCopyMessageButton(msg);
      if (m.stopReason === 'error') noticeT('chat.modelErrorWith', { msg: m.errorMessage }, 'error');
      if (m.stopReason === 'aborted') noticeT('chat.aborted', null, 'error');
    } else if (m.role === 'toolResult') {
      const b = (m.toolCallId && toolByCall.get(m.toolCallId)) || (m.toolCallId && state.toolBlocks.get(m.toolCallId));
      if (b) {
        b.result = extractText(m);
        b.isError = !!m.isError;
        b.status = b.isError ? 'error' : 'done';
        updateTool(b);
      } else {
        const msg = addMessage('assistant');
        const nb = addBlock(msg, {
          type: 'toolCall',
          name: m.toolName || t('label.tool'),
          argsText: '',
          result: extractText(m),
          isError: !!m.isError,
          status: m.isError ? 'error' : 'done',
        });
        if (m.toolCallId) toolByCall.set(m.toolCallId, nb);
      }
    } else if (m.role === 'custom') {
      if (m.display === false) continue;
      const msg = addMessage('system');
      const d = document.createElement('div');
      d.className = 'md';
      d.textContent = (m.customType ? `[${m.customType}] ` : '') + extractText(m.content);
      msg.bubble.appendChild(d);
    } else if (m.role === 'bashExecution') {
      const msg = addMessage('assistant');
      addBlock(msg, {
        type: 'toolCall',
        name: 'bash',
        args: { command: m.command },
        argsText: JSON.stringify({ command: m.command }, null, 2),
        result: m.output || '',
        isError: m.exitCode !== 0,
        status: m.exitCode === 0 ? 'done' : 'error',
      });
    }
  }
  if (!all.length) firstRunHint();
  refreshUserActions();
  decoratePres(chat);
  linkTraceJumps();
  if (reset) {
    toBottom(true);
  } else {
    // keep the reading position when older messages are prepended
    chat.scrollTop = chat.scrollHeight - prevHeight + prevTop;
  }
}

/* ------------------------------------------------------------- actions */

let lastStatus = null;

function setStatus(text, kind = '') {
  lastStatus = { text, kind };
  statusEl.textContent = text;
  statusEl.className = kind;
}

/** translated status: setStatusK('status.ready') */
function setStatusK(key, vars, kind = '') {
  lastStatus = { key, vars, kind };
  statusEl.textContent = t(key, vars);
  statusEl.className = kind;
}

/* ------------------------------------------------------------- run state */

const runState = { startedAt: 0, action: 'working', detail: '', timer: null };

function renderRunState() {
  if (!runStateEl) return;
  if (!runState.startedAt) {
    runStateEl.textContent = '';
    runStateEl.classList.remove('on');
    return;
  }
  const secs = ((Date.now() - runState.startedAt) / 1000).toFixed(1);
  runStateEl.textContent = `${t('run.' + runState.action, { name: runState.detail })} · ${secs}s`;
  runStateEl.classList.add('on');
}

function startRun() {
  runState.startedAt = Date.now();
  runState.action = 'working';
  runState.detail = '';
  if (!runState.timer) runState.timer = setInterval(renderRunState, 200);
  renderRunState();
}

function endRun() {
  runState.startedAt = 0;
  runState.detail = '';
  if (runState.timer) {
    clearInterval(runState.timer);
    runState.timer = null;
  }
  renderRunState();
  // the run just changed files on disk — refresh the Δ badge
  setTimeout(refreshChangesBadge, 400);
  setTimeout(sbTouchActive, 400);
}

function setRunAction(action, detail) {
  runState.action = action;
  runState.detail = detail || '';
  if (runState.startedAt) renderRunState();
}

function setStreaming(on) {
  state.streaming = on;
  btnStop.disabled = !on;
  btnSend.textContent = on ? t('common.queue') : t('common.send');
  // token-by-token updates must not be announced one by one
  if (chat) chat.setAttribute('aria-busy', String(on));
}

/** Announce once per turn through the visually hidden live region. */
function announce(text) {
  const el = document.getElementById('a11y-announcer');
  if (el) el.textContent = text;
}

function submit() {
  const text = input.value.trim();
  const atts = [...state.attachments];
  const images = atts.map((a) => ({ type: 'image', data: a.data, mimeType: a.mimeType }));
  if (!text && !images.length) return;
  closeAutocomplete();
  maybeAskNotify();
  input.value = '';
  input.classList.remove('ext-prefill');
  autosize();
  state.attachments = [];
  renderAttachments();

  const msg = addMessage('user');
  if (text) for (const b of contentBlocks(text)) addBlock(msg, b);
  for (const im of images) addBlock(msg, { type: 'image', data: im.data, mimeType: im.mimeType });
  state.lastUserMsg = msg;
  // keep the export/history model in sync with what is on screen
  state.allMessages.push({
    role: 'user',
    content: images.length ? [{ type: 'text', text }, ...images] : text,
    timestamp: Date.now(),
  });
  // lets onMessageStart() recognise the echo of this exact prompt and not draw it twice
  state.pendingUser = { text, images: images.length };
  pushHistory(text);
  clearDraft();
  toBottom(true);
  autoScroll = true;
  updateToLatest();
  refreshUserActions();

  const cmd = { type: 'prompt', message: text };
  if (images.length) cmd.images = images;
  if (state.streaming) cmd.streamingBehavior = 'steer';

  // If the server is unreachable, put the message back instead of losing it.
  send(cmd, { silent: true }).then((res) => {
    if (res === null) {
      if (text) input.value = text;
      state.attachments = atts;
      renderAttachments();
      autosize();
      input.focus();
      noticeT('chat.notSent', null, 'error');
      return;
    }
    if (res && res.ok === false) {
      notice(t('chat.promptRejected', { msg: res.error || t('chat.unknownError') }), 'error');
    }
  });
}

function refreshStats() {
  send({ type: 'get_session_stats' }, { silent: true });
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 220) + 'px';
}

/* ------------------------------------------------------------ wiring */

input.addEventListener('input', () => {
  autosize();
  acUpdate();
  saveDraft();
  if (histHintEl) histHintEl.textContent = '';
});
input.addEventListener('keydown', (ev) => {
  if (ac.open) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      acMove(1);
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      acMove(-1);
      return;
    }
    if (ev.key === 'Tab' || (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing)) {
      ev.preventDefault();
      acAccept();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeAutocomplete();
      return;
    }
  }
  // shell-style history: only when the caret sits at the very start/end
  if (ev.key === 'ArrowUp' && input.selectionStart === 0 && input.selectionEnd === 0) {
    if (browseHistory(-1)) ev.preventDefault();
    return;
  }
  if (ev.key === 'ArrowDown' && input.selectionStart === input.value.length) {
    if (browseHistory(1)) ev.preventDefault();
    return;
  }
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    submit();
  }
});
input.addEventListener('blur', () => setTimeout(closeAutocomplete, 120));
document.addEventListener('mousedown', (ev) => {
  if (ac.open && !acEl.contains(ev.target) && ev.target !== input) closeAutocomplete();
});
window.addEventListener('resize', () => {
  if (ac.open) acRender();
});
btnSend.addEventListener('click', submit);

btnStop.addEventListener('click', () => {
  send({ type: 'abort' });
  setStatusK('status.aborting', null, 'working');
});

btnNew.addEventListener('click', () => send({ type: 'new_session' }));

pickerBtn?.addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (pickerPop.classList.contains('hidden')) openPicker();
  else closePicker();
});
pickerPop?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    ev.preventDefault();
    closePicker();
    pickerBtn?.focus();
  }
});
document.addEventListener('click', (ev) => {
  if (pickerPop && !pickerPop.classList.contains('hidden') && !ev.target.closest('#model-picker')) closePicker();
});

modelSel.addEventListener('change', () => {
  const [provider, ...rest] = modelSel.value.split('/');
  rememberModel(modelSel.value);
  send({ type: 'set_model', provider, modelId: rest.join('/') });
});

thinkSel.addEventListener('change', () => {
  rememberThinking(thinkSel.value);
  send({ type: 'set_thinking_level', level: thinkSel.value });
  syncPicker();
});

$('#btn-trace-close').addEventListener('click', () => traceSetOpen(false));
traceDeltasEl.addEventListener('change', () => traceToggleDeltas(traceDeltasEl.checked));
traceFollowEl.addEventListener('change', () => {
  trace.follow = traceFollowEl.checked;
  traceFollow();
});
traceHistoryEl.addEventListener('change', () => selectTraceFile(traceHistoryEl.value));
$('#btn-trace-clear').addEventListener('click', () => {
  traceReset();
  traceList.innerHTML =
    '<div class="tr-row kind-meta"><div class="tr-t"></div><div class="tr-icon">·</div><div class="tr-main"><span class="tr-text dim">' +
    esc(t('trace.cleared')) +
    '</span></div></div>';
});
$('#btn-trace-export').addEventListener('click', () => {
  const blob = new Blob([trace.raw.map((r) => JSON.stringify(r)).join('\n') + '\n'], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (traceFileEl.textContent || 'trace') + '.ndjson';
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ============================================================== attachments */

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function renderAttachments() {
  attachmentsEl.innerHTML = '';
  attachmentsEl.classList.toggle('hidden', state.attachments.length === 0);
  state.attachments.forEach((att, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'att';
    const img = document.createElement('img');
    img.src = `data:${att.mimeType};base64,${att.data}`;
    img.alt = att.name || 'image';
    const rm = document.createElement('button');
    rm.className = 'att-remove';
    rm.textContent = '✕';
    rm.title = t('attach.remove');
    rm.addEventListener('click', () => {
      state.attachments.splice(i, 1);
      renderAttachments();
    });
    const size = document.createElement('span');
    size.className = 'att-size';
    size.textContent = Math.max(1, Math.round(att.bytes / 1024)) + 'kB';
    wrap.append(img, rm, size);
    attachmentsEl.appendChild(wrap);
  });
}

function fileToAttachment(file) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve(null);
    if (file.size > MAX_IMAGE_BYTES) {
      toast(t('attach.tooLarge', { mb: (file.size / 1024 / 1024).toFixed(1) }), 'warning');
      return resolve(null);
    }
    const fr = new FileReader();
    fr.onload = () => {
      const m = /^data:([^;]+);base64,(.*)$/.exec(String(fr.result || ''));
      if (!m) return resolve(null);
      resolve({ data: m[2], mimeType: m[1], bytes: file.size, name: file.name || 'pasted-image' });
    };
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(file);
  });
}

async function addImageFiles(files) {
  let added = 0;
  for (const f of files) {
    const att = await fileToAttachment(f);
    if (att) {
      state.attachments.push(att);
      added += 1;
    }
  }
  renderAttachments();
  if (added) toast(tp('attach.one', 'attach.other', added), 'info', 1600);
}

input.addEventListener('paste', async (ev) => {
  const items = ev.clipboardData && ev.clipboardData.items;
  if (!items) return;
  const files = [];
  let hasText = false;
  for (const it of items) {
    if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    } else if (it.kind === 'string' && it.type === 'text/plain') {
      hasText = true;
    }
  }
  if (!files.length) return;
  if (!hasText) ev.preventDefault();
  await addImageFiles(files);
});

for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (ev) => {
    if (!ev.dataTransfer) return;
    const hasFiles = [...ev.dataTransfer.types].includes('Files');
    if (!hasFiles) return;
    ev.preventDefault();
    if (type === 'drop') {
      const files = [...ev.dataTransfer.files].filter((f) => f.type && f.type.startsWith('image/'));
      if (files.length) addImageFiles(files);
    }
  });
}

$('#btn-attach').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (files.length) addImageFiles(files);
});

/* ================================================================= sessions */

let treeState = { tree: [], leafId: null, selectedId: null, byId: new Map(), parent: new Map() };
let lastTree = [];
let lastLeafId = null;
let sessionCache = [];

/* -------------------------------------------------------- session filters */

function treeFilterState() {
  const q = ($('#tree-search')?.value || '').trim().toLowerCase();
  const chips = [...document.querySelectorAll('#tree-roles .chip')];
  const roles = new Set(chips.filter((c) => c.classList.contains('on')).map((c) => c.dataset.role));
  const activeOnly = !!$('#tree-active-only')?.checked;
  return { q, roles, allRoles: chips.length, activeOnly, enabled: !!q || roles.size < chips.length || activeOnly };
}

function listFilterState() {
  return {
    q: ($('#list-search')?.value || '').trim().toLowerCase(),
    range: $('#list-range')?.value || 'all',
    sort: $('#list-sort')?.value || 'new',
    namedOnly: !!$('#list-named')?.checked,
  };
}

function debounce(fn, ms) {
  let timer;
  return (...a) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...a), ms);
  };
}

function previewText(content, max = 110) {
  const text = extractText(content).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

let sessionsA11y = null;

function openSessions() {
  if (!inspEl.classList.contains('hidden')) closeInspect();
  sessionsEl.classList.remove('hidden');
  if (!sessionsA11y) {
    const panel = sessionsEl.querySelector('.sessions-panel');
    const title = document.getElementById('sessions-title');
    sessionsA11y = makeDialogA11y(sessionsEl, panel, title ? title.id : undefined);
  }
  renderSessionInfo();
  refreshSessions();
}

function closeSessions() {
  sessionsEl.classList.add('hidden');
  if (sessionsA11y) {
    sessionsA11y();
    sessionsA11y = null;
  }
}

function refreshSessions() {
  send({ type: 'get_tree' }, { silent: true });
  loadSessionList(true);
  renderSessionInfo();
}

function switchTab(tab) {
  document.querySelectorAll('#sessions .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#tree-pane').classList.toggle('hidden', tab !== 'tree');
  $('#list-pane').classList.toggle('hidden', tab !== 'list');
  if (tab === 'list') loadSessionList();
}

function renderSessionInfo() {
  const info = $('#session-info');
  if (!info) return;
  info.innerHTML = '';
  const add = (k, v) => {
    if (v == null || v === '') return;
    const s = document.createElement('span');
    s.innerHTML = `<span class="k">${esc(k)}</span> ${esc(v)}`;
    info.appendChild(s);
  };
  add(t('sessions.info.name'), state.sessionName || t('sessions.info.none'));
  add(t('sessions.info.id'), state.sessionId ? state.sessionId.slice(0, 8) : '-');
  add(t('sessions.info.model'), state.currentModel ? `${state.currentModel.provider}/${state.currentModel.id}` : '-');
  add(t('sessions.info.file'), state.sessionFile ? state.sessionFile.split('/').pop() : '-');
  const nameInput = $('#session-name-input');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = state.sessionName || '';
}

function entryLabel(entry) {
  const m = entry.message;
  switch (entry.type) {
    case 'message': {
      if (!m) return { icon: '•', role: 'message', text: '' };
      if (m.role === 'user') return { icon: '👤', role: 'user', text: previewText(m.content) || t('entry.empty') };
      if (m.role === 'assistant') {
        const texts = (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
        const tools = (m.content || []).filter((c) => c.type === 'toolCall').map((c) => c.name);
        const text =
          previewText(texts) ||
          (tools.length
            ? t('entry.toolCalls', { list: tools.join(', ') })
            : t('entry.assistant', { reason: m.stopReason || 'stop' }));
        return { icon: '🤖', role: 'assistant', text };
      }
      if (m.role === 'toolResult')
        return {
          icon: '🔧',
          role: 'tool',
          text: `${m.toolName || t('label.tool')}${m.isError ? t('entry.toolResultError') : ''} · ${previewText(m.content, 80)}`,
        };
      if (m.role === 'custom')
        return { icon: '✦', role: 'custom', text: `[${m.customType || t('role.custom')}] ${previewText(m.content, 100)}` };
      if (m.role === 'bashExecution') return { icon: '⌨', role: 'tool', text: previewText(m.command, 100) };
      return { icon: '•', role: 'message', text: m.role };
    }
    case 'model_change':
      return { icon: '◇', role: 'meta', text: t('entry.model', { value: `${entry.provider}/${entry.modelId}` }) };
    case 'thinking_level_change':
      return { icon: '🧠', role: 'meta', text: t('entry.thinking', { value: entry.thinkingLevel }) };
    case 'compaction':
      return {
        icon: '⛶',
        role: 'meta',
        text: t('entry.compaction', { tokens: entry.tokensBefore ?? '?' }),
      };
    case 'branch_summary':
      return { icon: '⑂', role: 'meta', text: t('entry.branchSummary') };
    case 'custom':
      return { icon: '⚙', role: 'meta', text: t('entry.custom', { type: entry.customType }) };
    case 'custom_message':
      return { icon: '✦', role: 'custom', text: `[${entry.customType}] ${previewText(entry.content, 100)}` };
    case 'label':
      return {
        icon: '🏷',
        role: 'meta',
        text: entry.label ? t('entry.label', { value: entry.label }) : t('entry.labelCleared'),
      };
    case 'session_info':
      return {
        icon: 'ℹ',
        role: 'meta',
        text: t('entry.name', { value: entry.name || t('entry.nameCleared') }),
      };
    default:
      return { icon: '•', role: 'meta', text: entry.type };
  }
}

function renderTree(tree, leafId) {
  const view = $('#tree-view');
  const prevSel = treeState.selectedId;
  lastTree = tree || [];
  lastLeafId = leafId || null;
  view.innerHTML = '';
  treeState = { tree: lastTree, leafId: lastLeafId, selectedId: null, byId: new Map(), parent: new Map() };

  let total = 0;
  const index = (nodes, parentId) => {
    for (const n of nodes) {
      if (!n || !n.entry) continue;
      total += 1;
      treeState.byId.set(n.entry.id, n);
      treeState.parent.set(n.entry.id, parentId);
      index(n.children || [], n.entry.id);
    }
  };
  index(tree, null);

  const active = new Set();
  let cur = leafId;
  let guard = 0;
  while (cur && guard++ < 10000) {
    active.add(cur);
    cur = treeState.parent.get(cur);
  }

  // ---- filtering: match a node, then keep its ancestors for context --------
  const f = treeFilterState();
  let keep = null;
  let selfMatch = null;
  if (f.enabled) {
    keep = new Set();
    selfMatch = new Set();
    const test = (n) => {
      const lbl = entryLabel(n.entry);
      if (f.roles.size < f.allRoles && !f.roles.has(lbl.role)) return false;
      if (f.activeOnly && !active.has(n.entry.id)) return false;
      if (f.q) {
        const hay = `${lbl.text} ${lbl.role} ${n.label || ''} ${n.entry.id}`.toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    };
    const visit = (nodes) => {
      for (const n of nodes) {
        if (!n || !n.entry) continue;
        if (test(n)) {
          selfMatch.add(n.entry.id);
          let id = n.entry.id;
          let g = 0;
          while (id && g++ < 10000) {
            keep.add(id);
            id = treeState.parent.get(id);
          }
        }
        visit(n.children || []);
      }
    };
    visit(tree);
  }

  let rendered = 0;
  const frag = document.createDocumentFragment();
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (!n || !n.entry) continue;
      const e = n.entry;
      if (keep && !keep.has(e.id)) continue;
      rendered += 1;
      const lbl = entryLabel(e);
      const el = document.createElement('div');
      el.className =
        'tree-node kind-' +
        lbl.role +
        (active.has(e.id) ? ' active' : '') +
        (selfMatch && !selfMatch.has(e.id) ? ' dimmed' : '');
      el.style.paddingLeft = 14 + depth * 16 + 'px';
      el.dataset.id = e.id;
      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.textContent = lbl.icon;
      const role = document.createElement('span');
      role.className = 'tree-role';
      role.textContent = lbl.role;
      const text = document.createElement('span');
      text.className = 'tree-text';
      text.textContent = lbl.text;
      el.append(icon, role, text);
      if (n.label) {
        const l = document.createElement('span');
        l.className = 'tree-label';
        l.textContent = n.label;
        el.appendChild(l);
      }
      if (e.id === leafId) {
        const lf = document.createElement('span');
        lf.className = 'tree-leaf';
        lf.textContent = '← leaf';
        el.appendChild(lf);
      }
      el.addEventListener('click', () => selectTreeNode(e));
      el.setAttribute('role', 'treeitem');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-selected', String(treeState.selectedId === e.id));
      el.addEventListener('keydown', (ev) => {
        const nodes = [...view.querySelectorAll('.tree-node')];
        const i = nodes.indexOf(el);
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          nodes[Math.min(nodes.length - 1, i + 1)]?.focus();
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          nodes[Math.max(0, i - 1)]?.focus();
        } else if (ev.key === 'Home') {
          ev.preventDefault();
          nodes[0]?.focus();
        } else if (ev.key === 'End') {
          ev.preventDefault();
          nodes[nodes.length - 1]?.focus();
        } else if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          selectTreeNode(e);
        }
      });
      frag.appendChild(el);
      walk(n.children || [], depth + 1);
    }
  };
  walk(tree, 0);
  view.appendChild(frag);
  view.setAttribute('role', 'tree');

  const count = $('#tree-count');
  if (count) count.textContent = selfMatch ? t('trace.match', { n: selfMatch.size, shown: rendered, total }) : t('trace.nodes', { total });

  if (prevSel) {
    const n = treeState.byId.get(prevSel);
    if (n) selectTreeNode(n.entry);
  }
  if (leafId) view.querySelector(`[data-id="${leafId}"]`)?.scrollIntoView({ block: 'center' });
  updateSelectionButtons();
}

function selectTreeNode(entry) {
  treeState.selectedId = entry.id;
  document.querySelectorAll('.tree-node').forEach((el) => {
    const on = el.dataset.id === entry.id;
    el.classList.toggle('selected', on);
    el.setAttribute('aria-selected', String(on));
  });
  const node = treeState.byId.get(entry.id);
  const isUser = entry.type === 'message' && entry.message && entry.message.role === 'user';
  $('#session-selection').textContent = isUser
    ? t('sessions.selected', { id: entry.id.slice(0, 8), text: previewText(entry.message.content, 40) })
    : t('sessions.selectedType', { id: entry.id.slice(0, 8), type: t('role.' + entryLabel(entry).role) });
  const labelInput = $('#label-input');
  if (labelInput && document.activeElement !== labelInput) labelInput.value = (node && node.label) || '';
  updateSelectionButtons();
}

function updateSelectionButtons() {
  const node = treeState.selectedId ? treeState.byId.get(treeState.selectedId) : null;
  const e = node && node.entry;
  const isUser = !!(e && e.type === 'message' && e.message && e.message.role === 'user');
  $('#btn-session-fork').disabled = !isUser;
  $('#btn-session-label').disabled = !e;
  $('#btn-session-unlabel').disabled = !(node && node.label);
}

function applyBookmark(clear) {
  if (!treeState.selectedId) return;
  const label = clear ? '' : $('#label-input').value.trim();
  send({ type: 'prompt', message: `/gui-label ${treeState.selectedId}${label ? ' ' + label : ''}` });
  // the label is appended by pi's SessionManager; refresh the tree once it lands
  setTimeout(() => {
    if (!sessionsEl.classList.contains('hidden')) send({ type: 'get_tree' }, { silent: true });
  }, 600);
}

async function loadSessionList() {
  const view = $('#list-view');
  if (view.dataset.loading === '1') return;
  view.dataset.loading = '1';
  try {
    const data = await fetch(api('/api/sessions')).then((r) => r.json());
    sessionCache = data.sessions || [];
    renderSessionList();
  } catch (err) {
    view.innerHTML = '';
    toast(t('toast.listFailed', { msg: err.message }), 'error');
  } finally {
    view.dataset.loading = '';
  }
}

function renderSessionList() {
  const view = $('#list-view');
  const f = listFilterState();
  let items = sessionCache.slice();

  if (f.q) {
    items = items.filter((s) => `${s.name || ''} ${s.preview || ''} ${s.id || ''} ${s.file}`.toLowerCase().includes(f.q));
  }
  if (f.namedOnly) items = items.filter((s) => !!s.name);
  if (f.range !== 'all') {
    const cutoff = Date.now() - Number(f.range) * 86400000;
    items = items.filter((s) => s.mtime >= cutoff);
  }
  const comparators = {
    new: (a, b) => b.mtime - a.mtime,
    old: (a, b) => a.mtime - b.mtime,
    big: (a, b) => b.size - a.size,
    entries: (a, b) => (b.entries || 0) - (a.entries || 0),
  };
  items.sort(comparators[f.sort] || comparators.new);

  const count = $('#list-count');
  if (count) count.textContent = `${items.length} / ${sessionCache.length}`;

  view.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'session-item';
    const main = document.createElement('div');
    main.className = 's-main';
    const sub = document.createElement('div');
    sub.className = 's-sub';
    sub.textContent = sessionCache.length ? t('sessions.list.noMatch') : t('sessions.list.empty');
    main.appendChild(sub);
    empty.appendChild(main);
    view.appendChild(empty);
    return;
  }

  for (const s of items) {
    const item = document.createElement('div');
    item.className = 'session-item' + (state.sessionFile && s.path === state.sessionFile ? ' current' : '');
    const main = document.createElement('div');
    main.className = 's-main';
    const title = document.createElement('div');
    title.className = 's-title';
    title.textContent = s.title || s.name || s.preview || t('sessions.emptySession');
    title.title = title.textContent;
    const sub = document.createElement('div');
    sub.className = 's-sub';
    // this list spans every workspace now, so say which one each session is in
    sub.textContent =
      (s.workspaceLabel ? s.workspaceLabel + ' · ' : '') +
      t('sessions.entryMeta', {
        id: s.id ? s.id.slice(0, 8) : '?',
        n: s.entries,
        kb: (s.size / 1024).toFixed(0),
      }) +
      (s.turns ? ` · ${s.turns}${t('sessions.turnsSuffix')} · ${fmtCost(s.cost || 0)}` : '');
    main.append(title, sub);
    const meta = document.createElement('div');
    meta.className = 's-meta';
    meta.textContent = new Date(s.mtime).toLocaleString();
    const del = document.createElement('button');
    del.className = 's-del ghost tiny';
    del.textContent = t('common.delete');
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      armDelete(del, s);
    });
    item.append(main, meta, del);
    item.addEventListener('click', () => {
      state.sessionId = s.id || state.sessionId;
      send({ type: 'switch_session', sessionPath: s.path });
      sbRender();
    });
    view.appendChild(item);
  }
}

function armDelete(btn, s) {
  if (btn.dataset.armed === '1') {
    fetch(api('/api/session/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: s.path }),
    })
      .then((r) => r.json())
      .then((r) => {
        if (r.ok) {
          toast(t('toast.deleted', { file: s.file }));
          loadSessionList();
        } else toast(t('toast.deleteFailed', { msg: r.error || '?' }), 'error');
      })
      .catch((err) => toast(t('toast.deleteFailed', { msg: err.message }), 'error'));
    return;
  }
  btn.dataset.armed = '1';
  btn.classList.add('arm');
  btn.textContent = t('common.armed');
  setTimeout(() => {
    btn.dataset.armed = '';
    btn.classList.remove('arm');
    btn.textContent = t('common.delete');
  }, 3000);
}

function reloadSession(reason) {
  chat.innerHTML = '';
  state.msgs = [];
  state.allMessages = [];
  state.toolBlocks.clear();
  state.liveAssistant = null;
  state.lastUserMsg = null;
  state.sessionId = null;
  state.entries = [];
  state.leafId = null;
  state.inspect = [];
  state.inspectSizes = [];
  state.inspectBytes = 0;
  state.agents = [];
  state.lastSeq = 0;
  traceReset();
  curText = curThink = curTool = null;
  emptyNotice = null;
  send({ type: 'get_messages' }, { silent: true });
  send({ type: 'get_state' }, { silent: true });
  send({ type: 'get_tree' }, { silent: true });
  refreshStats();
  loadTraceHistory();
  refreshChangesBadge();
  // the registry lives on the server (keyed by pid) — ask again after a reset
  fetch(api('/api/agents'))
    .then((r) => r.json())
    .then((d) => {
      state.agents = d.agents || [];
      syncAgentSelect();
      if (!inspEl.classList.contains('hidden')) renderInspect();
    })
    .catch(() => {});
  postJson(api('/api/trace/marker'), { kind: reason || 'session', text: reason || 'session changed' });
  sbLoad();
}

$('#btn-sessions-close').addEventListener('click', closeSessions);
$('#btn-sessions-refresh').addEventListener('click', refreshSessions);
document.querySelectorAll('#sessions .tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
$('#btn-session-fork').addEventListener('click', () => {
  if (treeState.selectedId) send({ type: 'fork', entryId: treeState.selectedId });
});
$('#btn-session-clone').addEventListener('click', () => send({ type: 'clone' }));
$('#btn-session-label').addEventListener('click', () => applyBookmark(false));
$('#btn-session-unlabel').addEventListener('click', () => applyBookmark(true));
$('#btn-session-export').addEventListener('click', () => send({ type: 'export_html' }));
$('#btn-session-rename').addEventListener('click', () => {
  const name = $('#session-name-input').value.trim();
  send({ type: 'set_session_name', name });
});
sessionsEl.addEventListener('mousedown', (ev) => {
  if (ev.target === sessionsEl) closeSessions();
});

/* filter wiring */
$('#tree-search')?.addEventListener('input', debounce(() => renderTree(lastTree, lastLeafId), 120));
$('#tree-active-only')?.addEventListener('change', () => renderTree(lastTree, lastLeafId));
document.querySelectorAll('#tree-roles .chip').forEach((chip) =>
  chip.addEventListener('click', () => {
    chip.classList.toggle('on');
    renderTree(lastTree, lastLeafId);
  }),
);
$('#list-search')?.addEventListener('input', debounce(renderSessionList, 120));
for (const sel of ['#list-range', '#list-sort', '#list-named']) $(sel)?.addEventListener('change', renderSessionList);
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (document.querySelector('.modal') || ac.open) return; // modals/autocomplete handle their own
  if (!inspEl.classList.contains('hidden')) {
    closeInspect();
    return;
  }
  if (!sessionsEl.classList.contains('hidden')) closeSessions();
});

/* =================================================================== theme */

const MODEL_KEY = 'pi-gui-model';
const THINK_KEY = 'pi-gui-thinking';
const LAYOUT_KEY = 'pi-gui-layout';
const lightMedia = window.matchMedia('(prefers-color-scheme: light)');
let themeMode = 'system';

function resolveTheme(mode) {
  return mode === 'light' || mode === 'dark' ? mode : lightMedia.matches ? 'light' : 'dark';
}

function rememberModel(value) {
  try {
    if (value) localStorage.setItem(MODEL_KEY, value);
  } catch {}
}

function rememberThinking(value) {
  try {
    if (value) localStorage.setItem(THINK_KEY, value);
  } catch {}
}

/**
 * pi keeps the model and thinking level *per session* (they are persisted as
 * model_change / thinking_level_change entries), so a brand new session would
 * otherwise silently fall back to pi's configured default. Apply the user's last
 * choice to sessions that have no messages yet — an existing conversation keeps
 * whatever it was using.
 */
function applySavedModelPrefs(messageCount) {
  if (messageCount > 0) return;
  let wantModel = '';
  let wantThink = '';
  try {
    wantModel = localStorage.getItem(MODEL_KEY) || '';
    wantThink = localStorage.getItem(THINK_KEY) || '';
  } catch {}
  const current = state.currentModel ? `${state.currentModel.provider}/${state.currentModel.id}` : '';
  if (wantModel && wantModel !== current) {
    const [provider, ...rest] = wantModel.split('/');
    if (provider && rest.length) send({ type: 'set_model', provider, modelId: rest.join('/') }, { silent: true });
  }
  if (wantThink && wantThink !== thinkSel.value) {
    send({ type: 'set_thinking_level', level: wantThink }, { silent: true });
  }
}

function applyTheme(mode) {
  themeMode = mode;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  const btn = $('#btn-theme');
  if (btn) {
    btn.textContent = resolved === 'light' ? '☀️' : '🌙';
    btn.title = t('settings.themeTitle', { mode });
  }
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {}
}

try {
  themeMode = localStorage.getItem(THEME_KEY) || 'system';
} catch {}
applyTheme(themeMode);
lightMedia.addEventListener('change', () => {
  if (themeMode === 'system') applyTheme('system');
});

/* ------------------------------------------------ draft + input history */

const DRAFT_KEY = 'pi-gui-draft';
const HIST_KEY = 'pi-gui-history';
const HIST_MAX = 50;
let inputHistory = [];
let histIndex = -1;
let draftTimer = null;

function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, input.value);
    } catch {}
  }, 250);
}

function loadDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY) || '';
  } catch {
    return '';
  }
}

function clearDraft() {
  clearTimeout(draftTimer);
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

function loadHistory() {
  try {
    const a = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushHistory(text) {
  if (!text) return;
  inputHistory = inputHistory.filter((x) => x !== text);
  inputHistory.push(text);
  if (inputHistory.length > HIST_MAX) inputHistory = inputHistory.slice(-HIST_MAX);
  histIndex = -1;
  if (histHintEl) histHintEl.textContent = '';
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(inputHistory));
  } catch {}
}

function browseHistory(delta) {
  if (!inputHistory.length) return false;
  if (histIndex === -1) histIndex = inputHistory.length;
  histIndex = Math.min(inputHistory.length, Math.max(0, histIndex + delta));
  input.value = histIndex >= inputHistory.length ? '' : inputHistory[histIndex];
  autosize();
  saveDraft();
  const caret = input.value.length;
  input.setSelectionRange(caret, caret);
  if (histHintEl) {
    histHintEl.textContent =
      histIndex >= inputHistory.length ? '' : `${inputHistory.length - histIndex}/${inputHistory.length}`;
  }
  return true;
}

/* ------------------------------------------------------------- diagnostics */

let lastInfoModal = null;

function showInfoModal(title, buildBody, opts = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const head = document.createElement('div');
  head.className = 'modal-head';
  head.id = 'info-modal-title';
  head.textContent = title;
  const body = document.createElement('div');
  body.className = 'modal-body';
  buildBody(body);
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  let releaseA11y = () => {};
  const close = () => {
    releaseA11y();
    backdrop.remove();
  };

  const ok = document.createElement('button');
  ok.className = 'primary';
  ok.textContent = t('common.close');
  ok.addEventListener('click', close);

  if (opts.foot === 'close') {
    foot.append(spacer, ok);
  } else {
    const restart = document.createElement('button');
    restart.className = 'ghost';
    restart.textContent = t('diag.restartPi');
    restart.addEventListener('click', async () => {
      await postJson(api('/api/restart'), {});
      toast(t('diag.restarting'));
      setTimeout(close, 500);
    });
    foot.append(restart, spacer, ok);
  }
  modal.append(head, body, foot);
  backdrop.appendChild(modal);
  modalRoot.appendChild(backdrop);
  releaseA11y = makeDialogA11y(backdrop, modal, head.id);
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) close();
  });
  lastInfoModal = { close };
  return lastInfoModal;
}

/* --------------------------------------------------------------- settings */

let settingsHandle = null;

function closeSettings() {
  if (settingsHandle) settingsHandle.close();
  settingsHandle = null;
}

/**
 * Everything that is not needed mid-conversation lives here, so the toolbar can
 * stay down to two selects, the usage pill, Settings, New and Stop.
 */
function openSettings() {
  if (settingsHandle) return;
  showInfoModal(
    t('settings.title'),
    (body) => {
      const wrap = document.createElement('div');
      wrap.className = 'set-list';

      const row = (label, hint, control) => {
        const el = document.createElement('div');
        el.className = 'set-row';
        const left = document.createElement('div');
        left.className = 'set-label';
        left.textContent = label;
        if (hint) {
          const h = document.createElement('div');
          h.className = 'set-hint';
          h.textContent = hint;
          left.appendChild(h);
        }
        const right = document.createElement('div');
        right.className = 'set-control';
        right.appendChild(control);
        el.append(left, right);
        wrap.appendChild(el);
      };

      const group = (...nodes) => {
        const g = document.createElement('div');
        g.className = 'set-group';
        g.append(...nodes);
        return g;
      };

      const btn = (id, label, title, on) => {
        const b = document.createElement('button');
        if (id) b.id = id;
        b.className = 'ghost';
        b.textContent = label;
        b.title = title || label;
        b.addEventListener('click', on);
        return b;
      };

      // appearance — the ☀/🌙 and 中/EN labels are owned by applyTheme/applyI18n
      row(
        t('settings.appearance'),
        t('settings.appearanceHint'),
        group(
          btn('btn-theme', '🌙', t('toolbar.theme'), () =>
            applyTheme(themeMode === 'system' ? 'light' : themeMode === 'light' ? 'dark' : 'system'),
          ),
          btn('btn-lang', '中', 'Language', () => setLang(lang === 'zh' ? 'en' : 'zh')),
        ),
      );

      // panels
      row(
        t('settings.panels'),
        t('settings.panelsHint'),
        group(
          btn('btn-trace', t('common.trace'), t('palette.trace'), () => dockToggle('trace')),
          btn('btn-context', t('dock.context'), t('palette.context'), () => dockToggle('context')),
          btn('btn-changes-sm', t('dock.changes'), t('palette.changes'), () => dockToggle('changes')),
          btn('btn-sessions', t('common.sessions'), '', () => {
            closeSettings();
            openSessions();
          }),
          btn('btn-inspect', t('inspect.title'), '', () => {
            closeSettings();
            openInspect();
          }),
        ),
      );

      // conversation
      row(
        t('settings.conversation'),
        t('settings.conversationHint'),
        group(
          btn('btn-export-md', t('settings.exportMd'), '', () => exportConversation()),
          btn('', t('common.new'), '', () => {
            closeSettings();
            send({ type: 'new_session' });
          }),
        ),
      );

      // layout
      row(
        t('settings.layout'),
        t('settings.layoutHint'),
        (() => {
          const wrap = document.createElement('div');
          wrap.id = 'layout-picker';
          wrap.className = 'seg';
          for (const [mode, label] of [
            ['comfortable', t('settings.layoutComfortable')],
            ['compact', t('settings.layoutCompact')],
          ]) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'seg-btn' + (mode === layoutMode ? ' on' : '');
            b.dataset.layout = mode;
            b.setAttribute('aria-pressed', String(mode === layoutMode));
            b.textContent = label;
            b.addEventListener('click', () => applyLayout(mode));
            wrap.appendChild(b);
          }
          return wrap;
        })(),
      );

      // keyboard reference
      row(
        t('settings.keys'),
        '',
        group(
          (() => {
            const ul = document.createElement('ul');
            ul.className = 'set-keys';
            for (const line of [
              t('firstRun.keyboard'),
              t('firstRun.files'),
              t('firstRun.input'),
              t('firstRun.panels'),
              t('settings.keysChanges'),
              t('settings.keysExport'),
              t('settings.keysSidebar'),
              t('settings.keysSession'),
            ]) {
              const li = document.createElement('li');
              li.innerHTML = line;
              ul.appendChild(li);
            }
            return ul;
          })(),
        ),
      );

      // runtime
      row(
        t('settings.runtime'),
        t('settings.runtimeHint'),
        group(
          btn('btn-diag', t('diag.title'), '', () => {
            closeSettings();
            openDiagnostics();
          }),
          btn('btn-restart', t('diag.restartPi'), '', () => {
            postJson(api('/api/restart'), {});
            toast(t('diag.restarting'));
          }),
        ),
      );

      const info = document.createElement('dl');
      info.className = 'diag';
      const add = (k, v) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = String(v ?? '—');
        info.append(dt, dd);
      };
      add(t('diag.cwd'), cwdEl.textContent || cwdEl.title);
      add(t('diag.chat'), `${state.msgs.length} / ${state.allMessages.length}`);
      add('session', state.sessionId ? state.sessionId.slice(0, 8) : '—');
      add('client', CLIENT_ID);
      add(t('diag.theme'), `${themeMode} / ${lang}`);
      wrap.appendChild(info);

      body.appendChild(wrap);
    },
    { foot: 'close' },
  );
  settingsHandle = lastInfoModal;
  // the modal is in the document now, so the shared label helpers can find the buttons
  applyTheme(themeMode);
  applyI18n();
  applyStyleLabels();
}

/** the ☀/🌙 and 中/EN labels live on buttons that only exist inside Settings */
/**
 * compact is the default: the boxed layout renders one assistant reply as two
 * cards, because pi sends the tool group and the prose as separate messages.
 * Extracted so the boot default is testable.
 */
function preferredLayout() {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'comfortable' ? 'comfortable' : 'compact';
  } catch {
    return 'compact';
  }
}

let layoutMode = preferredLayout();

/** Two readings of the same transcript: boxed turns, or one dense document. */
function applyLayout(mode, persist = true) {
  layoutMode = mode === 'compact' ? 'compact' : 'comfortable';
  const app = $('#app');
  if (app) app.classList.toggle('layout-compact', layoutMode === 'compact');
  for (const btn of document.querySelectorAll('#layout-picker .seg-btn')) {
    const on = btn.dataset.layout === layoutMode;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  if (persist) {
    try {
      localStorage.setItem(LAYOUT_KEY, layoutMode);
    } catch {}
  }
}

function applyStyleLabels() {
  const themeBtn = $('#btn-theme');
  if (themeBtn) themeBtn.textContent = resolveTheme(themeMode) === 'light' ? '☀️' : '🌙';
  const langBtn = $('#btn-lang');
  if (langBtn) langBtn.textContent = lang === 'zh' ? 'EN' : '中';
}

async function openDiagnostics() {
  let diag = {};
  let info = {};
  try {
    [diag, info] = await Promise.all([
      fetch(api('/api/diagnostics')).then((r) => r.json()),
      fetch(api('/api/info')).then((r) => r.json()),
    ]);
  } catch {}

  showInfoModal(t('diag.title'), (body) => {
    const dl = document.createElement('dl');
    dl.className = 'diag';
    const add = (k, v, cls) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = String(v);
      if (cls) dd.className = cls;
      dl.append(dt, dd);
    };
    const when = (o) => (o && o.at ? `${o.type} @ ${new Date(o.at).toLocaleTimeString()}` : t('diag.none'));

    add(t('diag.pi'), diag.alive ? t('diag.running', { pid: diag.pid }) : t('diag.stopped'), diag.alive ? 'ok' : 'bad');
    add(t('diag.server'), location.origin);
    add(t('diag.cwd'), info.cwd || '-');
    add(t('diag.clients'), diag.sseClients ?? '-');
    add(t('diag.lastCommand'), when(diag.lastCommand));
    add(t('diag.lastEvent'), when(diag.lastEvent));
    add(t('diag.uptime'), fmtDur(diag.uptimeMs || 0));
    add(t('diag.trace'), diag.traceFile ? diag.traceFile.split('/').pop() : '-');
    add(t('diag.chat'), `${state.msgs.length}`);
    add(t('diag.theme'), `${themeMode} / ${lang}`);
    body.appendChild(dl);
  });
}

/* ------------------------------------------------------------ palette */

function paletteItems() {
  const out = [];
  const add = (label, hint, run) => out.push({ label, hint: hint || '', run });
  add(t('palette.newSession'), '', () => send({ type: 'new_session' }));
  add(t('palette.restart'), '', () => {
    postJson(api('/api/restart'), {});
    toast(t('diag.restarting'));
  });
  add(t('palette.trace'), trace.open ? t('palette.on') : t('palette.off'), () => traceSetOpen(!trace.open));
  add(t('palette.sessions'), '', () => openSessions());
  add(t('palette.diagnostics'), '', () => openDiagnostics());
  add(t('palette.export'), '.md', () => exportConversation());
  add(t('palette.theme'), themeMode, () =>
    applyTheme(themeMode === 'system' ? 'light' : themeMode === 'light' ? 'dark' : 'system'),
  );
  add(t('palette.language'), lang, () => setLang(lang === 'zh' ? 'en' : 'zh'));
  for (const m of state.models) {
    add(t('palette.model', { name: m.name || m.id }), `${m.provider}/${m.id}`, () =>
      send({ type: 'set_model', provider: m.provider, modelId: m.id }),
    );
  }
  paletteExtraActions(add);
  for (const c of state.commands) {
    add(`/${c.name}`, c.description || c.source || '', () => {
      input.value = `/${c.name} `;
      autosize();
      input.focus();
    });
  }
  return out;
}

/** One keyboard entry point for every action (⌘/Ctrl+K). */
function openPalette() {
  if (document.querySelector('.palette-backdrop')) return;
  const items = paletteItems();
  let filtered = items;
  let index = 0;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop palette-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal palette';
  const box = document.createElement('input');
  box.type = 'text';
  box.className = 'palette-input';
  box.placeholder = t('palette.placeholder');
  box.setAttribute('aria-label', t('palette.placeholder'));
  const list = document.createElement('div');
  list.className = 'palette-list';
  list.setAttribute('role', 'listbox');
  modal.append(box, list);
  backdrop.appendChild(modal);
  modalRoot.appendChild(backdrop);

  const releaseA11y = makeDialogA11y(backdrop, modal);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    releaseA11y();
    backdrop.remove();
  };
  const runAt = (i) => {
    const it = filtered[i];
    if (!it) return;
    close();
    setTimeout(() => it.run && it.run(), 0);
  };
  const highlight = () => {
    [...list.children].forEach((c, j) => {
      if (!c.classList) return;
      c.classList.toggle('sel', j === index);
      c.setAttribute('aria-selected', String(j === index));
    });
  };
  let sessionHits = [];
  let searchTimer = null;
  const runSearch = () => {
    const q = box.value.trim();
    if (q.length < 2) {
      sessionHits = [];
      render();
      return;
    }
    fetch(api('/api/search') + `&q=${encodeURIComponent(q)}&limit=6`)
      .then((r) => r.json())
      .then((d) => {
        if (box.value.trim() !== q) return;
        sessionHits = (d.results || []).map((r) => ({
          label: (r.name || r.file).slice(0, 54),
          hint: (r.hits[0] ? r.hits[0].snippet : '').slice(0, 72),
          session: true,
          run: () => {
            send({ type: 'switch_session', sessionPath: r.path });
            toast(t('toast.switched'));
          },
        }));
        render();
      })
      .catch(() => {});
  };
  const render = () => {
    const q = box.value.trim().toLowerCase();
    filtered = q ? items.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(q)) : items;
    if (q.length >= 2 && sessionHits.length) filtered = filtered.concat(sessionHits);
    index = 0;
    list.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = t('palette.noMatch');
      list.appendChild(empty);
      return;
    }
    filtered.forEach((it, i) => {
      const el = document.createElement('div');
      el.className = 'palette-item' + (i === 0 ? ' sel' : '') + (it.session ? ' session-hit' : '');
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(i === 0));
      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = it.label;
      const hint = document.createElement('span');
      hint.className = 'palette-hint';
      hint.textContent = it.hint;
      el.append(label, hint);
      el.addEventListener('mousemove', () => {
        index = i;
        highlight();
      });
      el.addEventListener('click', () => runAt(i));
      list.appendChild(el);
    });
  };
  const move = (d) => {
    if (!filtered.length) return;
    index = (index + d + filtered.length) % filtered.length;
    highlight();
    list.children[index]?.scrollIntoView({ block: 'nearest' });
  };

  box.addEventListener('input', () => {
    render();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 170);
  });
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      move(1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      move(-1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      runAt(index);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  });
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) close();
  });
  render();
  setTimeout(() => box.focus(), 0);
}

/* -------------------------------------------------------------- inspector */

const inspEl = $('#inspect');
const inspBody = $('#inspect-body');
let inspTab = 'prompt';
let inspRenderTimer = null;
const EST_CHARS_PER_TOKEN = 4;

function upsertAgent(agent) {
  if (!agent || !agent.key) return;
  const i = state.agents.findIndex((a) => a.key === agent.key);
  if (i === -1) state.agents.push(agent);
  else state.agents[i] = { ...state.agents[i], ...agent };
  syncAgentSelect();
}

function syncAgentSelect() {
  const sel = $('#inspect-agent');
  if (!sel) return;
  const list = state.agents.length ? state.agents : [{ key: 'main', child: false, task: null }];
  sel.innerHTML = '';
  for (const a of list) {
    const o = document.createElement('option');
    o.value = a.key;
    const label = a.child ? `└ ${a.model || a.key}` : `★ ${t('inspect.agents.main')}`;
    o.textContent = a.task ? `${label} — ${previewText(a.task, 30)}` : label;
    sel.appendChild(o);
  }
  if (!list.some((a) => a.key === state.inspectAgent)) state.inspectAgent = 'main';
  sel.value = state.inspectAgent;
}

function pushInspect(rec) {
  let size = 0;
  try {
    size = JSON.stringify(rec).length;
  } catch {}
  state.inspect.push(rec);
  state.inspectSizes.push(size);
  state.inspectBytes += size;
  while (state.inspect.length > 50 && (state.inspect.length > 400 || state.inspectBytes > INSPECT_MAX_BYTES)) {
    state.inspect.shift();
    state.inspectBytes -= state.inspectSizes.shift() || 0;
  }
}

const currentAgentRecords = () =>
  state.inspect.filter((r) => (r.agent || 'main') === state.inspectAgent);
const inspAll = (kind) => currentAgentRecords().filter((r) => r.kind === kind);
const inspLatest = (kind) => {
  const a = inspAll(kind);
  return a.length ? a[a.length - 1] : null;
};
const estTokens = (chars) => Math.round((chars || 0) / EST_CHARS_PER_TOKEN);

function fmtChars(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0) + 'k';
  return (n / 1e6).toFixed(1) + 'M';
}

const ROLE_COLOR = {
  system: 'var(--blue)',
  user: 'var(--purple)',
  assistant: 'var(--ok)',
  toolResult: 'var(--warn)',
  custom: 'var(--pink)',
};

let inspectA11y = null;

function openInspect() {
  if (!sessionsEl.classList.contains('hidden')) closeSessions();
  inspEl.classList.remove('hidden');
  syncAgentSelect();
  if (!inspectA11y) {
    const panel = inspEl.querySelector('.sessions-panel');
    const title = document.getElementById('inspect-title');
    inspectA11y = makeDialogA11y(inspEl, panel, title ? title.id : undefined);
  }
  send({ type: 'get_entries' }, { silent: true });
  send({ type: 'get_available_models' }, { silent: true });
  fetch(api('/api/inspect'))
    .then((r) => r.json())
    .then((d) => {
      if (Array.isArray(d.agents)) {
        state.agents = d.agents;
        syncAgentSelect();
      }
      if (Array.isArray(d.records) && d.records.length > state.inspect.length) {
        state.inspect = [];
        state.inspectSizes = [];
        state.inspectBytes = 0;
        for (const rec of d.records) pushInspect(rec);
      }
      if (Array.isArray(d.agents)) {
        state.agents = d.agents;
        syncAgentSelect();
      }
      renderInspect();
    })
    .catch(() => {});
  renderInspect();
}

function closeInspect() {
  inspEl.classList.add('hidden');
  if (inspectA11y) {
    inspectA11y();
    inspectA11y = null;
  }
}

function switchInspectTab(tab) {
  inspTab = tab;
  document.querySelectorAll('#inspect-tabs .tab').forEach((el) => el.classList.toggle('active', el.dataset.itab === tab));
  renderInspect();
}

function scheduleInspectRender() {
  if (dockPaneContext && !dockPaneContext.classList.contains('hidden')) renderDockContext();
  if (inspEl.classList.contains('hidden')) return;
  clearTimeout(inspRenderTimer);
  inspRenderTimer = setTimeout(renderInspect, 250);
}

function inspSection(title, html) {
  return `<div class="insp-sec"><h4>${esc(title)}</h4>${html}</div>`;
}

function kvRows(pairs) {
  return pairs
    .map(
      ([k, v, n]) =>
        `<div class="insp-row"><span class="mono">${esc(k)}</span><span></span><span title="${esc(v ?? '')}">${esc(v ?? '')}</span><span class="r">${n == null ? '' : esc(String(n))}</span></div>`,
    )
    .join('');
}

let lazyStore = [];

/** A collapsible block whose (potentially huge) body is only put in the DOM on open. */
function lazyDetails(summary, text, open = false) {
  const idx = lazyStore.push(String(text ?? '')) - 1;
  return `<details data-lazy="${idx}"${open ? ' open' : ''}><summary class="insp-sum">${esc(
    summary,
  )}</summary><pre class="insp-pre"></pre></details>`;
}

function renderInspect() {
  const count = $('#inspect-count');
  if (count) count.textContent = state.inspect.length ? `${state.inspect.length} records` : '';
  if (inspEl.classList.contains('hidden')) return;

  const builders = {
    prompt: renderInspPrompt,
    context: renderInspContext,
    requests: renderInspRequests,
    session: renderInspSession,
    caps: renderInspCaps,
    replay: renderInspReplay,
    agents: renderInspAgents,
  };
  lazyStore = [];
  inspBody.innerHTML = '';
  (builders[inspTab] || renderInspPrompt)(inspBody);
  fillLazy(inspBody);
  decoratePres(inspBody);
}

/* ---- system prompt ------------------------------------------------------ */

function renderInspPrompt(root) {
  const rec = inspLatest('system_prompt');
  if (!rec) {
    root.innerHTML = `<div class="insp-empty">${esc(t('inspect.noPrompt'))}</div>`;
    return;
  }
  const d = rec.data || {};
  const files = d.contextFiles || [];
  const skills = d.skills || [];
  const snippets = Object.entries(d.toolSnippets || {});
  const guidelines = d.promptGuidelines || [];

  let html = '';
  html += inspSection(
    t('inspect.prompt.size'),
    kvRows([
      ['chars', '', d.chars],
      ['~tokens', '', estTokens(d.chars)],
      ['images', '', d.images ?? 0],
    ]),
  );
  html += inspSection(
    t('inspect.prompt.composition'),
    kvRows([
      ['cwd', d.cwd],
      ['selectedTools', (d.selectedTools || []).join(', '), (d.selectedTools || []).length],
      ['toolSnippets', snippets.map(([k, v]) => `${k}: ${v}`).join('  ·  '), snippets.length],
      ['guidelines', guidelines.join('  ·  '), guidelines.length],
      ['contextFiles', files.map((f) => `${f.path} (${fmtChars(f.chars)})`).join('  ·  '), files.length],
      ['skills', skills.map((s) => s.name).join(', '), skills.length],
      ['customPrompt', d.customPrompt ? t('inspect.yes') : t('inspect.no')],
      ['appendPrompt', d.appendSystemPrompt ? t('inspect.yes') : t('inspect.no')],
    ]),
  );
  html += inspSection(t('inspect.prompt.full'), lazyDetails(t('inspect.showFull'), d.systemPrompt || ''));
  root.innerHTML = html;
}

/* ---- context ------------------------------------------------------------ */

function renderInspContext(root) {
  const rec = inspLatest('context');
  if (!rec) {
    root.innerHTML = `<div class="insp-empty">${esc(t('inspect.noContext'))}</div>`;
    return;
  }
  const d = rec.data || {};
  const msgs = d.messages || [];
  const total = Math.max(1, d.chars || 1);
  const bar = msgs
    .map((m) => `<i style="width:${(((m.chars || 0) / total) * 100).toFixed(2)}%;background:${ROLE_COLOR[m.role] || 'var(--faint)'}"></i>`)
    .join('');
  const legend = Object.entries(ROLE_COLOR)
    .filter(([role]) => msgs.some((m) => m.role === role))
    .map(([role, c]) => `<span><b style="background:${c}"></b>${esc(role)}</span>`)
    .join('');

  let html = inspSection(
    t('inspect.context.size'),
    kvRows([
      ['messages', '', d.count ?? msgs.length],
      ['chars', '', fmtChars(d.chars)],
      ['~tokens', '', estTokens(d.chars)],
    ]) + `<div class="insp-bar">${bar}</div><div class="insp-legend">${legend}</div>`,
  );

  const rows = msgs
    .map(
      (m, i) =>
        `<div class="insp-row"><span class="mono">#${i}</span><span>${esc(m.role)}${esc(
          m.types && m.types.length ? ` [${m.types.join(',')}]` : '',
        )}</span><span title="${esc(m.preview || '')}">${esc(m.preview || '')}</span><span class="r">${fmtChars(
          m.chars,
        )}</span></div>`,
    )
    .join('');
  html += inspSection(
    t('inspect.context.messages'),
    `<div class="insp-row head"><span>#</span><span>${esc(t('inspect.col.role'))}</span><span>${esc(
      t('inspect.col.preview'),
    )}</span><span class="r">${esc(t('inspect.col.chars'))}</span></div>${rows}`,
  );
  root.innerHTML = html;
}

/* ---- provider requests -------------------------------------------------- */

function renderInspRequests(root) {
  const reqs = inspAll('request');
  if (!reqs.length) {
    root.innerHTML = `<div class="insp-empty">${esc(t('inspect.noRequests'))}</div>`;
    return;
  }
  const responses = inspAll('response');
  let html = '';
  reqs
    .map((r, i) => ({ r, i }))
    .reverse()
    .forEach(({ r, i }) => {
      const d = r.data || {};
      const res = responses.find((x) => x.at >= r.at && x.at - r.at < 1000 * 60 * 30);
      const rate = res && res.data && res.data.headers
        ? Object.entries(res.data.headers)
            .filter(([k]) => /rate|limit|retry-after/i.test(k))
            .map(([k, v]) => `${k}=${v}`)
            .join('  ')
        : '';
      html += `<div class="insp-sec"><h4>#${i + 1} · ${esc(new Date(r.at).toLocaleTimeString())}</h4>${kvRows([
        ['model', d.params && d.params.model],
        ['status', res ? String(res.data.status) : '—'],
        ['messages', (d.messageRoles || []).join(', '), d.messageCount],
        ['tools', (d.toolNames || []).join(', '), d.toolCount],
        ['bytes', '', fmtChars(d.bytes)],
        ['params', shortJson(d.params, 200)],
        ...(rate ? [['rateLimit', rate]] : []),
      ])}${lazyDetails(t('inspect.showPayload'), d.raw || '')}</div>`;
    });
  root.innerHTML = html;
}

/* ---- session file ------------------------------------------------------- */

function renderInspSession(root) {
  const entries = state.entries || [];
  if (!entries.length) {
    root.innerHTML = `<div class="insp-empty">${esc(t('inspect.noEntries'))}</div>`;
    return;
  }
  const byType = {};
  for (const e of entries) byType[e.type] = (byType[e.type] || 0) + 1;

  let html = inspSection(
    t('inspect.session.stats'),
    kvRows([
      ['entries', '', entries.length],
      ['leafId', state.leafId || '—'],
      ...Object.entries(byType).map(([k, v]) => [k, '', v]),
    ]),
  );

  const rows = entries
    .slice(-80)
    .map((e) => {
      const m = e.message || {};
      const desc =
        e.type === 'message'
          ? `${m.role || '?'}${Array.isArray(m.content) ? ` [${m.content.map((c) => c.type).join(',')}]` : ''}`
          : e.type === 'compaction'
            ? `compaction · ${e.tokensBefore ?? '?'} tokens before`
            : e.type === 'session_info'
              ? `name: ${e.name || ''}`
              : e.type;
      const isCompact = e.type === 'compaction';
      return `<div class="insp-row"><span class="mono">${esc(e.id || '')}</span><span>${esc(e.type)}${
        isCompact ? `<span class="insp-flag">${esc(t('inspect.compact'))}</span>` : ''
      }</span><span>${esc(desc)}</span><span class="r">${esc(String(e.parentId || '—').slice(0, 8))}</span></div>`;
    })
    .join('');
  html += inspSection(
    t('inspect.session.entries'),
    `<div class="insp-row head"><span>id</span><span>${esc(t('inspect.col.type'))}</span><span>${esc(
      t('inspect.col.detail'),
    )}</span><span class="r">parent</span></div>${rows}`,
  );
  root.innerHTML = html;
}

/* ---- agents ------------------------------------------------------------- */

function renderInspAgents(root) {
  const counts = new Map();
  for (const r of state.inspect) {
    const k = r.agent || 'main';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const list = state.agents.length ? state.agents : [{ key: 'main', child: false, task: null, lastAt: Date.now() }];
  if (list.length <= 1) {
    root.innerHTML = inspSection(t('inspect.agents.list'), `<div class="insp-empty">${esc(t('inspect.agents.none'))}</div>`);
    return;
  }

  const rows = list
    .map((a) => {
      const isMain = !a.child;
      const active = a.key === state.inspectAgent;
      const running = !isMain && Date.now() - (a.lastAt || 0) < 20000;
      const status = isMain ? t('inspect.agents.main') : running ? t('inspect.agents.running') : t('inspect.agents.idle');
      return `<div class="insp-row agent-row${active ? ' active' : ''}" data-agent="${esc(a.key)}" title="${esc(a.task || '')}">
        <span class="mono">${esc(isMain ? '★' : '└')}</span>
        <span>${esc(a.model || status)}</span>
        <span>${esc(a.task || status)}</span>
        <span class="r">${counts.get(a.key) || 0}</span>
      </div>`;
    })
    .join('');

  root.innerHTML =
    inspSection(
      t('inspect.agents.list'),
      `<div class="insp-row head"><span></span><span>model</span><span>${esc(t('inspect.col.detail'))}</span><span class="r">records</span></div>${rows}`,
    ) +
    inspSection(t('inspect.tab.agents'), `<div class="insp-empty">${esc(t('inspect.agents.hint'))}</div>`);

  for (const el of root.querySelectorAll('.agent-row')) {
    el.addEventListener('click', () => {
      state.inspectAgent = el.dataset.agent;
      syncAgentSelect();
      renderInspect();
    });
  }
}

/* ---- capabilities ------------------------------------------------------- */

function renderInspCaps(root) {
  const sp = inspLatest('system_prompt');
  const d = (sp && sp.data) || {};
  const commands = state.commands || [];
  const models = state.models || [];

  const inv = inspLatest('inventory');
  const invData = (inv && inv.data) || null;

  let html = '';
  if (invData) {
    html += inspSection(
      t('inspect.caps.tools'),
      (invData.tools || []).length
        ? (invData.tools || [])
            .map((tool) => {
              const src = tool.source || {};
              const where =
                src.extensionPath || src.path || src.package || src.source || src.type || (typeof src === 'string' ? src : '');
              return `<div class="insp-row"><span class="mono">${esc(tool.name || '')}</span><span>${esc(
                shortJson(where, 60),
              )}</span><span>${esc(tool.description || '')}</span><span class="r"></span></div>`;
            })
            .join('')
        : `<div class="insp-empty">—</div>`,
    );
  }
  html += inspSection(
    t('inspect.caps.commands'),
    commands.length
      ? `<div class="insp-row head"><span>${esc(t('inspect.col.name'))}</span><span>source</span><span>${esc(
          t('inspect.col.detail'),
        )}</span><span class="r"></span></div>` +
          commands
            .map(
              (c) =>
                `<div class="insp-row"><span class="mono">/${esc(c.name)}</span><span>${esc(
                  c.source || '',
                )}</span><span>${esc(c.description || '')}</span><span class="r"></span></div>`,
            )
            .join('')
      : `<div class="insp-empty">—</div>`,
  );

  html += inspSection(
    t('inspect.caps.models'),
    models.length
      ? models
          .map(
            (m) =>
              `<div class="insp-row"><span class="mono">${esc(m.provider)}</span><span>${esc(m.id)}</span><span>${esc(
                m.name || '',
              )}${m.reasoning ? `<span class="insp-flag">reasoning</span>` : ''}</span><span class="r">${fmtChars(
                m.contextWindow,
              )}</span></div>`,
          )
          .join('')
      : `<div class="insp-empty">—</div>`,
  );

  html += inspSection(
    t('inspect.caps.skills'),
    (d.skills || []).length
      ? (d.skills || [])
          .map(
            (s) =>
              `<div class="insp-row"><span class="mono">${esc(s.name)}</span><span></span><span>${esc(
                s.description || '',
              )}</span><span class="r"></span></div>`,
          )
          .join('')
      : `<div class="insp-empty">—</div>`,
  );

  html += inspSection(
    t('inspect.caps.contextFiles'),
    (d.contextFiles || []).length
      ? (d.contextFiles || [])
          .map(
            (f) =>
              `<div class="insp-row"><span class="mono">${esc(f.path.split('/').pop())}</span><span></span><span title="${esc(
                f.path,
              )}">${esc(f.path)}</span><span class="r">${fmtChars(f.chars)}</span></div>`,
          )
          .join('')
      : `<div class="insp-empty">—</div>`,
  );

  html += inspSection(
    t('inspect.caps.compaction'),
    inspAll('compact').length
      ? inspAll('compact')
          .map((c) => {
            const k = c.data || {};
            return `<div class="insp-row"><span class="mono">${esc(k.reason || '')}</span><span>${esc(
              new Date(c.at).toLocaleTimeString(),
            )}</span><span>${esc(t('inspect.caps.compactDetail', { before: k.tokensBefore ?? '?', kept: k.retainedTail ?? '?' }))}</span><span class="r">${esc(
              k.summaryChars ? fmtChars(k.summaryChars) : '',
            )}</span></div>`;
          })
          .join('')
      : `<div class="insp-empty">—</div>`,
  );

  root.innerHTML = html;
}


/* ================================================================ changes */

const chgEl = $('#dock-pane-changes');
const chgListEl = $('#changes-list');
const chgDiffEl = $('#changes-diff');
const chgTotalsEl = $('#changes-totals');
const chgCountEl = $('#changes-count');
const chgGitEl = $('#changes-git');
const chgPathEl = $('#changes-diff-path');
const chgStatEl = $('#changes-diff-stat');
const chgRevertBtn = $('#btn-changes-revert');
const chgBadgeEl = $('#changes-badge');

let chgState = { git: false, files: [], selected: null, diff: null, diffFor: null, armed: 0 };
let chgTimer = null;

function changesQuery() {
  const q = ($('#changes-search')?.value || '').trim().toLowerCase();
  const onlySession = $('#changes-session-only')?.checked !== false;
  return chgState.files.filter(
    (f) => (!onlySession || f.tool) && (!q || f.path.toLowerCase().includes(q)),
  );
}

function changesTotals(list) {
  let add = 0;
  let del = 0;
  for (const f of list) {
    if (typeof f.add === 'number') add += f.add;
    if (typeof f.del === 'number') del += f.del;
  }
  return { add, del };
}

function renderChanges() {
  if (!chgEl || chgEl.classList.contains('hidden')) return;
  const list = changesQuery();
  const { add, del } = changesTotals(list);

  if (chgGitEl) {
    chgGitEl.textContent = chgState.git ? t('changes.git') : t('changes.noGit');
    chgGitEl.title = chgState.git ? t('changes.gitTitle') : t('changes.noGitTitle');
  }
  if (chgCountEl) chgCountEl.textContent = t('changes.count', { n: list.length });

  if (chgTotalsEl) {
    if (!list.length) {
      chgTotalsEl.textContent = chgState.files.length ? t('changes.filtered') : t('changes.clean');
    } else {
      chgTotalsEl.innerHTML =
        `${esc(chgState.cwd || '')} · ` +
        `<span class="add">+${add}</span> <span class="del">−${del}</span> · ` +
        t('changes.filesTouched', { n: list.length });
    }
  }

  chgListEl.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'insp-empty';
    empty.textContent = chgState.files.length ? t('changes.filtered') : t('changes.cleanHint');
    chgListEl.appendChild(empty);
    return;
  }

  for (const f of list) {
    const row = document.createElement('div');
    row.className = 'change-row' + (f.path === chgState.selected ? ' active' : '');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    const name = document.createElement('span');
    name.className = 'change-path';
    name.textContent = f.path;
    name.title = f.path;
    const stat = document.createElement('span');
    stat.className = 'change-stat';
    stat.innerHTML =
      (typeof f.add === 'number' ? `<span class="add">+${f.add}</span>` : '') +
      (typeof f.del === 'number' ? ` <span class="del">−${f.del}</span>` : '');
    const meta = document.createElement('span');
    meta.className = 'change-meta';
    meta.textContent = f.tool ? t('changes.byTool', { tool: f.tool, n: f.count }) : f.code || '';
    meta.title = f.tool ? '' : t('changes.gitOnly');
    row.append(name, stat, meta);
    const open = () => selectChange(f.path);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
    chgListEl.appendChild(row);
  }
}

function renderChangeDiff() {
  const d = chgState.diff;
  if (chgPathEl) chgPathEl.textContent = chgState.selected || '';
  if (!d) {
    chgDiffEl.textContent = t('changes.pickFile');
    if (chgStatEl) chgStatEl.textContent = '';
    return;
  }
  if (d.error) {
    chgDiffEl.textContent = d.error;
    if (chgStatEl) chgStatEl.textContent = '';
    return;
  }
  if (chgStatEl) {
    chgStatEl.innerHTML = `<span class="add">+${d.add || 0}</span> <span class="del">−${d.del || 0}</span>`;
  }
  const lines = d.lines || [];
  const MAX = 3000;
  const shown = lines.slice(0, MAX);
  chgDiffEl.className = 'out change-diff';
  chgDiffEl.innerHTML =
    shown
      .map((l) => {
        const cls = l.t === '+' ? 'diff-add' : l.t === '-' ? 'diff-del' : '';
        const ln = l.t === '+' ? l.b || '' : l.a || '';
        return `<div class="diff-line ${cls}"><span class="diff-ln">${ln}</span><span class="diff-text">${esc(l.text) || '&nbsp;'}</span></div>`;
      })
      .join('') +
    (lines.length > MAX ? `<div class="diff-line diff-hunk">… ${lines.length - MAX} ${t('changes.moreLines')}</div>` : '');
}

async function selectChange(path) {
  chgState.selected = path;
  chgState.diffFor = null;
  renderChanges();
  if (chgRevertBtn) {
    const f = chgState.files.find((x) => x.path === path);
    chgRevertBtn.disabled = !f || !f.revertable;
    chgRevertBtn.textContent = t('changes.revert');
  }
  try {
    const res = await fetch(api('/api/changes/diff') + `&path=${encodeURIComponent(path)}`);
    const d = await res.json();
    if (chgState.selected !== path) return;
    chgState.diff = d;
    chgState.diffFor = path;
    renderChangeDiff();
  } catch (err) {
    chgState.diff = { error: String(err.message || err) };
    renderChangeDiff();
  }
}

async function loadChanges(keepSelection) {
  try {
    const res = await fetch(api('/api/changes'));
    const d = await res.json();
    chgState.git = !!d.git;
    chgState.files = Array.isArray(d.files) ? d.files : [];
    if (!keepSelection || !chgState.files.some((f) => f.path === chgState.selected)) chgState.selected = null;
    renderChanges();
    if (chgState.selected) await selectChange(chgState.selected);
    else renderChangeDiff();
    updateChangesBadge();
  } catch (err) {
    if (chgTotalsEl) chgTotalsEl.textContent = String(err.message || err);
  }
}

/** The toolbar badge is a cheap "did anything change?" signal. */
function updateChangesBadge() {
  if (!chgBadgeEl) return;
  const n = chgState.files.filter((f) => f.tool).length;
  chgBadgeEl.textContent = n ? String(n) : '';
  chgBadgeEl.classList.toggle('hidden', !n);
  chgBadgeEl.title = n ? t('changes.badgeTitle', { n }) : '';
}

async function refreshChangesBadge() {
  try {
    const res = await fetch(api('/api/changes'));
    const d = await res.json();
    chgState.files = Array.isArray(d.files) ? d.files : [];
    chgState.git = !!d.git;
    if (!chgEl.classList.contains('hidden')) renderChanges();
    updateChangesBadge();
  } catch {}
}

function openChanges() {
  dockOpen('changes');
}

function closeChanges() {
  if (dockTab === 'changes') dockClose();
}

function openContext() {
  dockOpen('context');
}

async function revertSelected() {
  if (!chgState.selected) return;
  const path = chgState.selected;
  const btn = chgRevertBtn;
  const now = Date.now();
  if (chgState.armed && now - chgState.armed < 5000) {
    chgState.armed = 0;
    btn.disabled = true;
    btn.textContent = t('changes.reverting');
    try {
      const res = await fetch(api('/api/changes/revert'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const d = await res.json();
      if (d.ok) {
        toast(t('toast.reverted', { path, backup: d.backup ? t('changes.backupKept') : '' }));
        chgState.selected = null;
        chgState.diff = null;
        await loadChanges(false);
      } else {
        toast(t('toast.revertFailed', { msg: d.error || '?' }), 'error');
      }
    } catch (err) {
      toast(t('toast.revertFailed', { msg: String(err.message || err) }), 'error');
    } finally {
      btn.textContent = t('changes.revert');
      btn.disabled = false;
    }
    return;
  }
  chgState.armed = now;
  btn.textContent = t('changes.revertConfirm');
  clearTimeout(chgTimer);
  chgTimer = setTimeout(() => {
    chgState.armed = 0;
    if (chgRevertBtn) chgRevertBtn.textContent = t('changes.revert');
  }, 5000);
}

/* ------------------------------------------------ self-contained export */

/** Styles inlined into the exported file, so it renders anywhere, offline. */
const EXPORT_CSS = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 32px; font: 14px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif; max-width: 900px; background: #fff; color: #24292f; }
h1 { font-size: 22px; margin: 0 0 4px; }
.meta { color: #6b7280; font-size: 12px; margin-bottom: 24px; }
.msg { margin: 0 0 20px; padding: 12px 14px; border: 1px solid #e3e6ea; border-radius: 10px; }
.msg.user { background: rgba(79,107,237,.05); }
.role { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; margin-bottom: 8px; }
pre { background: #f6f8fa; border: 1px solid #e3e6ea; border-radius: 8px; padding: 10px; overflow: auto; font-size: 12.5px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
code { background: rgba(0,0,0,.05); padding: 1px 4px; border-radius: 4px; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #e3e6ea; padding: 4px 8px; text-align: left; }
blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #e3e6ea; color: #6b7280; }
details { margin: 8px 0; }
summary { cursor: pointer; color: #4f6bed; }
.tool { border-left: 3px solid #e3e6ea; padding-left: 10px; margin: 10px 0; }
.tool h4 { margin: 0 0 6px; font-size: 13px; }
.err { color: #c0392b; }
.add { color: #1a7f37; } .del { color: #c0392b; }
.tok-k { color: #8250df; } .tok-s { color: #1a7f37; } .tok-c { color: #9aa1ab; font-style: italic; }
.tok-n { color: #b76b00; } .tok-f { color: #0969da; } .tok-t { color: #0d7a72; } .tok-a { color: #b76b00; }
.tok-v { color: #0d7a72; } .tok-p { color: #6b7280; } .tok-d { color: #c0392b; }
.trace { font-family: ui-monospace, monospace; font-size: 11.5px; }
.trace div { padding: 1px 0; border-bottom: 1px solid #f0f2f4; }
@media (prefers-color-scheme: dark) {
  body { background: #16181d; color: #e6e8eb; }
  .msg, pre, table, th, td { border-color: #2c313a; }
  .msg.user { background: rgba(79,107,237,.12); }
  pre { background: #1c1f26; }
  code { background: rgba(255,255,255,.08); }
  blockquote { border-color: #2c313a; }
}
`;

function exportMessagesHtml(messages) {
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'user') {
      out.push(`<div class="msg user"><div class="role">${esc(t('role.user'))}</div>${renderExportBlocks(m.content)}</div>`);
    } else if (m.role === 'assistant') {
      out.push(`<div class="msg assistant"><div class="role">${esc(t('role.assistant'))}</div>${renderExportBlocks(m.content)}</div>`);
    } else if (m.role === 'toolResult') {
      out.push(
        `<div class="tool"><h4>${esc(m.toolName || 'tool')}${m.isError ? ` <span class="err">(error)</span>` : ''}</h4>` +
          `<pre>${esc(extractText(m)).slice(0, 20000)}</pre></div>`,
      );
    } else if (m.role === 'bashExecution') {
      out.push(`<div class="tool"><h4>bash</h4><pre>${esc(m.output || '')}</pre></div>`);
    } else if (m.role === 'custom' && m.display !== false) {
      out.push(`<div class="msg"><div class="role">${esc(m.customType || 'custom')}</div><pre>${esc(extractText(m.content))}</pre></div>`);
    }
  }
  return out.join('\n');
}

function renderExportBlocks(content) {
  if (typeof content === 'string') return md(content);
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (!c || typeof c !== 'object') return esc(String(c ?? ''));
      if (c.type === 'text') return md(c.text || '');
      if (c.type === 'thinking') return `<details><summary>thinking</summary><pre>${esc(c.thinking || c.text || '')}</pre></details>`;
      if (c.type === 'toolCall')
        return `<div class="tool"><h4>${esc(c.name || 'tool')}</h4><pre>${esc(JSON.stringify(c.arguments ?? {}, null, 2))}</pre></div>`;
      if (c.type === 'image') return '<p><em>[image]</em></p>';
      return '';
    })
    .join('\n');
}

function exportTraceHtml(records) {
  if (!Array.isArray(records) || !records.length) return '';
  const rows = records
    .slice(0, 4000)
    .map((r) => {
      const evt = r.evt || r;
      const t = evt.type || '?';
      const extra = evt.text || evt.message || evt.toolName || evt.command || '';
      return `<div>${String(r.seq ?? '').padStart(5, ' ')}  ${esc(t)}  ${esc(String(extra).slice(0, 160))}</div>`;
    })
    .join('');
  return `<details><summary>trace (${records.length} events)</summary><div class="trace">${rows}</div></details>`;
}

/** Build (but do not download) the standalone HTML bundle. */
async function buildExportBundle() {
  const messages = state.allMessages || [];
  if (!messages.length) {
    toast(t('toast.nothingToExport'), 'warning');
    return null;
  }
  let records = [];
  try {
    const res = await fetch(api('/api/trace'));
    const d = await res.json();
    records = d.records || [];
  } catch {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const title = state.sessionName || state.sessionId || 'pi-gui session';
  const payload = JSON.stringify({ session: state.sessionId, cwd: state.cwd, messages, trace: records }).replace(/<\//g, '<\\/');
  const html = `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — pi GUI</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="meta">
  ${esc(state.cwd || '')} · ${esc(stamp)} · ${messages.length} ${esc(t('stats.messages'))}
  ${state.currentModel ? ' · ' + esc(state.currentModel.name || state.currentModel.id || '') : ''}
</div>
${exportMessagesHtml(messages)}
${exportTraceHtml(records)}
<script type="application/json" id="pi-gui-export">${payload}</script>
</body>
</html>`;
  return html;
}

/** One offline HTML file: the conversation, the tools and the raw trace. */
async function exportHtmlBundle() {
  const html = await buildExportBundle();
  if (!html) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadText(`pi-gui-${stamp}.html`, html, 'text/html');
  toast(t('toast.exportedHtml'));
}

/* ------------------------------------------------------------ palette extras */

function paletteExtraActions(add) {
  add(t('palette.layout'), layoutMode === 'compact' ? t('settings.layoutCompact') : t('settings.layoutComfortable'), () =>
    applyLayout(layoutMode === 'compact' ? 'comfortable' : 'compact'),
  );
  add(t('palette.inspect'), '', () => openInspect());
  add(t('palette.changes'), chgState.files.length ? String(chgState.files.length) : '', () => dockToggle('changes'));
  add(t('palette.context'), '', () => dockToggle('context'));
  add(t('palette.exportHtml'), '.html', () => exportHtmlBundle());
  add(t('palette.tools', { state: t('palette.collapsed') }), '', () => toggleAllTools(false));
  add(t('palette.tools', { state: t('palette.expanded') }), '', () => toggleAllTools(true));
  add(t('palette.lastError'), '', () => jumpToLastError());
  add(t('palette.retry'), '', () => retryLastUser());
  for (const l of ['off', 'minimal', 'low', 'medium', 'high']) {
    add(t('palette.thinking', { level: l }), '', () => {
      send({ type: 'set_thinking_level', level: l });
      rememberThinking(l);
    });
  }
}

function toggleAllTools(open) {
  const nodes = chat.querySelectorAll('details.tool');
  nodes.forEach((d) => {
    d.open = open;
    d.dataset.touched = '1';
  });
  if (!nodes.length) return;
  toast(open ? t('toast.toolsExpanded', { n: nodes.length }) : t('toast.toolsCollapsed', { n: nodes.length }));
}

function jumpToLastError() {
  const msgs = [...chat.querySelectorAll('.msg')];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].querySelector('.tool-badge.error, .notice.error')) {
      msgs[i].scrollIntoView({ block: 'center' });
      msgs[i].classList.add('flash');
      setTimeout(() => msgs[i].classList.remove('flash'), 1200);
      return;
    }
  }
  toast(t('palette.noError'), 'warning');
}

function retryLastUser() {
  const all = state.allMessages || [];
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const m = all[i];
    if (m && m.role === 'user') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : (Array.isArray(m.content) ? m.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n') : '');
      if (!text) break;
      input.value = text;
      autosize();
      submit();
      return;
    }
  }
  toast(t('palette.noRetry'), 'warning');
}

/* ================================================================= sidebar */

/**
 * A permanent session sidebar: every session in every workspace, one click to
 * switch. The old modal session panel could do the switching, but you had to
 * know it was there — and it only ever listed the server's own cwd, so sessions
 * from other projects were invisible.
 */
const sbEl = $('#sidebar');
const sbListEl = $('#sb-list');
const sbSearchEl = $('#sb-search');
const sbCollToggle = $('#btn-sidebar');
const SB_KEY = 'pi-gui-sidebar';

const sbState = {
  sessions: [],
  workspaces: [],
  collapsedGroups: new Set(),
  filter: '',
  hits: [],
  loading: false,
};

function sbPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(SB_KEY) || '{}');
    return {
      collapsed: !!raw.collapsed,
      groups: Array.isArray(raw.groups) ? raw.groups : [],
      groupBy: raw.groupBy === 'time' ? 'time' : 'workspace',
    };
  } catch {
    return { collapsed: false, groups: [], groupBy: 'workspace' };
  }
}

function sbSavePrefs(collapsed) {
  try {
    localStorage.setItem(
      SB_KEY,
      JSON.stringify({
        collapsed: collapsed ?? sbEl.classList.contains('collapsed'),
        groups: [...sbState.collapsedGroups],
        groupBy: sbState.groupBy,
      }),
    );
  } catch {}
}

/** Ordering key for the time buckets: today → yesterday → this week → older. */
function sbBucket(ms) {
  const d = new Date(ms || 0);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (ms >= startOfToday) return 0;
  if (ms >= startOfToday - day) return 1;
  if (ms >= startOfToday - 6 * day) return 2;
  if (ms >= startOfToday - 29 * day) return 3;
  return 4;
}

/** Explicit calls, not a key array — the i18n checker only sees literal keys. */
function sbBucketLabel(bucket) {
  if (bucket === 0) return t('sidebar.bucket.today');
  if (bucket === 1) return t('sidebar.bucket.yesterday');
  if (bucket === 2) return t('sidebar.bucket.week');
  if (bucket === 3) return t('sidebar.bucket.month');
  return t('sidebar.bucket.earlier');
}

/** Last two path segments, so a row can say where it came from in ~14 chars. */
function shortWorkspace(label) {
  const parts = String(label || '').split('/').filter(Boolean);
  if (!parts.length) return label || '';
  const tail = parts.slice(-2).join('/');
  return String(label).startsWith('~') ? '~/' + tail : tail;
}

/** "刚刚 / 12分钟 / 3小时 / 2天 / 1个月" — relative beats an absolute timestamp. */
function relTime(ms) {
  const d = Date.now() - (ms || 0);
  if (d < 60_000) return t('time.now');
  const m = Math.floor(d / 60_000);
  if (m < 60) return t('time.min', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('time.hour', { n: h });
  const days = Math.floor(h / 24);
  if (days < 30) return t('time.day', { n: days });
  const mo = Math.floor(days / 30);
  if (mo < 12) return t('time.month', { n: mo });
  return t('time.year', { n: Math.floor(mo / 12) });
}

function sbSetCollapsed(collapsed, persist = true) {
  sbEl.classList.toggle('collapsed', collapsed);
  document.getElementById('app').classList.toggle('sidebar-collapsed', collapsed);
  if (sbCollToggle) sbCollToggle.setAttribute('aria-expanded', String(!collapsed));
  if (persist) sbSavePrefs(collapsed);
}

/** Stable group order: the group you are working in stays first, the rest are
 *  alphabetical. Sorting every group by "most recently touched" made the whole
 *  list reshuffle under the cursor after every turn. */
function sbGroups() {
  const map = new Map();
  const byTime = sbState.groupBy === 'time';
  for (const s of sbState.sessions) {
    let key;
    if (byTime) {
      key = sbBucketLabel(sbBucket(s.mtime));
    } else {
      key = s.workspaceLabel || s.workspace || t('sidebar.unknownWorkspace');
    }
    if (!map.has(key)) map.set(key, { label: key, cwd: s.workspace, isCurrent: false, order: byTime ? sbBucket(s.mtime) : 0, sessions: [] });
    const g = map.get(key);
    g.sessions.push(s);
    if (!byTime && s.isCurrentWorkspace) g.isCurrent = true;
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.sessions.sort((a, b) => {
      const aActive = a.id && a.id === state.sessionId ? 1 : 0;
      const bActive = b.id && b.id === state.sessionId ? 1 : 0;
      return bActive - aActive || b.mtime - a.mtime;
    });
  }
  if (byTime) {
    // chronological by construction — no "active first" shuffling here
    groups.sort((a, b) => a.order - b.order);
    return groups;
  }
  const activeGroup = groups.find((g) => g.sessions.some((s) => s.id && s.id === state.sessionId));
  groups.sort((a, b) => {
    if (a === activeGroup) return -1;
    if (b === activeGroup) return 1;
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

function sbRowMeta(s) {
  const bits = [];
  // when grouped by time the workspace is no longer implied by the group header
  if (sbState.groupBy === 'time' && s.workspaceLabel) bits.push(shortWorkspace(s.workspaceLabel));
  if (s.turns) bits.push(tp('sidebar.turnOne', 'sidebar.turns', s.turns));
  if (s.cost) bits.push(fmtCost(s.cost));
  bits.push(relTime(s.mtime));
  return bits.join(' · ');
}

/** Rows are reconciled by session path, never rebuilt in bulk: wiping the list
 *  reordered the DOM under the pointer, which could switch to the wrong session. */
const sbNodes = new Map();
let sbSignature = '';

function sbRowNode() {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'sb-row';
  const dot = document.createElement('span');
  dot.className = 'sb-dot';
  const main = document.createElement('span');
  main.className = 'sb-main';
  const title = document.createElement('span');
  title.className = 'sb-title';
  const meta = document.createElement('span');
  meta.className = 'sb-meta';
  main.append(title, meta);
  row.append(dot, main);
  // resolve the session at click time: rows are reused across re-renders, so a
  // captured object could be stale after the list was refreshed
  row.addEventListener('click', () => {
    if (!row.dataset.path) return;
    const fresh = sbState.sessions.find((x) => x.path === row.dataset.path);
    sbSwitch(fresh || { path: row.dataset.path, id: row.dataset.id });
  });
  return {
    node: row,
    update(s) {
      const active = !!s.id && s.id === state.sessionId;
      row.dataset.path = s.path;
      row.dataset.id = s.id || '';
      row.classList.toggle('active', active);
      dot.classList.toggle('on', active);
      title.textContent = s.title || s.name || s.preview || t('sidebar.untitled');
      meta.textContent = sbRowMeta(s);
      row.title = [
        s.title || s.preview || '',
        s.workspace || '',
        new Date(s.mtime).toLocaleString(),
        s.turns ? t('sidebar.tipStats', { turns: s.turns, tools: s.toolCalls || 0, tokens: fmtTokens(s.tokens || 0), cost: fmtCost(s.cost || 0) }) : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  };
}

function sbGroupNode(onToggle) {
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'sb-group';
  const caret = document.createElement('span');
  caret.className = 'sb-caret';
  const label = document.createElement('span');
  label.className = 'sb-group-label';
  const count = document.createElement('span');
  count.className = 'sb-count';
  head.append(caret, label, count);
  head.addEventListener('click', () => onToggle(head.dataset.label));
  return {
    node: head,
    update(g, collapsed) {
      head.dataset.label = g.label;
      head.classList.toggle('collapsed', collapsed);
      head.classList.toggle('current', !!g.isCurrent);
      head.setAttribute('aria-expanded', String(!collapsed));
      caret.textContent = collapsed ? '▸' : '▾';
      label.textContent = g.label;
      label.title = g.cwd || g.label;
      count.textContent = String(g.sessions.length);
    },
  };
}

function sbRender() {
  const q = sbState.filter.trim().toLowerCase();
  const groups = sbGroups();
  const items = [];

  for (const g of groups) {
    const sessions = q
      ? g.sessions.filter((s) => `${s.title || ''} ${s.name || ''} ${s.preview || ''} ${s.file}`.toLowerCase().includes(q))
      : g.sessions;
    if (!sessions.length) continue;
    const collapsed = sbState.collapsedGroups.has(g.label) && !q;
    items.push({ kind: 'group', key: `g:${g.label}`, group: g, collapsed });
    if (collapsed) continue;
    const limit = q ? 60 : 40;
    for (const s of sessions.slice(0, limit)) items.push({ kind: 'row', key: `s:${s.path}`, session: s });
    if (sessions.length > limit) {
      items.push({ kind: 'more', key: `m:${g.label}`, text: t('sidebar.more', { n: sessions.length - limit }) });
    }
  }

  if (sbState.hits.length) {
    items.push({ kind: 'label', key: 'hits', text: t('sidebar.contentHits', { n: sbState.hits.length }) });
    for (const h of sbState.hits) items.push({ kind: 'hit', key: `h:${h.path}`, hit: h });
  }
  if (!items.length) {
    items.push({ kind: 'empty', key: 'empty', text: sbState.loading ? t('sidebar.loading') : q ? t('sidebar.noMatch') : t('sidebar.empty') });
  }

  const seen = new Set();
  const ordered = [];
  for (const item of items) {
    seen.add(item.key);
    let entry = sbNodes.get(item.key);
    if (!entry) {
      if (item.kind === 'row') entry = sbRowNode();
      else if (item.kind === 'group') entry = sbGroupNode(sbToggleGroup);
      else if (item.kind === 'hit') {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'sb-row hit';
        const title = document.createElement('span');
        title.className = 'sb-title';
        const snippet = document.createElement('span');
        snippet.className = 'sb-snippet';
        node.append(title, snippet);
        entry = { node, update: (h) => { title.textContent = h.label; snippet.textContent = h.snippet; node.title = h.snippet; node.dataset.path = h.path; } };
        node.addEventListener('click', () => {
          const fresh = sbState.sessions.find((x) => x.path === node.dataset.path);
          sbSwitch(fresh || { path: node.dataset.path, id: node.dataset.id });
        });
      } else {
        const node = document.createElement('div');
        node.className = 'sb-' + item.kind;
        entry = { node, update: (text) => { node.textContent = text; } };
      }
      sbNodes.set(item.key, entry);
    }
    if (item.kind === 'row') entry.update(item.session);
    else if (item.kind === 'group') entry.update(item.group, item.collapsed);
    else if (item.kind === 'hit') entry.update(item.hit);
    else entry.update(item.text);
    ordered.push(entry.node);
  }

  for (const [key, entry] of sbNodes) {
    if (!seen.has(key)) {
      entry.node.remove();
      sbNodes.delete(key);
    }
  }
  // appendChild on an already-parented node moves it — same nodes, new order
  let cursor = sbListEl.firstChild;
  for (const node of ordered) {
    if (node === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    sbListEl.insertBefore(node, cursor);
  }
}

let sbSearchTimer = null;

function sbSearch(term) {
  sbState.filter = term;
  clearTimeout(sbSearchTimer);
  if (term.trim().length < 2) {
    sbState.hits = [];
    sbRender();
    return;
  }
  sbRender();
  sbSearchTimer = setTimeout(async () => {
    try {
      const d = await fetch(api('/api/search') + `&q=${encodeURIComponent(term.trim())}&limit=8`).then((r) => r.json());
      if (sbState.filter.trim() !== term.trim()) return;
      sbState.hits = (d.results || []).map((r) => ({
        label: r.name || r.file.slice(0, 40),
        snippet: (r.hits[0] ? r.hits[0].snippet : '').slice(0, 90),
        path: r.path,
        id: r.id,
        mtime: r.mtime,
      }));
    } catch {
      sbState.hits = [];
    }
    sbRender();
  }, 220);
}

function sbSetGroupBy(mode) {
  if (sbState.groupBy === mode) return;
  sbState.groupBy = mode;
  sbState.collapsedGroups.clear();
  sbSavePrefs();
  for (const btn of document.querySelectorAll('#sb-groupby button')) {
    btn.classList.toggle('on', btn.dataset.by === mode);
    btn.setAttribute('aria-pressed', String(btn.dataset.by === mode));
  }
  sbRender();
}

function sbToggleGroup(label) {
  if (!label) return;
  if (sbState.collapsedGroups.has(label)) sbState.collapsedGroups.delete(label);
  else sbState.collapsedGroups.add(label);
  sbSavePrefs();
  sbRender();
}

async function sbLoad({ keepScroll = true, force = false } = {}) {
  const top = sbListEl.scrollTop;
  sbState.loading = true;
  try {
    const d = await fetch(api('/api/sessions?scope=all&limit=400')).then((r) => r.json());
    sbState.sessions = d.sessions || [];
    sbState.workspaces = d.workspaces || [];
    sbState.total = d.total || sbState.sessions.length;
    const foot = $('#sb-footer');
    if (foot) {
      foot.textContent = t('sidebar.footer', { n: sbState.total, w: sbState.workspaces.length });
      foot.title = (d.root || '') + (d.truncated ? '  (truncated)' : '');
    }
  } catch (err) {
    sbState.sessions = [];
    toast(t('toast.listFailed', { msg: err.message }), 'error');
  } finally {
    sbState.loading = false;
    // skip the repaint when nothing the list shows has actually changed
    const sig = sbState.sessions
      .map((s) => `${s.path}:${s.mtime}:${s.turns}:${s.title}`)
      .join('|') + `#${state.sessionId}#${sbState.filter}#${sbState.hits.length}#${sbState.groupBy}`;
    if (force || sig !== sbSignature) {
      sbSignature = sig;
      sbRender();
    }
    if (keepScroll) sbListEl.scrollTop = top;
  }
}

/** The only thing a finished turn changes is the active row's time — repaint
 *  that row instead of the list, and refresh the data at most every 20s. */
let sbLastFull = 0;
function sbTouchActive() {
  const row = sbListEl.querySelector('.sb-row.active');
  if (row) {
    const s = sbState.sessions.find((x) => x.path === row.dataset.path);
    if (s) {
      s.mtime = Date.now();
      row.querySelector('.sb-meta').textContent = sbRowMeta(s);
    }
  }
  if (Date.now() - sbLastFull > 20_000) {
    sbLastFull = Date.now();
    setTimeout(() => sbLoad(), 1500);
  }
}

/** Switch this tab's pi to another session and reload everything that follows. */
async function sbSwitch(s) {
  if (!s || !s.path) return;
  if (s.id && s.id === state.sessionId) {
    sbEl.querySelector('.sb-row.active')?.blur();
    return;
  }
  const same = sbState.sessions.find((x) => x.path === s.path);
  if (same && same.id && same.id === state.sessionId) return;
  send({ type: 'switch_session', sessionPath: s.path });
  if (same) {
    state.sessionId = same.id;
    sbRender();
  }
}

/** Optimistic highlight; the real state arrives with get_session_stats. */
function markSidebarActive(id) {
  for (const row of sbListEl.querySelectorAll('.sb-row')) {
    const on = !!id && row.dataset.id === id;
    row.classList.toggle('active', on);
    row.querySelector('.sb-dot')?.classList.toggle('on', on);
  }
}

function sbNewSession() {
  send({ type: 'new_session' });
  state.sessionId = null;
  markSidebarActive(null);
}

function sbStep(delta) {
  const rows = [...sbListEl.querySelectorAll('.sb-row')].filter((r) => r.dataset.path);
  if (!rows.length) return;
  let i = rows.findIndex((r) => r.classList.contains('active'));
  if (i === -1) i = delta > 0 ? -1 : rows.length;
  const next = rows[Math.min(rows.length - 1, Math.max(0, i + delta))];
  next?.click();
  next?.scrollIntoView({ block: 'nearest' });
}

/** The active session's identity can arrive after the list was painted. */
function sbSyncActive() {
  if (!sbEl || sbEl.classList.contains('collapsed')) return;
  markSidebarActive(state.sessionId);
}

/* ------------------------------------------------------------- markdown export */

function blocksToMd(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (!c || typeof c !== 'object') return '';
      if (c.type === 'text') return c.text || '';
      if (c.type === 'thinking') return `> _thinking_\n> ${String(c.thinking || '').replace(/\n/g, '\n> ')}`;
      if (c.type === 'toolCall') return `**tool: ${c.name}**\n\`\`\`json\n${JSON.stringify(c.arguments ?? {}, null, 2)}\n\`\`\``;
      if (c.type === 'image') return '_[image]_';
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function conversationMarkdown() {
  const out = ['# pi-gui conversation', '', `_${new Date().toISOString()}_`, ''];
  for (const m of state.allMessages || []) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'user') out.push('## User', '', blocksToMd(m.content), '');
    else if (m.role === 'assistant') {
      out.push('## Assistant', '', blocksToMd(m.content), '');
      if (m.usage) out.push(`_in ${m.usage.input ?? 0} / out ${m.usage.output ?? 0} tokens_`, '');
    } else if (m.role === 'toolResult') {
      out.push(`### tool result: ${m.toolName}${m.isError ? ' (error)' : ''}`, '', '```', extractText(m), '```', '');
    } else if (m.role === 'custom') {
      out.push(`> [${m.customType || 'custom'}] ${extractText(m.content)}`, '');
    }
  }
  return out.join('\n');
}

function downloadText(name, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportConversation() {
  const md = conversationMarkdown();
  if (md.length < 80) {
    toast(t('toast.nothingToExport'), 'warning');
    return;
  }
  downloadText(`pi-gui-${new Date().toISOString().replace(/[:.]/g, '-')}.md`, md, 'text/markdown');
  toast(t('toast.exportedMd'));
}

/* ------------------------------------------------------------------ replay */

let replayGroup = 0;
let replayStep = 0;

function replaySelection() {
  const groups = trace.groups.filter((g) => g.isPrompt);
  if (!groups.length) return { groups, records: [] };
  const g = groups[Math.min(replayGroup, groups.length - 1)];
  const records = trace.raw.filter((r) => r.t >= g.startT && r.t <= Math.max(g.endT, g.startT + 1));
  return { groups, g, records };
}

/** Fold the raw records of one exchange up to `upto` into the visible state. */
function replayFold(records, upto) {
  const st = { events: 0, text: '', thinking: '', tools: [], usage: null, stop: null, queue: 0 };
  for (let i = 0; i <= upto && i < records.length; i += 1) {
    const e = records[i] && records[i].evt;
    if (!e) continue;
    st.events += 1;
    if (e.type === 'agent_start') {
      st.text = '';
      st.thinking = '';
      st.tools = [];
    } else if (e.type === 'message_update') {
      const ae = e.assistantMessageEvent || {};
      if (ae.type === 'text_delta') st.text += ae.delta || '';
      else if (ae.type === 'thinking_delta') st.thinking += ae.delta || '';
      else if (ae.type === 'toolcall_end' && ae.toolCall)
        st.tools.push({ name: ae.toolCall.name, status: 'pending', args: ae.toolCall.arguments });
    } else if (e.type === 'tool_execution_start') {
      const t0 = st.tools.find((x) => x.status === 'pending' && x.name === e.toolName);
      if (t0) t0.status = 'running';
      else st.tools.push({ name: e.toolName, status: 'running' });
    } else if (e.type === 'tool_execution_end') {
      const t0 = [...st.tools].reverse().find((x) => x.status === 'running' && x.name === e.toolName);
      if (t0) t0.status = e.isError ? 'error' : 'done';
    } else if (e.type === 'message_end' && e.message && e.message.role === 'assistant') {
      st.usage = e.message.usage || st.usage;
      st.stop = e.message.stopReason || st.stop;
    } else if (e.type === 'queue_update') {
      st.queue = (e.steering || []).length + (e.followUp || []).length;
    }
  }
  return st;
}

function replayStateHtml(st) {
  return `<div class="replay-state">${kvRows([
    ['events', '', st.events],
    ['tools', st.tools.map((x) => `${x.name}(${x.status})`).join(', ') || '—'],
    ['usage', st.usage ? `in ${st.usage.input ?? 0} / out ${st.usage.output ?? 0}` : '—'],
    ['stop', st.stop || '—'],
    ['queued', '', st.queue],
  ])}${st.thinking ? `<pre class="insp-pre">${esc(st.thinking)}</pre>` : ''}${
    st.text ? `<pre class="insp-pre">${esc(st.text)}</pre>` : ''
  }</div>`;
}

function renderInspReplay(root) {
  const { groups, records } = replaySelection();
  if (!groups.length) {
    root.innerHTML = `<div class="insp-empty">${esc(t('inspect.noReplay'))}</div>`;
    return;
  }
  replayStep = Math.max(0, Math.min(replayStep, Math.max(0, records.length - 1)));
  const st = replayFold(records, replayStep);
  const evt = records[replayStep] ? records[replayStep].evt : null;

  root.innerHTML =
    inspSection(
      t('inspect.replay.pick'),
      `<div class="replay-controls">
        <select id="replay-group">${groups
          .map(
            (g, i) =>
              `<option value="${i}" ${i === Math.min(replayGroup, groups.length - 1) ? 'selected' : ''}>#${i + 1} ${esc(
                previewText(g.prompt, 44),
              )}</option>`,
          )
          .join('')}</select>
        <input type="range" id="replay-range" min="0" max="${Math.max(0, records.length - 1)}" value="${replayStep}">
        <span class="replay-step" id="replay-step">step ${replayStep + 1}/${records.length}</span>
      </div>`,
    ) +
    `<div id="replay-state-wrap">${inspSection(t('inspect.replay.state'), replayStateHtml(st))}</div>` +
    inspSection(t('inspect.replay.event'), `<pre class="insp-pre" id="replay-event">${esc(evt ? JSON.stringify(evt, null, 2) : '')}</pre>`);

  const range = root.querySelector('#replay-range');
  const stepEl = root.querySelector('#replay-step');
  const stateEl = root.querySelector('#replay-state-wrap');
  const eventEl = root.querySelector('#replay-event');
  range?.addEventListener('input', (ev) => {
    replayStep = Number(ev.target.value);
    const s2 = replayFold(records, replayStep);
    if (stepEl) stepEl.textContent = `step ${replayStep + 1}/${records.length}`;
    if (stateEl) stateEl.innerHTML = inspSection(t('inspect.replay.state'), replayStateHtml(s2));
    const e2 = records[replayStep] ? records[replayStep].evt : null;
    if (eventEl) eventEl.textContent = e2 ? JSON.stringify(e2, null, 2) : '';
  });
  root.querySelector('#replay-group')?.addEventListener('change', (ev) => {
    replayGroup = Number(ev.target.value);
    replayStep = 0;
    renderInspect();
  });
  decoratePres(root);
}

function fillLazy(root) {
  for (const det of root.querySelectorAll('details[data-lazy]')) {
    const pre = det.querySelector('pre');
    if (!pre || pre.dataset.filled === '1') continue;
    if (det.open || !det.dataset.deferred) {
      // render closed blocks empty and fill them on first open
      det.dataset.deferred = '1';
      if (det.open) {
        pre.textContent = lazyStore[Number(det.dataset.lazy)] || '';
        pre.dataset.filled = '1';
      }
    }
  }
}

inspBody.addEventListener(
  'toggle',
  (ev) => {
    const det = ev.target;
    if (!det || !det.dataset || det.dataset.lazy == null || !det.open) return;
    const pre = det.querySelector('pre');
    if (pre && pre.dataset.filled !== '1') {
      pre.textContent = lazyStore[Number(det.dataset.lazy)] || '';
      pre.dataset.filled = '1';
    }
  },
  true,
);

/* ------------------------------------------------------------ startup */

/** Make boot problems visible instead of leaving a dead-looking page. */
function fatal(msg) {
  let el = document.getElementById('fatal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatal';
    document.body.prepend(el);
  }
  el.textContent = msg;
}

window.addEventListener('error', (e) => {
  fatal(t('fatal.uiError', { msg: e.message || e.error }));
});

if (location.protocol === 'file:') {
  fatal(t('fatal.fileProtocol'));
  setStatusK('status.wrongOrigin', null, 'error');
}

function connect() {
  const es = new EventSource(api('/api/events') + (state.lastSeq ? `&since=${state.lastSeq}` : ''));
  es.onopen = () => {
    setOnline(true);
    setStatusK('status.connected', null, 'ok');
    if (!state.ready) {
      state.ready = true;
      send({ type: 'get_available_models' }, { silent: true });
      send({ type: 'get_available_thinking_levels' }, { silent: true });
      send({ type: 'get_commands' }, { silent: true });
      send({ type: 'get_state' }, { silent: true });
      send({ type: 'get_messages' }, { silent: true });
      refreshStats();
      loadTraceHistory();
    } else {
      // reconnected (server restart, network blip): re-sync everything, because
      // events emitted while we were away may have been dropped from the buffer
      send({ type: 'get_state' }, { silent: true });
      send({ type: 'get_messages' }, { silent: true });
      refreshStats();
      loadTraceHistory();
      refreshChangesBadge();
    }
  };
  es.onmessage = (ev) => {
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    try {
      handleEvent(data);
    } catch (err) {
      console.error('event handler failed', err, data);
    }
  };
  es.onerror = () => {
    setOnline(false);
    setStatusK('status.disconnected', null, 'error');
  };
}

// The desktop shell draws its own title bar and gives the sidebar the system
// material, so the page must stop painting its own frame.
const IS_DESKTOP = /Electron/i.test(navigator.userAgent);
if (IS_DESKTOP) document.documentElement.classList.add('is-electron');

document.addEventListener('keydown', (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    openPalette();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'e') {
    ev.preventDefault();
    exportHtmlBundle();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'd') {
    ev.preventDefault();
    if (chgEl.classList.contains('hidden')) openChanges();
    else closeChanges();
    return;
  }
  // layout + session navigation
  if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey && (ev.key === '\\' || ev.key.toLowerCase() === 'b')) {
    ev.preventDefault();
    sbSetCollapsed(!sbEl.classList.contains('collapsed'));
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === '{' || ev.key === '[')) {
    ev.preventDefault();
    sbStep(-1);
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === '}' || ev.key === ']')) {
    ev.preventDefault();
    sbStep(1);
  }
});

$('#btn-sidebar')?.addEventListener('click', () => sbSetCollapsed(!sbEl.classList.contains('collapsed')));
$('#btn-sidebar-close')?.addEventListener('click', () => sbSetCollapsed(true));
$('#sb-new')?.addEventListener('click', sbNewSession);
$('#sb-search')?.addEventListener('input', (ev) => sbSearch(ev.target.value));
$('#sb-groupby')?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-by]');
  if (btn) sbSetGroupBy(btn.dataset.by);
});
$('#btn-settings')?.addEventListener('click', openSettings);
$('#btn-changes')?.addEventListener('click', () => dockToggle('changes'));
$('#dock-tabs')?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-dock]');
  if (btn) dockSetTab(btn.dataset.dock);
});
$('#btn-context-refresh')?.addEventListener('click', () => renderDockContext());
$('#btn-changes-close')?.addEventListener('click', closeChanges);
$('#btn-changes-refresh')?.addEventListener('click', () => loadChanges(true));
$('#btn-changes-revert')?.addEventListener('click', revertSelected);
$('#changes-search')?.addEventListener('input', () => renderChanges());
$('#changes-session-only')?.addEventListener('change', () => renderChanges());

$('#btn-inspect-close')?.addEventListener('click', closeInspect);
$('#btn-inspect-refresh')?.addEventListener('click', openInspect);
document.querySelectorAll('#inspect-tabs .tab').forEach((el) => el.addEventListener('click', () => switchInspectTab(el.dataset.itab)));
$('#inspect-agent')?.addEventListener('change', (ev) => {
  state.inspectAgent = ev.target.value;
  renderInspect();
});
inspEl?.addEventListener('mousedown', (ev) => {
  if (ev.target === inspEl) closeInspect();
});

fillThinking(['off', 'minimal', 'low', 'medium', 'high']);
applyI18n();
applyLayout(layoutMode, false);
dockInitResize();
bodyEl.style.setProperty('--dock-w', dockPrefs().width + 'px');
dockTab = dockPrefs().tab;
inputHistory = loadHistory();
const draft = loadDraft();
if (draft) {
  input.value = draft;
  autosize();
}
connect();
sbSetCollapsed(sbPrefs().collapsed, false);
for (const g of sbPrefs().groups) sbState.collapsedGroups.add(g);
sbState.groupBy = sbPrefs().groupBy;
for (const btn of document.querySelectorAll('#sb-groupby button')) {
  btn.classList.toggle('on', btn.dataset.by === sbState.groupBy);
  btn.setAttribute('aria-pressed', String(btn.dataset.by === sbState.groupBy));
}
sbLoad();
refreshChangesBadge();
autosize();
input.focus();

// coming back to a backgrounded tab should never show stale state
// (this is also what keeps a long-lived tab honest after a server restart)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  send({ type: 'get_state' }, { silent: true });
  refreshStats();
});
window.addEventListener('focus', () => {
  if (!state.online) send({ type: 'get_state' }, { silent: true });
});
