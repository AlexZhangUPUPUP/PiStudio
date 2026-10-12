/**
 * Measured UI audit — drives the real page over CDP and reports numbers instead
 * of opinions: reading measure, contrast ratios, type/spacing/radius scale,
 * nesting depth and hit-target sizes.
 *
 *   node dev/css-audit.mjs [pageUrl] [debugPort]
 */
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/';
const PORT = process.argv[3] || '9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('no chrome target');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: PAGE_URL });
await sleep(3000);

// seed a document with the shapes that matter: prose, a table, a fence,
// thinking blocks, tool cards and several turns
const NL = String.fromCharCode(10);
await ev(`(() => {
  const NL = String.fromCharCode(10);
  chat.innerHTML = '';
  state.msgs = [];
  const u = addMessage('user');
  addBlock(u, { type: 'text', text: 'List the three largest files in this folder and then write one sentence about what this project is.' });
  for (let turn = 0; turn < 3; turn++) {
    const msg = addMessage('assistant');
    addBlock(msg, { type: 'thinking', text: 'The user wants the largest files. I should exclude node_modules so the answer is meaningful, then read the README to describe the project.' });
    addBlock(msg, { type: 'toolCall', id: 'tc' + turn, name: 'bash',
      args: { command: 'find . -type f -not -path "./.git/*" -not -path "./node_modules/*" -exec du -k {} + | sort -rn | head -20' },
      argsText: '{}', status: 'done',
      result: '196872' + NL + './node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework' + NL + '19720' + NL + './node_modules/electron/dist/LICENSES.chromium.html' });
    const msg2 = addMessage('assistant');
    const body = [
      '## Three largest files', '',
      '**Overall (including node_modules/):**', '',
      '1. ./.git/objects — 192 MB',
      '2. ./node_modules/electron — 19 MB', '',
      '- a bullet with some words in it',
      '- a second bullet', '',
      '| column a | column b |', '|---|---|', '| 1 | 2 |', '',
      'PROSE_START This paragraph exists to measure the reading measure of body copy in the conversation view, and it is deliberately long enough that a very wide window would produce a line beyond the comfortable range. ' + 'More words follow so the paragraph wraps at least once in any realistic window width. PROSE_END', '',
      'FENCE_START', 'FENCE_END',
    ].join(NL);
    addBlock(msg2, { type: 'text', text: body });
    const msg3 = addMessage('assistant');
    addBlock(msg3, { type: 'toolCall', id: 'te' + turn, name: 'edit', args: { path: 'public/app.js' }, argsText: '{}', status: 'done', details: { diff: '+  1 removed line' + NL + '-  1 added line' } });
  }
  decoratePres(chat);
  return true;
})()`);
await sleep(800);

// splice a real fenced code block into one message (needs real newlines)
await ev(`(() => {
  const NL = String.fromCharCode(10);
  const b = state.msgs.filter((m) => m.blocks.some((x) => x.type === 'text')).pop().blocks.find((x) => x.type === 'text');
  b.text = b.text.replace('FENCE_START', '\`\`\`js').replace('FENCE_END', 'const longLine = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";' + NL + '\`\`\`');
  updateBlock(b);
  return true;
})()`);
await sleep(500);

const report = await ev(`(() => {
  const px = (v) => parseFloat(v) || 0;
  const cs = (el) => getComputedStyle(el);

  // --- contrast -------------------------------------------------------------
  function parseColor(c) {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function over(fg, bg) {
    // composite fg (with alpha) over an opaque bg
    if (!fg || !bg) return fg;
    const a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
  }
  function effectiveBg(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const c = parseColor(cs(node).backgroundColor);
      if (c && c.a > 0.95) return c;
      node = node.parentElement;
    }
    return parseColor(cs(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  }
  const contrasts = [];
  const probe = (label, el) => {
    if (!el) return;
    const style = cs(el);
    const fg = parseColor(style.color);
    const bg = effectiveBg(el);
    if (!fg || !bg) return;
    const r = ratio(over(fg, bg), bg);
    contrasts.push({ label, ratio: Math.round(r * 100) / 100, size: px(style.fontSize), weight: style.fontWeight, fg: style.color, bg: 'rgb(' + [bg.r,bg.g,bg.b].map(Math.round).join(',') + ')' });
  };
  probe('body text', chat.querySelector('.md p'));
  probe('muted (status bar)', document.querySelector('#status'));
  probe('faint (stats)', document.querySelector('#stats'));
  probe('h2 heading', chat.querySelector('.md-h2'));
  probe('inline code', chat.querySelector('.md code'));
  probe('code block', chat.querySelector('pre.code'));
  probe('tool name', chat.querySelector('.tool-name'));
  probe('tool hint', chat.querySelector('.tool-hint'));
  probe('tool badge done', chat.querySelector('.tool-badge'));
  probe('list item', chat.querySelector('.md-list li'));
  probe('table cell', chat.querySelector('td'));
  probe('cwd chip', document.querySelector('#cwd'));
  probe('placeholder-ish hint', document.querySelector('#hist-hint'));

  // --- reading measure ------------------------------------------------------
  const p = chat.querySelector('.md p');
  const measure = p ? Math.round(p.getBoundingClientRect().width) : 0;
  const single = document.createElement('span');
  single.textContent = '0';
  single.style.cssText = cs(p).fontSize + ' ' + cs(p).fontFamily;
  single.style.position = 'absolute';
  document.body.appendChild(single);
  const chPx = single.getBoundingClientRect().width || 8;
  single.remove();

  // --- scales ---------------------------------------------------------------
  const count = (sel, prop) => {
    const out = {};
    for (const el of document.querySelectorAll(sel)) {
      const v = cs(el)[prop];
      if (v) out[v] = (out[v] || 0) + 1;
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 8);
  };
  const radius = {};
  for (const el of document.querySelectorAll('*')) {
    const r = cs(el).borderRadius;
    if (r && r !== '0px') radius[r] = (radius[r] || 0) + 1;
  }
  const fontSizes = {};
  for (const el of document.querySelectorAll('#app *')) {
    const s = cs(el).fontSize;
    fontSizes[s] = (fontSizes[s] || 0) + 1;
  }

  // --- nesting: how deep do *surfaces* go -----------------------------------
  // A "surface" is something that actually paints: a background, or a border
  // that closes on at least two sides. Pure positioning wrappers don't count.
  const isSurface = (el) => {
    const st = cs(el);
    const bg = parseColor(st.backgroundColor);
    const paints = !!bg && bg.a > 0.02;
    const sides = [st.borderTopWidth, st.borderRightWidth, st.borderBottomWidth, st.borderLeftWidth].filter((w) => w !== '0px').length;
    return paints || sides >= 2;
  };
  const nested = [];
  const depths = [];
  for (const el of chat.querySelectorAll('.msg, .bubble, .thinking, .tool, .md-chunk, .codeblock, .codewrap, pre')) {
    let depth = 0;
    let node = el.parentElement;
    while (node && node !== chat) {
      if (isSurface(node)) depth += 1;
      node = node.parentElement;
    }
    depths.push(depth);
    if (depth >= 3) nested.push((el.className || el.tagName) + ' @' + depth);
  }

  // --- hit targets ---------------------------------------------------------
  const small = [];
  for (const el of document.querySelectorAll('#toolbar button, #toolbar select, #composer button, .sessions-head button, .tab, .chip')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.height < 26 || r.width < 26)) small.push((el.id || el.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }

  // --- vertical rhythm ------------------------------------------------------
  const gaps = [];
  const kids = [...chat.querySelectorAll(':scope > .msg')];
  for (let i = 1; i < kids.length; i++) {
    gaps.push(Math.round(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom));
  }

  return {
    viewport: innerWidth + 'x' + innerHeight,
    theme: document.body.className || document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    measurePx: measure,
    measureCh: Math.round(measure / chPx),
    contrasts,
    radius: Object.entries(radius).sort((a, b) => b[1] - a[1]).slice(0, 8),
    fontSizes: Object.entries(fontSizes).sort((a, b) => b[1] - a[1]).slice(0, 10),
    nested: nested.slice(0, 12),
    nestedCount: nested.length,
    maxDepth: depths.length ? Math.max(...depths) : 0,
    smallTargets: small,
    gaps,
  };
})()`);

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nviewport ${report.viewport}  theme ${report.theme}`);
console.log(`\nreading measure: ${report.measurePx}px ≈ ${report.measureCh}ch  ${report.measureCh > 90 ? '❌ too wide' : report.measureCh < 45 ? '⚠️ narrow' : '✅'}`);

console.log('\ncontrast (WCAG AA needs 4.5 for body, 3.0 for large):');
for (const c of report.contrasts) {
  const need = c.size >= 18.66 || (c.size >= 14 && Number(c.weight) >= 700) ? 3 : 4.5;
  const ok = c.ratio >= need ? '✅' : c.ratio >= need - 1 ? '⚠️' : '❌';
  console.log(`  ${ok} ${pad(c.label, 22)} ${pad(c.ratio, 6)} (need ${need})  ${Math.round(c.size)}px  ${c.fg}`);
}

console.log('\nborder-radius inventory:');
for (const [v, n] of report.radius) console.log(`  ${pad(v, 12)} ×${n}`);

console.log('\nfont-size inventory (rendered elements):');
for (const [v, n] of report.fontSizes) console.log(`  ${pad(v, 10)} ×${n}`);

console.log(`\nsurface nesting inside chat: max depth ${report.maxDepth}, ${report.nestedCount} element(s) at depth >= 3`);
for (const n of report.nested.slice(0, 8)) console.log('  ' + n);

console.log('\nhit targets under 26px:');
console.log(report.smallTargets.length ? report.smallTargets.map((s) => '  ' + s).join('\n') : '  none');

console.log('\ngaps between messages: ' + JSON.stringify(report.gaps));
console.log('');
ws.close();
process.exit(0);
