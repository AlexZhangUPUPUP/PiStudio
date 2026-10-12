/**
 * i18n completeness check.
 *
 * A missing key is silent at runtime — `t()` falls back to English, or worse,
 * renders the key name itself. This finds those before the UI does.
 *
 *   node dev/i18n-check.mjs        # exit 1 if anything is missing
 *
 * Also imported by dev/cdp-test.mjs so the suite covers it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Keys built at runtime as `t('prefix.' + value)`. */
export const DYNAMIC_PREFIXES = {
  'badge.': ['pending', 'streaming', 'running', 'done', 'error'],
  'role.': ['user', 'assistant', 'tool', 'meta', 'custom', 'thinking', 'llm', 'error', 'dialog', 'marker', 'message'],
  'run.': ['working', 'thinking', 'writing', 'tool', 'compacting', 'retrying'],
  'dialog.': ['select', 'confirm', 'input', 'editor'],
};

function loadDictionary() {
  const src = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');
  const sandbox = {};
  // the file only assigns to `window`, so a throwaway object is a safe host
  new Function('window', src)(sandbox);
  return sandbox.PI_I18N || {};
}

const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

export function collectUsedKeys() {
  const app = stripComments(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8'));
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

  const used = new Set();
  const unknownPrefixes = new Set();

  // literal keys across every translation helper
  for (const fn of ['t', 'noticeT', 'setStatusK']) {
    for (const m of app.matchAll(new RegExp(`\\b${fn}\\(\\s*['"]([^'"]+)['"]`, 'g'))) {
      // t('badge.' + status) is composed at runtime — handled below
      if (app.slice(m.index + m[0].length).trimStart().startsWith('+')) continue;
      used.add(m[1]);
    }
  }
  for (const m of app.matchAll(/\btp\(\s*['"]([\w.]+)['"]\s*,\s*['"]([\w.]+)['"]/g)) {
    used.add(m[1]);
    used.add(m[2]);
  }

  // keys assembled at runtime: t('badge.' + status)
  for (const m of app.matchAll(/\bt\(\s*['"]([\w.]+\.)['"]\s*\+/g)) {
    const prefix = m[1];
    if (!DYNAMIC_PREFIXES[prefix]) {
      unknownPrefixes.add(prefix);
      continue;
    }
    for (const suffix of DYNAMIC_PREFIXES[prefix]) used.add(prefix + suffix);
  }

  // markup
  for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="([\w.]+)"/g)) used.add(m[1]);

  return { used, unknownPrefixes };
}

export function checkI18n() {
  const dict = loadDictionary();
  const languages = Object.keys(dict);
  const { used, unknownPrefixes } = collectUsedKeys();

  const missing = {};
  for (const lang of languages) {
    missing[lang] = [...used].filter((k) => !(k in (dict[lang] || {}))).sort();
  }

  const en = dict.en || {};
  const unused = Object.keys(en)
    .filter((k) => !used.has(k))
    .sort();

  // A key defined twice in one language silently shadows itself — and because
  // the last one wins, a copy/paste mistake can ship English text to a
  // translated UI. `loadDictionary` already collapsed duplicates, so re-read
  // the source to catch them.
  const dupes = findDuplicateKeys();

  return { languages, used: [...used].sort(), missing, unused, dupes, unknownPrefixes: [...unknownPrefixes] };
}

/** Keys declared more than once inside one language block in public/i18n.js. */
function findDuplicateKeys() {
  const src = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');
  const out = {};
  const blockRe = /^\s{2}([a-zA-Z-]+):\s*\{/gm;
  let m;
  while ((m = blockRe.exec(src))) {
    const lang = m[1];
    const start = blockRe.lastIndex;
    const end = src.indexOf('\n  },', start);
    if (end === -1) continue;
    const keys = [...src.slice(start, end).matchAll(/^\s{4}'([^']+)':/gm)].map((x) => x[1]);
    const seen = new Set();
    const dup = new Set();
    for (const k of keys) {
      if (seen.has(k)) dup.add(k);
      seen.add(k);
    }
    if (dup.size) out[lang] = [...dup].sort();
  }
  return out;
}

function main() {
  const { languages, used, missing, unused, dupes, unknownPrefixes } = checkI18n();
  const total = Object.values(missing).reduce((n, a) => n + a.length, 0);

  console.log(`languages: ${languages.join(', ')}   keys used: ${used.length}`);
  for (const [lang, keys] of Object.entries(missing)) {
    console.log(`${keys.length === 0 ? '  ok  ' : ' FAIL '} missing in ${lang}: ${keys.length}`);
    for (const k of keys.slice(0, 30)) console.log('        -', k);
  }
  const dupeCount = Object.values(dupes).reduce((n, a) => n + a.length, 0);
  console.log(`${dupeCount === 0 ? '  ok  ' : ' FAIL '} duplicate keys: ${dupeCount}`);
  for (const [lang, keys] of Object.entries(dupes)) console.log(`        ${lang}: ${keys.join(', ')}`);
  if (unknownPrefixes.length) {
    console.log(` FAIL  prefixed keys not declared in DYNAMIC_PREFIXES: ${unknownPrefixes.join(', ')}`);
  }
  console.log(`  note  defined but unused: ${unused.length}${unused.length ? ' (' + unused.slice(0, 8).join(', ') + '…)' : ''}`);

  process.exit(total || dupeCount || unknownPrefixes.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
