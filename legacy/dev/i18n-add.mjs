/**
 * Add one i18n key to both language blocks — in the right block.
 *
 * Hand-editing public/i18n.js by anchoring on a key name is how the same key
 * ends up defined twice in `en` (the second definition silently shadows the
 * first, which ships English text to a translated UI). `dev/i18n-check.mjs`
 * fails on duplicates; this is the tool that avoids creating them.
 *
 *   node dev/i18n-add.mjs <key> <en value> <zh value>
 *   node dev/i18n-add.mjs changes.revertOne 'Revert' '回退'
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'public/i18n.js');
const ANCHOR_EN = process.argv[5] || 'sessions.entryMeta';
const ANCHOR_ZH = process.argv[6] || ANCHOR_EN;

const [key, en, zh] = process.argv.slice(2);
if (!key || en == null || zh == null) {
  console.error('usage: node dev/i18n-add.mjs <key> <en> <zh> [anchorKey] [anchorKeyZh]');
  process.exit(2);
}

let src = fs.readFileSync(FILE, 'utf8');

function blockRange(lang) {
  const start = new RegExp(`^  ${lang}: \\{`, 'm').exec(src);
  if (!start) throw new Error(`no ${lang} block`);
  const end = src.indexOf('\n  },', start.index);
  if (end === -1) throw new Error(`unterminated ${lang} block`);
  return { start: start.index, end };
}

function insert(lang, anchor, value) {
  const { start, end } = blockRange(lang);
  const block = src.slice(start, end);
  if (block.includes(`'${key}':`)) {
    console.log(`  ${lang}: already defined, skipped`);
    return;
  }
  const anchorRe = new RegExp(`^(    '${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':.*)$`, 'm');
  const m = anchorRe.exec(block);
  if (!m) throw new Error(`anchor '${anchor}' not found in ${lang}`);
  const at = start + m.index + m[1].length;
  src = src.slice(0, at) + `\n    '${key}': '${value.replace(/'/g, "\\'")}',` + src.slice(at);
}

insert('en', ANCHOR_EN, en);
insert('zh', ANCHOR_ZH, zh);
fs.writeFileSync(FILE, src);
console.log(`  added '${key}' to en and zh`);
