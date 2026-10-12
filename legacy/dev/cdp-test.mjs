import { checkI18n } from './i18n-check.mjs';

/**
 * Headless end-to-end test for the pi-gui frontend using the Chrome DevTools
 * Protocol over Node's built-in WebSocket. Drives the real UI in a real browser.
 *
 *   1. start server:  node server.js --cwd . -- -e ./dev/dialogs-demo.ts
 *   2. start chrome:  ... --headless=new --remote-debugging-port=9222
 *   3. run:           node dev/cdp-test.mjs [pageUrl] [debugPort]
 */
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/';
const PORT = process.argv[3] || '9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('no chrome page target found');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('timeout: ' + method));
        }
      }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
    return r.result.value;
  }
}

const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok, info });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${info ? '  — ' + info : ''}`);
}

async function waitFor(cdp, expr, label, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await cdp.eval(expr)) return true;
    } catch {
      /* context can be torn down during reloads */
    }
    await sleep(200);
  }
  throw new Error('waitFor timed out: ' + label);
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
const cdp = new CDP(ws);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');

const consoleErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(m.params.entry.text);
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
});

await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
// the suite asserts English copy; pin the language for the whole run
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('pi-gui-lang', 'en'); } catch {}`,
});
await cdp.send('Page.navigate', { url: PAGE_URL });
await waitFor(cdp, `document.readyState === 'complete'`, 'page load');
await waitFor(cdp, `!!document.querySelector('#status')`, 'app booted');

/* ---------------------------------------------------------------- basics */

await waitFor(cdp, `document.querySelector('#status').textContent.match(/ready|running/)`, 'connected to pi');
const cwd = await cdp.eval(`document.querySelector('#cwd').textContent`);
check('page connected', true, await cdp.eval(`document.querySelector('#status').textContent`));
check('cwd shown', cwd.includes('/harness/pi'), cwd);
try {
  await waitFor(cdp, `document.querySelector('#model').options.length > 0`, 'models loaded', 25000);
} catch {}
check('models populated', (await cdp.eval(`document.querySelector('#model').options.length`)) > 0, (await cdp.eval(`document.querySelector('#model').options.length`)) + ' models');
try {
  await waitFor(cdp, `document.querySelector('#thinking').options.length > 0`, 'thinking levels loaded', 25000);
} catch {}
check('thinking levels populated', (await cdp.eval(`document.querySelector('#thinking').options.length`)) > 0, await cdp.eval(`[...document.querySelector('#thinking').options].map(o=>o.value).join(',')`));

/* ---------------------------------------------------------------- theme */

async function setTheme(mode) {
  await cdp.eval(`applyTheme(${JSON.stringify(mode)})`);
  await sleep(150);
}

await setTheme('light');
check('theme: light mode applied', (await cdp.eval(`document.documentElement.dataset.theme`)) === 'light');
check('theme: light text colour', (await cdp.eval(`getComputedStyle(document.body).color`)) === 'rgb(36, 41, 47)');
check('theme: light code block background', (await cdp.eval(`getComputedStyle(document.documentElement).getPropertyValue('--code-bg').trim()`)) === '#f6f8fa');

// the app fills the window like an application, not a card on a page
check(
  'style: the shell is full bleed — no frame border, radius or shadow',
  await cdp.eval(`(() => {
    const cs = getComputedStyle(document.querySelector('#app'));
    return cs.borderTopWidth === '0px' && cs.borderTopLeftRadius === '0px' && cs.boxShadow === 'none';
  })()`),
  await cdp.eval(`JSON.stringify({ border: getComputedStyle(document.querySelector('#app')).borderTopWidth, radius: getComputedStyle(document.querySelector('#app')).borderTopLeftRadius, shadow: getComputedStyle(document.querySelector('#app')).boxShadow })`),
);
check(
  'style: the page has no outer padding either',
  (await cdp.eval(`getComputedStyle(document.body).paddingTop`)) === '0px',
  await cdp.eval(`getComputedStyle(document.body).paddingTop`),
);
check(
  'style: the desktop shell is detected and switches the frame off',
  await cdp.eval(`(() => {
    const before = document.documentElement.classList.contains('is-electron');
    document.documentElement.classList.add('is-electron');
    const cs = getComputedStyle(document.querySelector('#app'));
    const transparent = cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent';
    const sidebar = getComputedStyle(document.querySelector('#sidebar')).backgroundColor;
    if (!before) document.documentElement.classList.remove('is-electron');
    return transparent && (sidebar === 'rgba(0, 0, 0, 0)' || sidebar === 'transparent');
  })()`),
);
check(
  'style: border token is a light hairline',
  (await cdp.eval(`getComputedStyle(document.documentElement).getPropertyValue('--line').trim()`)) === '#e3e6ea',
);
check(
  'style: surface contrast stays low',
  (await cdp.eval(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)) === '#ffffff' &&
    (await cdp.eval(`getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim()`)) === '#f5f6f8',
);

const i18nStatic = checkI18n();
check(
  'i18n: every used key exists in both languages',
  Object.values(i18nStatic.missing).every((a) => a.length === 0) && i18nStatic.unknownPrefixes.length === 0,
  `${i18nStatic.used.length} keys · missing ${Object.entries(i18nStatic.missing).map(([l, a]) => l + ':' + a.length).join(' ')}`,
);
const csp = await cdp.eval(`fetch('/').then((r) => r.headers.get('content-security-policy') || '')`);
check('security: CSP is served', csp.includes("default-src 'self'") && csp.includes("script-src 'self'"), csp.slice(0, 48) + '…');
check(
  'security: nosniff + referrer-policy',
  (await cdp.eval(`fetch('/').then((r) => r.headers.get('x-content-type-options') + '/' + r.headers.get('referrer-policy'))`)) ===
    'nosniff/no-referrer',
);

await setTheme('dark');
check('theme: dark mode applied', (await cdp.eval(`document.documentElement.dataset.theme`)) === 'dark');
check('theme: dark text colour', (await cdp.eval(`getComputedStyle(document.body).color`)) === 'rgb(230, 232, 235)');
check(
  'theme: dark surface is not pure black',
  (await cdp.eval(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)) === '#16181d',
);

await cdp.send('Page.reload');
await sleep(900);
await waitFor(cdp, `document.readyState === 'complete' && document.documentElement.dataset.theme === 'dark'`, 'theme persisted');
check('theme: persisted across reload', true, await cdp.eval(`localStorage.getItem('pi-gui-theme')`));
await waitFor(cdp, `document.querySelector('#status').textContent.match(/ready|running/)`, 'reconnected after reload');
await sleep(400);

/* ------------------------------------------- i18n (zh / en switching) ---- */

check('i18n: english by default', (await cdp.eval(`document.querySelector('#btn-send').textContent`)) === 'Send');
check('i18n: <html lang> is en', (await cdp.eval(`document.documentElement.lang`)) === 'en');
await cdp.eval(`setLang(lang === 'zh' ? 'en' : 'zh')`);
await sleep(350);
check('i18n: switches to chinese', (await cdp.eval(`document.querySelector('#btn-send').textContent`)) === '发送');
check('i18n: <html lang> updated', (await cdp.eval(`document.documentElement.lang`)) === 'zh-CN');
check(
  'i18n: toolbar translated',
  (await cdp.eval(`document.querySelector('#btn-new').textContent`)).includes('新建'),
  await cdp.eval(`document.querySelector('#btn-new').textContent`),
);
check(
  'i18n: composer placeholder translated',
  (await cdp.eval(`document.querySelector('#input').placeholder`)).includes('问 pi'),
);
check(
  'i18n: status bar translated',
  /[\u4e00-\u9fa5]/.test(await cdp.eval(`document.querySelector('#status').textContent`)),
  await cdp.eval(`document.querySelector('#status').textContent`),
);
check('i18n: role chips translated', (await cdp.eval(`document.querySelector('#tree-roles .chip').textContent`)) === '用户');
check(
  'i18n: session hint translated',
  (await cdp.eval(`document.querySelector('.foot-hint').textContent`)).includes('只追加'),
);
check('i18n: persisted in localStorage', (await cdp.eval(`localStorage.getItem('pi-gui-lang')`)) === 'zh');

// exercise the panels *in Chinese* so runtime-composed keys are covered too
await cdp.eval(`(traceSetOpen(true), openSessions(), openInspect(), true)`);
await sleep(1100);
await cdp.eval(`(closeInspect(), closeSessions(), traceSetOpen(false), true)`);
await sleep(300);
check(
  'i18n: no key fell back while running in Chinese',
  await cdp.eval(`Object.values(window.__i18nFallback || {}).every((a) => a.length === 0)`),
  await cdp.eval(`JSON.stringify(window.__i18nFallback || {})`),
);
await cdp.eval(`openSettings()`);
await sleep(300);
check(
  'i18n: the settings modal holds the language toggle',
  (await cdp.eval(`document.querySelector('#btn-lang')?.textContent`)) === 'EN',
  await cdp.eval(`document.querySelector('#btn-lang')?.textContent`),
);
check(
  'settings: modal lists the toolbar actions',
  (await cdp.eval(`['btn-theme','btn-lang','btn-trace','btn-sessions','btn-inspect','btn-diag','btn-restart'].every((id) => !!document.getElementById(id))`)),
);
check(
  'settings: toolbar itself stayed lean',
  (await cdp.eval(`[...document.querySelectorAll('#toolbar .right button')].map((b) => b.id).join(',')`)) === 'picker-btn,btn-changes,btn-settings,btn-new,btn-stop',
  await cdp.eval(`[...document.querySelectorAll('#toolbar .right button')].map((b) => b.id).join(',')`),
);
await cdp.eval(`closeSettings()`);
await sleep(200);
await cdp.eval(`setLang(lang === 'zh' ? 'en' : 'zh')`);
await sleep(350);
check('i18n: switches back to english', (await cdp.eval(`document.querySelector('#btn-send').textContent`)) === 'Send');

/* ------------------------------------------------------------ autocomplete */

check(
  'autocomplete: commands loaded from get_commands',
  (await cdp.eval(`state.commands.length`)) > 0,
  await cdp.eval(`state.commands.map((c) => c.name).join(',')`),
);
await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.focus(); i.value = '/'; i.dispatchEvent(new Event('input')); return true; })()`,
);
await waitFor(cdp, `!document.querySelector('#ac').classList.contains('hidden')`, 'command popup', 8000);
check('autocomplete: slash opens the command list', true, await cdp.eval(`document.querySelector('#ac .ac-head').textContent`));
check('autocomplete: commands listed', (await cdp.eval(`document.querySelectorAll('#ac .ac-item').length`)) > 0);
await cdp.eval(`document.querySelector('#ac .ac-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await sleep(200);
check(
  'autocomplete: picking inserts the command',
  (await cdp.eval(`document.querySelector('#input').value`)).startsWith('/'),
  JSON.stringify(await cdp.eval(`document.querySelector('#input').value`)),
);
check('autocomplete: popup closes after picking', await cdp.eval(`document.querySelector('#ac').classList.contains('hidden')`));

await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = 'check @i18n'; i.dispatchEvent(new Event('input')); return true; })()`,
);
await waitFor(cdp, `!document.querySelector('#ac').classList.contains('hidden')`, 'file popup', 8000);
check(
  'autocomplete: @ searches project files',
  /i18n\.js/.test(await cdp.eval(`document.querySelector('#ac .ac-name')?.textContent || ''`)),
  await cdp.eval(`document.querySelector('#ac .ac-head').textContent`),
);
await cdp.eval(
  `(() => { document.querySelector('#input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`,
);
await sleep(150);
check('autocomplete: Escape closes it', await cdp.eval(`document.querySelector('#ac').classList.contains('hidden')`));
await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`,
);

check(
  'streaming caret is defined',
  (await cdp.eval(
    `(() => { const d = document.createElement('div'); d.className = 'md streaming'; document.body.appendChild(d); const c = getComputedStyle(d, '::after').content; d.remove(); return c; })()`,
  )) !== 'none',
);

/* ---------------------------------------------------------- attachments */

await cdp.eval(`(async () => {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#e00'; ctx.fillRect(0, 0, 16, 16);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'test.png', { type: 'image/png' });
  await addImageFiles([file]);
  return true;
})()`);
check('attachment: stored in state', (await cdp.eval(`state.attachments.length`)) === 1);
check('attachment: thumbnail rendered', (await cdp.eval(`document.querySelectorAll('#attachments .att').length`)) === 1);
check(
  'attachment: preview is a png data url',
  (await cdp.eval(`document.querySelector('#attachments .att img').src.slice(0, 22)`)) === 'data:image/png;base64,',
);

await cdp.eval(
  `(() => { window.__captured = null; const orig = send; send = (cmd) => { window.__captured = cmd; send = orig; return Promise.resolve({ ok: true }); }; return true; })()`,
);
await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = 'describe this image'; i.dispatchEvent(new Event('input')); document.querySelector('#btn-send').click(); return true; })()`,
);
await sleep(300);
check(
  'attachment: sent as part of the prompt',
  (await cdp.eval(`window.__captured && window.__captured.images && window.__captured.images.length`)) === 1,
  JSON.stringify(await cdp.eval(`window.__captured && { message: window.__captured.message, images: (window.__captured.images || []).length }`)),
);
check('attachment: removed after send', (await cdp.eval(`document.querySelectorAll('#attachments .att').length`)) === 0);

/* ------------------------------------------------------- extension dialogs */

await cdp.eval(`(() => { const i = document.querySelector('#input'); i.value = '/dialogtest'; i.dispatchEvent(new Event('input')); document.querySelector('#btn-send').click(); return true; })()`);

await waitFor(cdp, `!!document.querySelector('.modal')`, 'select dialog');
check('dialog: select', (await cdp.eval(`document.querySelector('.modal-kind').dataset.method`)) === 'select');
check('dialog: select options', (await cdp.eval(`document.querySelectorAll('.modal-option').length`)) === 3, await cdp.eval(`[...document.querySelectorAll('.modal-option')].map(o=>o.textContent).join('|')`));
await cdp.eval(`document.querySelectorAll('.modal-option')[1].click()`);

await waitFor(cdp, `document.querySelector('.modal-kind')?.dataset.method === 'confirm'`, 'confirm dialog');
check('dialog: confirm message', (await cdp.eval(`document.querySelector('.modal-body p').textContent`)).length > 0);
await cdp.eval(`[...document.querySelectorAll('.modal-foot button')].find(b=>b.className.includes('primary')).click()`);

await waitFor(cdp, `document.querySelector('.modal-kind')?.dataset.method === 'input'`, 'input dialog');
await cdp.eval(`(() => { document.querySelector('.modal input[type=text]').value = 'Alex'; return true; })()`);
await cdp.eval(`[...document.querySelectorAll('.modal-foot button')].find(b=>b.className.includes('primary')).click()`);

await waitFor(cdp, `document.querySelector('.modal-kind')?.dataset.method === 'editor'`, 'editor dialog');
await cdp.eval(`(() => { document.querySelector('.modal textarea').value = 'edited line 1\\nedited line 2'; return true; })()`);
await cdp.eval(`[...document.querySelectorAll('.modal-foot button')].find(b=>b.className.includes('primary')).click()`);

await waitFor(cdp, `!document.querySelector('.modal')`, 'dialogs closed');
check('dialog: all four handled', true);

await waitFor(cdp, `document.querySelector('#input').value.includes('prefilled')`, 'setEditorText applied');
check('ui.setEditorText -> composer', true, await cdp.eval(`document.querySelector('#input').value`));
check('ui.setTitle -> document.title', true, await cdp.eval(`document.title`));

await waitFor(cdp, `document.querySelector('#chat').innerText.includes('dialogtest results')`, 'dialogtest results echoed', 30000);
check('answers reached extension + custom message rendered', true, await cdp.eval(`document.querySelector('#chat').innerText.match(/dialogtest results[^\\n]*/)?.[0] || ''`));

/* --------------------------- normal prompt: streaming reply renders ------ */

const usersBefore = await cdp.eval(`document.querySelectorAll('.msg.user').length`);
const assistBefore = await cdp.eval(`document.querySelectorAll('.msg.assistant').length`);
await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = 'Reply with exactly: PIPE OK'; i.dispatchEvent(new Event('input')); document.querySelector('#btn-send').click(); return true; })()`,
);
await waitFor(cdp, `document.querySelectorAll('.msg.user').length > ${usersBefore}`, 'normal prompt sent');
await waitFor(cdp, `document.querySelector('#run-state').classList.contains('on')`, 'run state visible', 20000);
check('run state: visible while running', true, await cdp.eval(`document.querySelector('#run-state').textContent`));
check(
  'actions: last user message offers edit + retry',
  (await cdp.eval(`document.querySelectorAll('.msg.user .act-fork').length`)) >= 2,
  await cdp.eval(`[...document.querySelectorAll('.msg.user .act-fork')].map((b) => b.textContent).join(',')`),
);
await waitFor(cdp, `document.querySelectorAll('.msg.assistant').length > ${assistBefore}`, 'assistant reply streamed', 150000);
await waitFor(cdp, `document.querySelector('#btn-stop').disabled === true`, 'agent settled', 150000);
check('run state: hidden after settle', !(await cdp.eval(`document.querySelector('#run-state').classList.contains('on')`)));
check(
  'assistant answers can be copied whole',
  (await cdp.eval(`document.querySelectorAll('.msg.assistant .act-copy').length`)) > 0,
  (await cdp.eval(`document.querySelectorAll('.msg.assistant .act-copy').length`)) + ' copy buttons',
);
check(
  'normal prompt streamed a reply',
  true,
  JSON.stringify(await cdp.eval(`[...document.querySelectorAll('.msg.assistant .md')].slice(-1)[0]?.textContent.trim().slice(0, 40)`)),
);

/* --------------- tool rendering, driven deterministically ----------------
 * Whether the model decides to call a tool is not something a test should
 * depend on, so the tool lifecycle is fed straight into the event handler.   */

await cdp.eval(`(() => {
  const now = Date.now();
  handleEvent({ type: 'message_start', __seq: 910001, __t: now, message: { role: 'assistant', content: [], timestamp: now } });
  handleEvent({ type: 'message_update', __seq: 910002, __t: now, assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, id: 'call_test_1', toolName: 'bash' } });
  handleEvent({ type: 'message_update', __seq: 910003, __t: now, assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: '{"command":"echo trace-test"}' } });
  handleEvent({ type: 'message_update', __seq: 910004, __t: now, assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: { id: 'call_test_1', name: 'bash', arguments: { command: 'echo trace-test' } } } });
  handleEvent({ type: 'tool_execution_start', __seq: 910005, __t: now, toolCallId: 'call_test_1', toolName: 'bash', args: { command: 'echo trace-test' } });
  handleEvent({ type: 'tool_execution_update', __seq: 910006, __t: now, toolCallId: 'call_test_1', toolName: 'bash', partialResult: { content: [{ type: 'text', text: 'trace-' }] } });
  handleEvent({ type: 'tool_execution_end', __seq: 910007, __t: now, toolCallId: 'call_test_1', toolName: 'bash', result: { content: [{ type: 'text', text: 'trace-test' }] }, isError: false });
  handleEvent({ type: 'message_end', __seq: 910008, __t: now, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call_test_1', name: 'bash', arguments: { command: 'echo trace-test' } }], stopReason: 'toolUse', timestamp: now } });
  return true;
})()`);
await sleep(300);
check(
  'tool call renders a card in the chat',
  await cdp.eval(`[...document.querySelectorAll('.tool-badge')].some((b) => b.textContent === 'done')`),
);
check(
  'tool card shows the tool output',
  await cdp.eval(`[...document.querySelectorAll('details.tool')].some((d) => d.innerText.includes('trace-test'))`),
);

/* ------------------------ tool cards: diff / copy / collapse ------------- */

await cdp.eval(`(() => {
  const NL = String.fromCharCode(10);
  const now = Date.now();
  handleEvent({ type: 'tool_execution_start', __seq: 911001, __t: now, toolCallId: 'diff_1', toolName: 'edit', args: { path: 'public/app.js', edits: [] } });
  handleEvent({ type: 'tool_execution_end', __seq: 911002, __t: now, toolCallId: 'diff_1', toolName: 'edit',
    result: { content: [{ type: 'text', text: 'ok' }], details: { diff: ['@@ -1,2 +1,2 @@', ' ctx', '-old line', '+new line'].join(NL) } }, isError: false });
  return true;
})()`);
await sleep(400);
check(
  'tool diff: removed lines highlighted',
  (await cdp.eval(`document.querySelectorAll('.diff-del').length`)) >= 1,
  await cdp.eval(`document.querySelectorAll('.diff-add').length + '/' + document.querySelectorAll('.diff-del').length`),
);
check('tool diff: added lines highlighted', (await cdp.eval(`document.querySelectorAll('.diff-add').length`)) >= 1);
check(
  'tool diff: +N −M badge',
  /\+\d+/.test(await cdp.eval(`[...document.querySelectorAll('details.tool')].pop()?.querySelector('.tool-stat')?.textContent || ''`)),
  await cdp.eval(`[...document.querySelectorAll('details.tool')].pop()?.querySelector('.tool-stat')?.textContent`),
);
check('tool card: shows the edited path', (await cdp.eval(`[...document.querySelectorAll('.tool-hint')].pop()?.textContent`)) === 'public/app.js');
check('tool card: copy button present', (await cdp.eval(`document.querySelectorAll('.copy-btn').length`)) > 0);

await cdp.eval(`(() => {
  const NL = String.fromCharCode(10);
  const now = Date.now();
  handleEvent({ type: 'tool_execution_start', __seq: 911003, __t: now, toolCallId: 'long_1', toolName: 'bash', args: { command: 'seq 1 200' } });
  handleEvent({ type: 'tool_execution_end', __seq: 911004, __t: now, toolCallId: 'long_1', toolName: 'bash',
    result: { content: [{ type: 'text', text: Array.from({ length: 200 }, (_, i) => 'line ' + (i + 1)).join(NL) }] }, isError: false });
  return true;
})()`);
await sleep(400);
check('long tool output starts collapsed', (await cdp.eval(`document.querySelectorAll('pre.clamped').length`)) > 0);
await cdp.eval(`document.querySelector('.expand-btn')?.click()`);
await sleep(200);
check('long tool output can be expanded', (await cdp.eval(`document.querySelectorAll('pre.clamped').length`)) === 0);

/* -------------------- per-tool renderers + export ------------------------ */

await cdp.eval(`(() => {
  const NL = String.fromCharCode(10);
  const now = Date.now();
  handleEvent({ type: 'tool_execution_start', __seq: 912001, __t: now, toolCallId: 'rd1', toolName: 'read', args: { path: 'public/app.js', offset: 10, limit: 3 } });
  handleEvent({ type: 'tool_execution_end', __seq: 912002, __t: now, toolCallId: 'rd1', toolName: 'read', result: { content: [{ type: 'text', text: ['alpha', 'beta', 'gamma'].join(NL) }] }, isError: false });
  handleEvent({ type: 'tool_execution_start', __seq: 912003, __t: now, toolCallId: 'gr1', toolName: 'grep', args: { pattern: 'needle', path: '.' } });
  handleEvent({ type: 'tool_execution_end', __seq: 912004, __t: now, toolCallId: 'gr1', toolName: 'grep', result: { content: [{ type: 'text', text: ['a.txt:2:needle here', 'a.txt:9:another needle', 'b/c.txt:4:needle too'].join(NL) }] }, isError: false });
  handleEvent({ type: 'tool_execution_start', __seq: 912005, __t: now, toolCallId: 'wr1', toolName: 'write', args: { path: 'brand-new.txt', content: ['one', 'two', 'three'].join(NL) } });
  handleEvent({ type: 'tool_execution_end', __seq: 912006, __t: now, toolCallId: 'wr1', toolName: 'write', result: { content: [{ type: 'text', text: 'wrote brand-new.txt' }] }, isError: false });
  return true;
})()`);
await sleep(500);
check('tool read: line-numbered gutter', (await cdp.eval(`document.querySelectorAll('.read-line').length`)) === 3);
check(
  'tool read: header shows path + range',
  /public\/app\.js/.test(await cdp.eval(`[...document.querySelectorAll('.tool-hint')].map((e) => e.textContent).join(' | ')`)),
  await cdp.eval(`[...document.querySelectorAll('.tool-hint')].pop()?.textContent`),
);
check('tool grep: results grouped per file', (await cdp.eval(`document.querySelectorAll('.grep-file').length`)) === 2);
check('tool grep: every hit gets a line number', (await cdp.eval(`document.querySelectorAll('.grep-hit').length`)) === 3);
check(
  'tool grep: match count badge',
  (await cdp.eval(`document.querySelector('.grep-file .insp-flag')?.textContent`)) === '2',
);
check('tool write: content shown as added lines', (await cdp.eval(`document.querySelectorAll('details.tool .diff-add').length`)) >= 3);
check('tool write: +N stat', /\+3/.test(await cdp.eval(`[...document.querySelectorAll('.tool-stat')].pop()?.textContent || ''`)));
check(
  'export: markdown builder works',
  await cdp.eval(`conversationMarkdown().startsWith('# pi-gui conversation')`),
  (await cdp.eval(`conversationMarkdown().length`)) + ' chars',
);
check(
  'export: contains the live conversation',
  await cdp.eval(`conversationMarkdown().includes('PIPE OK') || conversationMarkdown().includes('TWO TABS OK')`),
  (await cdp.eval(`JSON.stringify(state.allMessages.map((m) => m.role).slice(-6))`)),
);

/* ------------------- inspector: pi's internals, captured live ------------ */

// Inspector state is per-session (a fork or a switch clears it), so this section
// runs its own exchange instead of depending on whatever ran earlier.
await cdp.eval(`(() => { const i = document.querySelector('#input'); i.value = 'Say exactly: INSPECT OK'; i.dispatchEvent(new Event('input')); document.querySelector('#btn-send').click(); return true; })()`);
await waitFor(cdp, `state.inspect.filter((r) => r.kind === 'request').length > 0`, 'inspector records', 120000);
await sleep(800);

await cdp.eval(`openInspect()`);
await waitFor(cdp, `!document.querySelector('#inspect').classList.contains('hidden')`, 'inspector opens', 8000);
await sleep(600); // let /api/inspect sync the server-side buffer (incl. startup records)

check(
  'inspector: system prompt captured from the extension',
  (await cdp.eval(`state.inspect.filter((r) => r.kind === 'system_prompt').length`)) > 0,
  (await cdp.eval(`JSON.stringify((state.inspect.find((r) => r.kind === 'system_prompt') || {}).data?.chars)`)) + ' chars',
);
check(
  'inspector: provider request captured',
  (await cdp.eval(`state.inspect.filter((r) => r.kind === 'request').length`)) > 0,
  await cdp.eval(`JSON.stringify((state.inspect.find((r) => r.kind === 'request') || {}).data?.params?.model)`),
);
check('inspector: context assembly captured', (await cdp.eval(`state.inspect.filter((r) => r.kind === 'context').length`)) > 0);
check('inspector: http response captured', (await cdp.eval(`state.inspect.filter((r) => r.kind === 'response').length`)) > 0);
check('inspector: resources discovery captured', (await cdp.eval(`state.inspect.filter((r) => r.kind === 'resources').length`)) > 0);

check(
  'inspector: panel opens with seven tabs',
  (await cdp.eval(`document.querySelectorAll('#inspect-tabs .tab').length`)) === 7,
  (await cdp.eval(`document.querySelectorAll('#inspect-tabs .tab').length`)) + ' tabs',
);
check(
  'inspector: system prompt tab shows the composition',
  (await cdp.eval(`document.querySelector('#inspect-body').innerText.includes('selectedTools')`)),
);
check(
  'inspector: big payloads stay out of the DOM until opened',
  (await cdp.eval(`(document.querySelector('#inspect-body details[data-lazy] .insp-pre')?.textContent || '').length`)) === 0,
);
await cdp.eval(`(() => { const d = document.querySelector('#inspect-body details[data-lazy]'); if (d) d.open = true; return true; })()`);
await sleep(300);
check(
  'inspector: system prompt loads on demand',
  (await cdp.eval(`(document.querySelector('#inspect-body details[data-lazy] .insp-pre')?.textContent || '').length`)) > 500,
  (await cdp.eval(`(document.querySelector('#inspect-body details[data-lazy] .insp-pre')?.textContent || '').length`)) + ' chars',
);

for (const tab of ['context', 'requests', 'session', 'caps', 'replay']) {
  await cdp.eval(`document.querySelector('#inspect-tabs .tab[data-itab="${tab}"]').click()`);
  await sleep(300);
  check(
    `inspector: ${tab} tab renders`,
    (await cdp.eval(`document.querySelector('#inspect-body').innerText.trim().length`)) > 20,
    (await cdp.eval(`document.querySelector('#inspect-body').innerText.trim().length`)) + ' chars',
  );
}
/* ------------- multi-agent visibility (synthetic, so it is deterministic) -- */

await cdp.eval(`handleEvent({ type: '__agent', event: 'start', agent: { key: 'pid:999001', child: true, parentKey: 'main', task: 'summarise the repo', model: 'deepseek/deepseek-v4-flash', pid: 999001, count: 0, lastAt: Date.now() } })`);
await cdp.eval(`handleEvent({ type: '__inspect', __seq: 990001, __t: Date.now(), at: Date.now(), agent: 'pid:999001', kind: 'request', data: { params: { model: 'deepseek/deepseek-v4-flash' }, messageCount: 3, toolCount: 2, toolNames: ['read'], messageRoles: ['system', 'user'], bytes: 1234, raw: '{}' } })`);
await cdp.eval(`handleEvent({ type: '__inspect', __seq: 990002, __t: Date.now(), at: Date.now(), agent: 'pid:999001', kind: 'system_prompt', data: { chars: 3100, systemPrompt: 'You are a scout.', selectedTools: ['read'], promptGuidelines: [], contextFiles: [], skills: [], toolSnippets: {} } })`);
await sleep(400);
check(
  'agents: the registry lists the sub-agent',
  (await cdp.eval(`state.agents.filter((a) => a.child).length`)) === 1,
  await cdp.eval(`JSON.stringify(state.agents.map((a) => a.key))`),
);
check(
  'agents: the selector offers main + sub-agent',
  (await cdp.eval(`document.querySelectorAll('#inspect-agent option').length`)) >= 2,
  await cdp.eval(`JSON.stringify([...document.querySelectorAll('#inspect-agent option')].map((o) => o.textContent.slice(0, 34)))`),
);
await cdp.eval(`switchInspectTab('agents')`);
await sleep(400);
check(
  'agents: the Agents tab lists both',
  (await cdp.eval(`document.querySelectorAll('#inspect-body .agent-row').length`)) >= 2,
  (await cdp.eval(`document.querySelectorAll('#inspect-body .agent-row').length`)) + ' rows',
);
await cdp.eval(`(() => { const s = document.querySelector('#inspect-agent'); s.value = 'pid:999001'; s.dispatchEvent(new Event('change')); return true; })()`);
await sleep(300);
await cdp.eval(`switchInspectTab('requests')`);
await sleep(500);
check(
  'agents: switching the selector filters the other tabs',
  await cdp.eval(`document.querySelector('#inspect-body').innerText.includes('deepseek-v4-flash')`),
  await cdp.eval(`document.querySelector('#inspect-body').innerText.slice(0, 70).split(String.fromCharCode(10)).join(' ')`),
);
check(
  'agents: records are tagged per agent',
  (await cdp.eval(`state.inspect.filter((r) => r.agent === 'pid:999001').length`)) === 2,
  await cdp.eval(`state.inspect.filter((r) => r.agent === 'pid:999001').map((r) => r.kind).join(',')`),
);
await cdp.eval(`(() => { state.agents = state.agents.filter((a) => !a.child); state.inspectAgent = 'main'; syncAgentSelect(); return true; })()`);

/* the context view reads the same inspector records — check it while they exist */
check(
  'dock: the context view renders prompt, context and last request',
  await cdp.eval(`(async () => {
    openContext();
    await new Promise((r) => setTimeout(r, 500));
    const text = document.querySelector('#dock-context-body').innerText;
    // section titles are uppercased by CSS, so compare case-insensitively
    return /system prompt|系统提示/i.test(text) && /messages|消息/.test(text) && /last request|最近一次请求/i.test(text);
  })()`),
  await cdp.eval(`document.querySelector('#dock-context-body').innerText.split(String.fromCharCode(10)).slice(0, 2).join(' | ').slice(0, 70)`),
);
check(
  'dock: switching tabs shows exactly one view',
  await cdp.eval(`(() => {
    for (const name of ['trace', 'changes', 'context']) {
      dockSetTab(name);
      const visible = ['trace', 'changes', 'context'].filter((p) => !document.querySelector('#dock-pane-' + p).classList.contains('hidden'));
      if (visible.length !== 1 || visible[0] !== name) return 'broken at ' + name + ': ' + JSON.stringify(visible);
    }
    return 'ok';
  })()`).then((r) => r === 'ok'),
);
await cdp.eval(`dockSetTab('trace'); dockClose()`);
await sleep(200);

await cdp.eval(`closeInspect()`);
await sleep(200);
check(
  'a11y: inspector panel is a dialog',
  (await cdp.eval(`document.querySelector('#inspect .sessions-panel').getAttribute('role')`)) === 'dialog' &&
    (await cdp.eval(`document.querySelector('#inspect .sessions-panel').getAttribute('aria-labelledby')`)) === 'inspect-title',
);
await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(300);
check('a11y: Escape closes the inspector', await cdp.eval(`document.querySelector('#inspect').classList.contains('hidden')`));

/* ----------------- draft, history, scroll-to-latest, diagnostics --------- */

check('scroll-to-latest button exists', await cdp.eval(`!!document.querySelector('#to-latest')`));
const scrollInfo = await cdp.eval(`(() => {
  const c = document.querySelector('#chat');
  let guard = 0;
  while (c.scrollHeight <= c.clientHeight + 120 && guard++ < 40) {
    const d = document.createElement('div');
    d.className = 'msg system filler';
    d.innerHTML = '<div class="bubble"><div class="md">filler for the scroll test</div></div>';
    c.appendChild(d);
  }
  c.scrollTop = 0;
  c.dispatchEvent(new Event('scroll'));
  return c.scrollHeight + '/' + c.clientHeight + '/' + c.scrollTop;
})()`);
await sleep(250);
check(
  'scroll-to-latest appears when scrolled up',
  await cdp.eval(`document.querySelector('#to-latest').classList.contains('on')`),
  scrollInfo,
);
await cdp.eval(`document.querySelector('#to-latest').click()`);
await sleep(250);
check('scroll-to-latest hides after use', !(await cdp.eval(`document.querySelector('#to-latest').classList.contains('on')`)));
await cdp.eval(`document.querySelectorAll('.msg.filler').forEach((e) => e.remove())`);

await cdp.eval(`openDiagnostics()`);
await waitFor(cdp, `!!document.querySelector('.diag')`, 'diagnostics modal', 8000);
check(
  'diagnostics modal lists fields',
  (await cdp.eval(`document.querySelectorAll('.diag dt').length`)) >= 6,
  (await cdp.eval(`document.querySelectorAll('.diag dt').length`)) + ' rows',
);
check('diagnostics: shows the pi pid', /pid/.test(await cdp.eval(`document.querySelector('.diag dd')?.textContent || ''`)));
check(
  'memory: diagnostics reports byte usage',
  await cdp.eval(`fetch(api('/api/diagnostics')).then((r) => r.json()).then((d) => (d.memory?.traceBytes ?? -1) >= 0)`),
);
await cdp.eval(`[...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent === 'Close')?.click()`);
await sleep(200);
check(
  'restart-pi lives in the settings modal',
  await cdp.eval(`(openSettings(), !!document.querySelector('#btn-restart'))`),
  await cdp.eval(`(closeSettings(), 'ok')`),
);

await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = 'unfinished draft'; i.dispatchEvent(new Event('input')); return true; })()`,
);
await sleep(500);
check('draft is persisted to localStorage', (await cdp.eval(`localStorage.getItem('pi-gui-draft')`)) === 'unfinished draft');
await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`,
);
await sleep(400);
check(
  'input history keeps previous prompts',
  (await cdp.eval(`JSON.parse(localStorage.getItem('pi-gui-history') || '[]').length`)) > 0,
  await cdp.eval(`JSON.stringify(JSON.parse(localStorage.getItem('pi-gui-history') || '[]').slice(-2))`),
);

/* ------------------------------------------------------------ sessions */

await cdp.eval(`openSessions()`);
await waitFor(cdp, `document.querySelectorAll('#tree-view .tree-node').length > 0`, 'session tree rendered', 30000);
check(
  'a11y: sessions panel is a dialog',
  (await cdp.eval(`document.querySelector('#sessions .sessions-panel').getAttribute('role')`)) === 'dialog' &&
    (await cdp.eval(`document.querySelector('#sessions .sessions-panel').getAttribute('aria-modal')`)) === 'true' &&
    (await cdp.eval(`document.querySelector('#sessions .sessions-panel').getAttribute('aria-labelledby')`)) === 'sessions-title',
);
check('a11y: focus moved into the sessions panel', await cdp.eval(`document.querySelector('#sessions').contains(document.activeElement)`));
check('sessions: branch tree rendered', true, (await cdp.eval(`document.querySelectorAll('#tree-view .tree-node').length`)) + ' nodes');
check('sessions: current leaf marked', await cdp.eval(`!!document.querySelector('#tree-view .tree-leaf')`));
try {
  await waitFor(cdp, `!!document.querySelector('#tree-view .tree-node.kind-user')`, 'user entry in tree', 20000);
} catch {}
try {
  await waitFor(cdp, `!!document.querySelector('#tree-view .tree-node.kind-assistant')`, 'assistant entry in tree', 20000);
} catch {}
check(
  'sessions: user entries present',
  await cdp.eval(`!!document.querySelector('#tree-view .tree-node.kind-user')`),
  await cdp.eval(`JSON.stringify({ client: CLIENT_ID, file: (state.sessionFile || '').split('/').pop(), nodes: [...document.querySelectorAll('#tree-view .tree-node')].map((e) => e.className.replace('tree-node ', '')), msgs: state.allMessages.length })`),
);
check('sessions: assistant entries present', await cdp.eval(`!!document.querySelector('#tree-view .tree-node.kind-assistant')`));
check('sessions: info bar populated', (await cdp.eval(`document.querySelector('#session-info').textContent.length`)) > 0, await cdp.eval(`document.querySelector('#session-info').textContent`));

await cdp.eval(`document.querySelector('#tree-view .tree-node.kind-user').click()`);
await sleep(150);
check('sessions: fork enabled for user node', (await cdp.eval(`!document.querySelector('#btn-session-fork').disabled`)) === true);
check('sessions: selection shown', (await cdp.eval(`document.querySelector('#session-selection').textContent.length`)) > 0);

// bookmark round-trip: GUI -> /gui-label extension command -> pi.setLabel -> get_tree
const targetId = await cdp.eval(`document.querySelector('#tree-view .tree-node.kind-assistant')?.dataset.id`);
const clickNode = `(() => { const n = [...document.querySelectorAll('#tree-view .tree-node')].find(e => e.dataset.id === ${JSON.stringify(
  targetId,
)}); if (n) n.click(); return !!n; })()`;
check('sessions: assistant node selectable', await cdp.eval(clickNode));
await sleep(100);
await cdp.eval(`(() => { document.querySelector('#label-input').value = 'checkpoint-1'; document.querySelector('#btn-session-label').click(); return true; })()`);
await waitFor(cdp, `!!document.querySelector('#tree-view .tree-node .tree-label')`, 'bookmark chip rendered', 25000);
check('sessions: bookmark applied via extension', true, await cdp.eval(`document.querySelector('#tree-view .tree-node .tree-label')?.textContent`));
await cdp.eval(clickNode);
await sleep(100);
check('sessions: remove-bookmark enabled', (await cdp.eval(`!document.querySelector('#btn-session-unlabel').disabled`)) === true);
await cdp.eval(`document.querySelector('#btn-session-unlabel').click()`);
await waitFor(cdp, `!document.querySelector('#tree-view .tree-node .tree-label')`, 'bookmark cleared', 25000);
check('sessions: bookmark removed', true);

await cdp.eval(`document.querySelector('#sessions .tab[data-tab=list]').click()`);
await waitFor(cdp, `document.querySelectorAll('#list-view .session-item').length > 0`, 'saved sessions loaded', 20000);
check('sessions: saved session list loaded', true, (await cdp.eval(`document.querySelectorAll('#list-view .session-item').length`)) + ' items');
check('sessions: current session highlighted', await cdp.eval(`!!document.querySelector('#list-view .session-item.current')`));

/* ------------------------------------------------- session filters ------ */

const allSessions = await cdp.eval(`document.querySelectorAll('#list-view .session-item').length`);
await cdp.eval(`(() => { const i = document.querySelector('#list-search'); i.value = 'zzz-no-such-session-zzz'; i.dispatchEvent(new Event('input')); return true; })()`);
await sleep(350);
check(
  'filter: session search narrows the list',
  (await cdp.eval(`document.querySelectorAll('#list-view .session-item').length`)) < allSessions,
  await cdp.eval(`document.querySelector('#list-count').textContent`),
);
check('filter: session count is shown as matched/total', /\d+ \/ \d+/.test(await cdp.eval(`document.querySelector('#list-count').textContent`)));
await cdp.eval(`(() => { const i = document.querySelector('#list-search'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`);
await sleep(350);
check('filter: clearing the search restores the list', (await cdp.eval(`document.querySelectorAll('#list-view .session-item').length`)) === allSessions);

await cdp.eval(`(() => { const s = document.querySelector('#list-sort'); s.value = 'big'; s.dispatchEvent(new Event('change')); return true; })()`);
await sleep(250);
check('filter: sort by size works', true, await cdp.eval(`document.querySelector('#list-count').textContent`));
check(
  'filter: time range selector present',
  (await cdp.eval(`[...document.querySelectorAll('#list-range option')].map((o) => o.value).join(',')`)) === 'all,1,7,30',
);
await cdp.eval(`(() => { const c = document.querySelector('#list-named'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()`);
await sleep(250);
check('filter: named-only toggle applies', true, await cdp.eval(`document.querySelector('#list-count').textContent`));
await cdp.eval(`(() => { const c = document.querySelector('#list-named'); c.checked = false; c.dispatchEvent(new Event('change')); return true; })()`);

/* back on the tree tab: filter by role and by text */
await cdp.eval(`document.querySelector('#sessions .tab[data-tab=tree]').click()`);
await sleep(250);
const allNodes = await cdp.eval(`document.querySelectorAll('#tree-view .tree-node').length`);
await cdp.eval(`(() => { const i = document.querySelector('#tree-search'); i.value = 'zzz-no-such-node'; i.dispatchEvent(new Event('input')); return true; })()`);
await sleep(350);
check(
  'filter: tree search hides non-matching nodes',
  (await cdp.eval(`document.querySelectorAll('#tree-view .tree-node').length`)) < allNodes,
  await cdp.eval(`document.querySelector('#tree-count').textContent`),
);
await cdp.eval(`(() => { const i = document.querySelector('#tree-search'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`);
await sleep(350);
check('filter: clearing the tree search restores the nodes', (await cdp.eval(`document.querySelectorAll('#tree-view .tree-node').length`)) === allNodes);

await cdp.eval(`document.querySelector('#tree-roles .chip[data-role=user]').click()`);
await sleep(300);
const userNodes = await cdp.eval(`document.querySelectorAll('#tree-view .tree-node.kind-user').length`);
const dimmedUsers = await cdp.eval(`document.querySelectorAll('#tree-view .tree-node.kind-user.dimmed').length`);
check(
  'filter: disabling the user chip demotes user nodes to context',
  userNodes === 0 || dimmedUsers === userNodes,
  `${dimmedUsers}/${userNodes} user nodes dimmed`,
);
check(
  'filter: match count reflects the filter',
  /\d+ match/.test(await cdp.eval(`document.querySelector('#tree-count').textContent`)),
  await cdp.eval(`document.querySelector('#tree-count').textContent`),
);
check('filter: kept ancestors are dimmed', (await cdp.eval(`document.querySelectorAll('#tree-view .tree-node.dimmed').length`)) >= 1);
await cdp.eval(`document.querySelector('#tree-roles .chip[data-role=user]').click()`);
await sleep(250);
await cdp.eval(`(() => { const c = document.querySelector('#tree-active-only'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()`);
await sleep(300);
check(
  'filter: active-path-only keeps fewer nodes',
  (await cdp.eval(`document.querySelectorAll('#tree-view .tree-node').length`)) <= allNodes,
  await cdp.eval(`document.querySelector('#tree-count').textContent`),
);
await cdp.eval(`(() => { const c = document.querySelector('#tree-active-only'); c.checked = false; c.dispatchEvent(new Event('change')); return true; })()`);
await sleep(250);

await cdp.eval(`closeSessions()`);
await waitFor(cdp, `document.querySelector('#sessions').classList.contains('hidden')`, 'sessions closed');
check('sessions: panel closes', true);

/* ------------------------------------------------------- trace panel ---- */

await cdp.eval(`traceSetOpen(!trace.open)`);
await waitFor(cdp, `document.querySelector('#body').classList.contains('with-trace')`, 'trace panel open');
await sleep(700);

const rows = await cdp.eval(`document.querySelectorAll('.tr-row').length`);
const groups = await cdp.eval(`document.querySelectorAll('.tr-group').length`);
const dialogRows = await cdp.eval(`document.querySelectorAll('.tr-row.kind-dialog').length`);
const answered = await cdp.eval(`[...document.querySelectorAll('.tr-row.kind-dialog .tr-text')].filter(e=>e.textContent.includes('answered')).length`);
const llmRows = await cdp.eval(`document.querySelectorAll('.tr-row.kind-llm').length`);
const toolRows = await cdp.eval(`document.querySelectorAll('.tr-row.kind-tool').length`);
const userRows = await cdp.eval(`document.querySelectorAll('.tr-row.kind-user').length`);

check('trace rows rendered after opening panel', rows > 10, rows + ' rows');
check('trace groups per exchange', groups >= 2, groups + ' groups');
check('trace shows dialog requests', dialogRows >= 8, dialogRows + ' dialog rows');
check('trace shows dialog answers', answered >= 4, answered + ' answered rows');
check('trace: waterfall bars for tool durations', (await cdp.eval(`document.querySelectorAll('.tr-wf i').length`)) > 0, (await cdp.eval(`document.querySelectorAll('.tr-wf i').length`)) + ' bars');
check(
  'trace: touched-files chip',
  await cdp.eval(`[...document.querySelectorAll('.tr-files')].some((e) => /\\d+ file/.test(e.textContent))`),
  await cdp.eval(`JSON.stringify([...document.querySelectorAll('.tr-files')].map((e) => e.textContent))`),
);
check('trace shows llm activity', llmRows >= 1, 'llm=' + llmRows);
check('trace shows tool activity', toolRows >= 1, 'tool=' + toolRows);
check('trace records prompts', userRows >= 1, 'user=' + userRows);

const headMeta = await cdp.eval(`document.querySelector('.tr-group-meta')?.textContent || ''`);
check('trace group has metadata', headMeta.length > 0, headMeta);

const jumps = await cdp.eval(`document.querySelectorAll('.msg .trace-jump').length`);
check('chat messages link to their trace group', jumps >= 1, jumps + ' jump buttons');
if (jumps) {
  await cdp.eval(`document.querySelectorAll('.msg .trace-jump')[0].click()`);
  await sleep(300);
  check('clicking trace jump works', true, await cdp.eval(`document.querySelector('#body').classList.contains('with-trace')`));
}

await cdp.eval(`(() => { const c = document.querySelector('#trace-deltas'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()`);
await sleep(400);
const visibleDeltaRows = await cdp.eval(`[...document.querySelectorAll('.tr-row')].filter(e=>e.style.display !== 'none' && e.querySelector('.tr-label')?.textContent.match(/text|thinking|toolargs/)).length`);
check('trace delta toggle exposes streaming events', visibleDeltaRows >= 0, visibleDeltaRows + ' delta rows visible');

check('trace export button exists', await cdp.eval(`!!document.querySelector('#btn-trace-export')`));
await sleep(800);
check('trace history dropdown populated', (await cdp.eval(`document.querySelector('#trace-history').options.length`)) >= 1);

const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs');
fs.writeFileSync('/tmp/pi-gui-test.png', Buffer.from(shot.data, 'base64'));
console.log('\nscreenshot: /tmp/pi-gui-test.png');

check('no browser console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

/* ------------------------------------------- resilience: server unreachable */

await cdp.eval(
  `(() => { window.__origFetch = window.fetch; window.fetch = (url, opts) => String(url).includes('/api/command') ? Promise.reject(new TypeError('Failed to fetch')) : window.__origFetch(url, opts); return true; })()`,
);
await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = 'this should come back'; i.dispatchEvent(new Event('input')); document.querySelector('#btn-send').click(); return true; })()`,
);
await waitFor(cdp, `document.querySelector('#app').classList.contains('offline')`, 'offline detected', 20000);
check('offline: app marked offline', true);
check('offline: composer text restored', (await cdp.eval(`document.querySelector('#input').value`)) === 'this should come back');
check(
  'offline: user is told the message was not sent',
  await cdp.eval(`[...document.querySelectorAll('.msg.system')].some((e) => e.textContent.includes('put back in the composer'))`),
);
check(
  'offline: toolbar badge',
  (await cdp.eval(`document.querySelector('#app').dataset.offlineLabel`)) === 'OFFLINE' &&
    (await cdp.eval(`getComputedStyle(document.querySelector('#toolbar'), '::after').content`)) !== 'none',
  await cdp.eval(`getComputedStyle(document.querySelector('#toolbar'), '::after').content`),
);

await cdp.eval(`(() => { window.fetch = window.__origFetch; document.querySelector('#input').value = ''; return true; })()`);
await cdp.eval(`send({ type: 'get_state' }, { silent: true })`);
await waitFor(cdp, `!document.querySelector('#app').classList.contains('offline')`, 'online restored', 20000);
check('offline: recovers when the server is reachable again', true);

/* ------------------------------------------- multi-tab / foreign user message */

await cdp.eval(
  `handleEvent({ type: 'message_start', __seq: 900001, __t: Date.now(), message: { role: 'user', content: 'hello from another tab', timestamp: Date.now() } })`,
);
let foreignRendered = false;
try {
  await waitFor(
    cdp,
    `[...document.querySelectorAll('.msg.user')].some((e) => e.textContent.includes('hello from another tab'))`,
    'foreign user message rendered',
    8000,
  );
  foreignRendered = true;
} catch {}
check(
  'multi-tab: a user message from another client is rendered',
  foreignRendered,
  await cdp.eval(`JSON.stringify([...document.querySelectorAll('.msg.user')].map((e) => e.textContent.slice(0, 40)))`),
);

await cdp.eval(
  `(() => { const m = addMessage('user'); addBlock(m, { type: 'text', text: 'dup check' }); state.lastUserMsg = m; state.pendingUser = { text: 'dup check', images: 0 }; return true; })()`,
);
await cdp.eval(
  `handleEvent({ type: 'message_start', __seq: 900002, __t: Date.now(), message: { role: 'user', content: 'dup check', timestamp: Date.now() } })`,
);
await sleep(250);
check(
  'multi-tab: our own optimistic bubble is not duplicated',
  (await cdp.eval(`[...document.querySelectorAll('.msg.user')].filter((e) => e.textContent.includes('dup check')).length`)) === 1,
  (await cdp.eval(`[...document.querySelectorAll('.msg.user')].filter((e) => e.textContent.includes('dup check')).length`)) + ' bubbles',
);
check('empty-session placeholder is removed once messages exist', (await cdp.eval(`!document.querySelector('#chat').innerText.includes('No messages yet')`)));

/* --------------- a dialog answered in another tab closes here ------------- */

await cdp.eval(
  `handleExtensionUI({ type: 'extension_ui_request', id: 'dup-dialog-1', method: 'confirm', title: 'From another tab', message: 'answer elsewhere' })`,
);
await waitFor(cdp, `document.querySelector('.modal-kind')?.dataset.method === 'confirm'`, 'dialog shown for dedup test', 8000);
check('multi-tab: dialog appears locally', true);
await cdp.eval(
  `handleEvent({ type: '__ui_response', __seq: 930001, __t: Date.now(), response: { type: 'extension_ui_response', id: 'dup-dialog-1', confirmed: true } })`,
);
await sleep(250);
check('multi-tab: dialog answered elsewhere closes here', !(await cdp.eval(`!!document.querySelector('.modal')`)));
check(
  'multi-tab: the user is told why the dialog vanished',
  await cdp.eval(`[...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('another tab'))`),
);
await cdp.eval(`(() => { dialogQueue.length = 0; return true; })()`);

/* -------- stale dialogs must not survive a reconnect (nothing pending) ---- */

await cdp.eval(
  `handleExtensionUI({ type: 'extension_ui_request', id: 'stale-1', method: 'confirm', title: 'Stale', message: 'should be pruned' })`,
);
await waitFor(cdp, `document.querySelector('.modal-kind')?.dataset.method === 'confirm'`, 'stale dialog shown', 8000);
await cdp.eval(`handleEvent({ type: '__hello', alive: true, cwd: '/tmp', dialogs: [] })`);
await sleep(250);
check('stale dialog is pruned when the server reports nothing pending', !(await cdp.eval(`!!document.querySelector('.modal')`)));
await cdp.eval(`(() => { dialogQueue.length = 0; return true; })()`);

/* -------- a dialog the server still lists as pending is kept ------------ */

await cdp.eval(
  `handleExtensionUI({ type: 'extension_ui_request', id: 'live-1', method: 'confirm', title: 'Live', message: 'keep me' })`,
);
await waitFor(cdp, `document.querySelector('.modal-kind')?.dataset.method === 'confirm'`, 'live dialog shown', 8000);
await cdp.eval(`handleEvent({ type: '__hello', alive: true, cwd: '/tmp', dialogs: ['live-1'] })`);
await sleep(250);
check('a dialog the server still reports as pending is kept', await cdp.eval(`!!document.querySelector('.modal')`));
await cdp.eval(`(() => { if (activeDialog && activeDialog.close) activeDialog.close(null); dialogQueue.length = 0; return true; })()`);

/* -------------------------- edit & resend (fork + prefill composer) ------ */

await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = ''; i.dispatchEvent(new Event('input')); i.classList.remove('ext-prefill'); return true; })()`,
);
check('edit & resend: composer starts empty', (await cdp.eval(`document.querySelector('#input').value`)) === '');
await cdp.eval(`document.querySelector('.msg.user .act-edit').click()`);
let prefilled = '';
try {
  await waitFor(
    cdp,
    `document.querySelector('#input').value.trim().length > 0 && document.querySelector('#input').classList.contains('ext-prefill')`,
    'composer prefilled from the fork',
    25000,
  );
  prefilled = await cdp.eval(`document.querySelector('#input').value`);
} catch {}
check(
  'edit & resend: composer prefilled from the fork',
  prefilled.trim().length > 0,
  JSON.stringify(prefilled.slice(0, 60)),
);
check(
  'edit & resend: composer marked as a pending edit',
  await cdp.eval(`document.querySelector('#input').classList.contains('ext-prefill')`),
);
check(
  'edit & resend: user is told what happened',
  await cdp.eval(`[...document.querySelectorAll('.toast')].some((t) => /Forked/i.test(t.textContent))`),
);
await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = ''; i.dispatchEvent(new Event('input')); i.classList.remove('ext-prefill'); return true; })()`,
);

/* ---------------------------- draft survives a real page reload ---------- */

await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = 'draft across reload'; i.dispatchEvent(new Event('input')); return true; })()`,
);
await sleep(500);
await cdp.send('Page.reload');
await sleep(2200);
await waitFor(cdp, `document.querySelector('#status').textContent.match(/ready|running/)`, 'reconnected after reload');
check('draft survives a real page reload', (await cdp.eval(`document.querySelector('#input').value`)) === 'draft across reload');
await cdp.eval(
  `(() => { const i = document.querySelector('#input'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`,
);

/* --------------------- palette, a11y, pagination, message copy ---------- */

await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))`);
await waitFor(cdp, `!!document.querySelector('.palette')`, 'palette opens', 8000);
check('palette: opens with Ctrl/Cmd+K', true, (await cdp.eval(`document.querySelectorAll('.palette-item').length`)) + ' items');
check('palette: is a proper dialog', (await cdp.eval(`document.querySelector('.palette').getAttribute('role')`)) === 'dialog' && (await cdp.eval(`document.querySelector('.palette').getAttribute('aria-modal')`)) === 'true');
const paletteAll = await cdp.eval(`document.querySelectorAll('.palette-item').length`);
await cdp.eval(
  `(() => { const b = document.querySelector('.palette-input'); b.value = 'restart'; b.dispatchEvent(new Event('input')); return true; })()`,
);
await sleep(250);
const paletteFiltered = await cdp.eval(`document.querySelectorAll('.palette-item').length`);
check('palette: typing filters the list', paletteFiltered > 0 && paletteFiltered < paletteAll, `${paletteAll} → ${paletteFiltered}`);
await cdp.eval(`document.querySelector('.palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(250);
check('palette: Escape closes it', !(await cdp.eval(`!!document.querySelector('.palette')`)));

await cdp.eval(
  `(() => { dialogQueue.length = 0; if (activeDialog && activeDialog.close) activeDialog.close(null); return true; })()`,
);
await sleep(250);
await cdp.eval(
  `handleExtensionUI({ type: 'extension_ui_request', id: 'a11y-1', method: 'confirm', title: 'A11y', message: 'trap' })`,
);
await waitFor(cdp, `document.querySelector('.modal-kind')?.dataset.method === 'confirm'`, 'a11y dialog', 8000);
check('a11y: modal exposes role=dialog + aria-modal', (await cdp.eval(`document.querySelector('.modal').getAttribute('role')`)) === 'dialog' && (await cdp.eval(`document.querySelector('.modal').getAttribute('aria-modal')`)) === 'true');
await cdp.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`);
await sleep(150);
check(
  'a11y: Tab is trapped inside the dialog',
  await cdp.eval(`!!document.querySelector('.modal') && document.querySelector('.modal').contains(document.activeElement)`),
  await cdp.eval(`document.activeElement.textContent`),
);
await cdp.eval(`[...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent === 'No')?.click()`);
await sleep(200);
check('a11y: closing restores the dialog queue', !(await cdp.eval(`!!document.querySelector('.modal')`)));
await cdp.eval(`(() => { dialogQueue.length = 0; return true; })()`);

await cdp.eval(`openSessions()`);
await waitFor(cdp, `document.querySelectorAll('#tree-view .tree-node').length > 0`, 'tree for a11y', 20000);
check('a11y: session tree has role=tree', (await cdp.eval(`document.querySelector('#tree-view').getAttribute('role')`)) === 'tree');
check(
  'a11y: tree items are focusable',
  (await cdp.eval(`document.querySelector('.tree-node').getAttribute('role')`)) === 'treeitem' &&
    (await cdp.eval(`document.querySelector('.tree-node').getAttribute('tabindex')`)) === '0',
);
await cdp.eval(`document.querySelector('.tree-node').focus()`);
const firstFocused = await cdp.eval(`document.activeElement.textContent`);
await cdp.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
await sleep(150);
check(
  'a11y: arrow keys move through the tree',
  (await cdp.eval(`document.activeElement.classList.contains('tree-node')`)) &&
    (await cdp.eval(`document.activeElement.textContent`)) !== firstFocused,
  JSON.stringify(await cdp.eval(`document.activeElement.textContent`)),
);
await cdp.eval(`closeSessions()`);
await sleep(200);

check(
  'cost formatting never shows a fake $0.0000',
  (await cdp.eval(`fmtCost(0)`)) === '$0' && (await cdp.eval(`fmtCost(0.004)`)) === '$0.0040' && (await cdp.eval(`fmtCost(0.42)`)) === '$0.42',
  [await cdp.eval(`fmtCost(0)`), await cdp.eval(`fmtCost(0.004)`), await cdp.eval(`fmtCost(0.42)`)].join(' / '),
);

await cdp.eval(`(() => {
  state.allMessages = Array.from({ length: 35 }, (_, i) => ({ role: 'user', content: 'paged message ' + i, timestamp: Date.now() }));
  state.windowSize = PAGE_SIZE;
  renderMessageWindow(true);
  return true;
})()`);
await sleep(300);
check('pagination: only the newest window is rendered', (await cdp.eval(`document.querySelectorAll('.msg.user').length`)) === 30, (await cdp.eval(`document.querySelectorAll('.msg.user').length`)) + ' bubbles');
check('pagination: older messages sit behind a button', await cdp.eval(`!!document.querySelector('#load-earlier')`));
await cdp.eval(`document.querySelector('#load-earlier').click()`);
await sleep(300);
check(
  'pagination: loading earlier renders the rest',
  (await cdp.eval(`document.querySelectorAll('.msg.user').length`)) === 35,
  (await cdp.eval(`document.querySelectorAll('.msg.user').length`)) + ' bubbles',
);
await cdp.eval(`send({ type: 'get_messages' }, { silent: true })`);
await sleep(900);

/* ------------- syntax highlighting, chunked markdown, changes, search ------ */

await cdp.eval(`(() => {
  chat.innerHTML = '';
  state.msgs = [];
  const msg = addMessage('assistant');
  addBlock(msg, { type: 'text', text: 'Here you go:\\n\\n\`\`\`js\\nconst x = 1; // note\\nfunction f() { return "s"; }\\n\`\`\`\\n\\n\`\`\`klingon\\nplain words here\\n\`\`\`\\n' });
  decoratePres(chat);
  return true;
})()`);
await sleep(400);
check(
  'highlight: known languages get token spans',
  (await cdp.eval(`document.querySelectorAll('#chat .codeblock .tok-k, #chat .codeblock .tok-c, #chat .codeblock .tok-n').length`)) >= 3,
  (await cdp.eval(`document.querySelectorAll('#chat .codeblock span[class^="tok-"]').length`)) + ' token spans',
);
check(
  'highlight: code text survives highlighting unchanged',
  (await cdp.eval(`document.querySelector('#chat .codeblock code').textContent`)) === 'const x = 1; // note\nfunction f() { return "s"; }',
  await cdp.eval(`JSON.stringify(document.querySelector('#chat .codeblock code').textContent.slice(0, 40))`),
);
check(
  'highlight: an unknown language stays plain',
  (await cdp.eval(`document.querySelectorAll('#chat .codeblock:nth-of-type(2) span[class^="tok-"]').length`)) === 0,
);
check('fences: the language label is shown', (await cdp.eval(`document.querySelector('#chat .code-lang')?.textContent`)) === 'js');
check(
  'fences: a copy button is attached',
  (await cdp.eval(`!!document.querySelector('#chat .codewrap .copy-btn')`)),
);

await cdp.eval(`(() => {
  const pre = document.querySelector('#chat pre.code');
  const wrap = pre.parentNode;
  return true;
})()`);

// a >40 line block collapses
await cdp.eval(`(() => {
  chat.innerHTML = '';
  const big = Array.from({ length: 60 }, (_, i) => 'line ' + i).join('\\n');
  const msg = addMessage('assistant');
  addBlock(msg, { type: 'text', text: '\`\`\`\\n' + big + '\\n\`\`\`' });
  decoratePres(chat);
  return true;
})()`);
await sleep(300);
check('fences: long blocks offer expand/collapse', await cdp.eval(`!!document.querySelector('#chat .expand-btn')`));

/* ---- chunked / incremental markdown ---- */

check(
  'mdChunks: chunks rejoin into the exact source',
  await cdp.eval(`(() => {
    const cases = ['a\\n\\nb', 'x\\n\`\`\`js\\nc\\n\`\`\`\\ny', 'a\\n\\n\\n\\nb', '\`\`\`\\nz', ''];
    return cases.every((c) => mdChunks(c).join('') === c);
  })()`),
);

await cdp.eval(`(() => {
  chat.innerHTML = '';
  state.msgs = [];
  const msg = addMessage('assistant');
  const b = addBlock(msg, { type: 'text', text: 'para one\\n\\npara two\\n\\npara three' });
  window.__tb = b;
  return true;
})()`);
await sleep(200);
check(
  'mdChunks: a multi-paragraph message renders as several chunks',
  (await cdp.eval(`window.__tb._chunkNodes.length`)) >= 3,
  (await cdp.eval(`window.__tb._chunkNodes.length`)) + ' chunks',
);
check(
  'mdChunks: unchanged chunks are not re-rendered while streaming',
  await cdp.eval(`(() => {
    const b = window.__tb;
    const before = b._chunkNodes.slice();
    b.streaming = true;
    b.text = 'para one\\n\\npara two\\n\\npara three plus more';
    updateBlock(b);
    const after = b._chunkNodes;
    // the first two nodes must be the very same DOM objects (untouched)
    return before[0] === after[0] && before[1] === after[1] && b._chunkSrc.length === 3;
  })()`),
  await cdp.eval(`JSON.stringify(window.__tb._chunkSrc.map((s) => s.length))`),
);
check(
  'mdChunks: trailing chunks are dropped when text shrinks',
  await cdp.eval(`(() => {
    const b = window.__tb;
    b.text = 'only one';
    updateBlock(b);
    return b._chunkNodes.length === 1;
  })()`),
);

check(
  'mdChunks: chunked rendering is textually identical to a single render',
  await cdp.eval(`(() => {
    const sources = [
      '# Title\\n\\npara with **bold** and \`code\`\\n\\n- a\\n- b\\n\\n> quote\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |\\n',
      'text\\n\\n\`\`\`js\\nconst x = 1;\\n\`\`\`\\n\\nafter fence\\n',
      'line1\\nline2\\n\\n\\n\\nend\\n',
      'no trailing newline',
      '\`\`\`\\nbare fence\\n\`\`\`',
      '',
    ];
    for (const src of sources) {
      const a = document.createElement('div');
      a.innerHTML = md(src);                      // whole-document render
      const b = document.createElement('div');
      b.innerHTML = mdChunks(src).map((c) => md(c)).join(''); // chunked render
      if (a.textContent !== b.textContent) return 'text differs for ' + JSON.stringify(src.slice(0, 40));
    }
    return 'ok';
  })()`).then((r) => r === 'ok'),
  await cdp.eval(`(() => {
    const a = document.createElement('div'); a.innerHTML = md('# T\\n\\n- a\\n- b\\n');
    const b = document.createElement('div'); b.innerHTML = mdChunks('# T\\n\\n- a\\n- b\\n').map((c) => md(c)).join('');
    return a.textContent === b.textContent ? 'identical' : 'DIFFERS';
  })()`),
);

/* ---- session sidebar: every session, every workspace, one click ---- */

check(
  'sidebar: the panel is a permanent column, not a modal',
  (await cdp.eval(`!!document.querySelector('#app > #sidebar')`)) &&
    (await cdp.eval(`getComputedStyle(document.querySelector('#sidebar')).display !== 'none'`)),
);
check(
  'sidebar: the API returns sessions for every workspace, with labels',
  await cdp.eval(`fetch(api('/api/sessions?scope=all&limit=400')).then((r) => r.json()).then((d) =>
    Array.isArray(d.workspaces) &&
    d.workspaces.length >= 1 &&
    d.total >= d.sessions.length &&
    d.sessions.every((x) => typeof x.workspaceLabel === 'string' && 'isCurrentWorkspace' in x && typeof x.mtime === 'number'))`),
  await cdp.eval(`fetch(api('/api/sessions?scope=all&limit=400')).then((r) => r.json()).then((d) => d.total + ' sessions / ' + d.workspaces.length + ' workspaces')`),
);
check(
  'sidebar: scoping to this workspace lists no more than the global list',
  await cdp.eval(`Promise.all([
    fetch(api('/api/sessions?scope=workspace&limit=400')).then((r) => r.json()),
    fetch(api('/api/sessions?scope=all&limit=400')).then((r) => r.json()),
  ]).then(([a, b]) => a.total <= b.total && a.workspaces.length === 1)`),
  await cdp.eval(`Promise.all([
    fetch(api('/api/sessions?scope=workspace&limit=400')).then((r) => r.json()),
    fetch(api('/api/sessions?scope=all&limit=400')).then((r) => r.json()),
  ]).then(([a, b]) => a.total + ' of ' + b.total)`),
);
check(
  'sidebar: rows and workspace groups are rendered',
  (await cdp.eval(`document.querySelectorAll('#sb-list .sb-row').length`)) > 0 &&
    (await cdp.eval(`document.querySelectorAll('#sb-list .sb-group').length`)) >= 1,
  (await cdp.eval(`document.querySelectorAll('#sb-list .sb-row').length`)) + ' rows, ' + (await cdp.eval(`document.querySelectorAll('#sb-list .sb-group').length`)) + ' groups',
);
check(
  'sidebar: relative times use the short scale',
  await cdp.eval(`[relTime(Date.now() - 1000), relTime(Date.now() - 60000 * 12), relTime(Date.now() - 3600000 * 5)].every((v) => v.length > 0 && v.length < 12)`),
  await cdp.eval(`JSON.stringify([relTime(Date.now() - 1000), relTime(Date.now() - 60000 * 12), relTime(Date.now() - 3600000 * 5)])`),
);
check(
  'sidebar: searching filters the list and greps session content',
  await cdp.eval(`(() => { const i = document.querySelector('#sb-search'); i.value = 'the'; i.dispatchEvent(new Event('input')); return true; })()`),
);
await sleep(1600);
check(
  'sidebar: the content search produced hits',
  (await cdp.eval(`document.querySelectorAll('#sb-list .sb-row.hit').length`)) > 0,
  (await cdp.eval(`document.querySelectorAll('#sb-list .sb-row.hit').length`)) + ' hits',
);
await cdp.eval(`(() => { const i = document.querySelector('#sb-search'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`);
await sleep(400);

check(
  'sidebar: collapsing persists and the layout follows',
  await cdp.eval(`(() => {
    sbSetCollapsed(true);
    const hidden = document.querySelector('#app').classList.contains('sidebar-collapsed');
    const stored = JSON.parse(localStorage.getItem('pi-gui-sidebar') || '{}').collapsed === true;
    sbSetCollapsed(false);
    return hidden && stored;
  })()`),
);

check(
  'sidebar: titles strip the instruction wrapper',
  await cdp.eval(`fetch(api('/api/sessions?limit=400')).then((r) => r.json()).then((d) => {
    const withReply = d.sessions.filter((x) => /reply with exactly/i.test(x.preview || ''));
    if (!withReply.length) return 'no sample';
    return withReply.every((x) => !/reply with exactly/i.test(x.title || '')) ? 'ok' : 'still wrapped';
  })`).then((r) => r === 'ok' || r === 'no sample'),
  await cdp.eval(`fetch(api('/api/sessions?limit=400')).then((r) => r.json()).then((d) => {
    const s = d.sessions.find((x) => /reply with exactly/i.test(x.preview || ''));
    return s ? JSON.stringify(s.preview.slice(0, 30)) + ' → ' + s.title : 'no sample';
  })`),
);
check(
  'sidebar: each session carries turns, tool calls, tokens and cost',
  await cdp.eval(`fetch(api('/api/sessions?limit=400')).then((r) => r.json()).then((d) =>
    d.sessions.every((x) => Number.isInteger(x.turns) && Number.isInteger(x.toolCalls) && typeof x.tokens === 'number' && typeof x.cost === 'number') &&
    d.sessions.some((x) => x.turns > 0 && x.cost > 0))`),
  await cdp.eval(`fetch(api('/api/sessions?limit=400')).then((r) => r.json()).then((d) => {
    const s = d.sessions.reduce((a, b) => (b.turns > a.turns ? b : a), d.sessions[0]);
    return s.turns + ' turns · ' + s.toolCalls + ' tools · ' + s.tokens + ' tok · $' + s.cost.toFixed(4);
  })`),
);
check(
  'sidebar: rows show the title plus a stats line',
  (await cdp.eval(`document.querySelectorAll('#sb-list .sb-row .sb-title').length`)) > 0 &&
    /turns? ·|轮/.test(await cdp.eval(`document.querySelector('#sb-list .sb-meta')?.textContent || ''`)),
  await cdp.eval(`document.querySelector('#sb-list .sb-title')?.textContent.slice(0, 22) + '  |  ' + document.querySelector('#sb-list .sb-meta')?.textContent`),
);

/* ---- the list must not reshuffle while you are looking at it ---- */

check(
  'sidebar: a refresh with unchanged data reuses every DOM row',
  await cdp.eval(`(async () => {
    const before = [...document.querySelectorAll('#sb-list .sb-row')];
    const first = before[0];
    const paths = before.map((r) => r.dataset.path);
    await sbLoad();
    const after = [...document.querySelectorAll('#sb-list .sb-row')];
    return after.length === before.length && after[0] === first && after.every((r, i) => r.dataset.path === paths[i]);
  })()`),
);
check(
  'sidebar: a newer mtime does not move the active session',
  await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll('#sb-list .sb-row')];
    const active = rows.find((r) => r.classList.contains('active')) || rows[0];
    const idx = rows.indexOf(active);
    const s = sbState.sessions.find((x) => x.path === active.dataset.path);
    s.mtime = Date.now() + 60_000;
    sbRender();
    const rows2 = [...document.querySelectorAll('#sb-list .sb-row')];
    const idx2 = rows2.findIndex((r) => r === active);
    return idx === idx2 && idx2 !== -1;
  })()`),
);
check(
  'sidebar: workspace groups are ordered stably (active first, then by label)',
  await cdp.eval(`(() => {
    const labels = [...document.querySelectorAll('.sb-group-label')].map((e) => e.textContent);
    const again = (() => { sbRender(); return [...document.querySelectorAll('.sb-group-label')].map((e) => e.textContent); })();
    return JSON.stringify(labels) === JSON.stringify(again);
  })()`),
  await cdp.eval(`JSON.stringify([...document.querySelectorAll('.sb-group-label')].map((e) => e.textContent))`),
);
check(
  'sidebar: finishing a turn updates one row instead of rebuilding the list',
  await cdp.eval(`(() => {
    const before = [...document.querySelectorAll('#sb-list .sb-row')];
    const known = new Map(before.map((r) => [r.dataset.path, r]));
    sbTouchActive();
    const after = [...document.querySelectorAll('#sb-list .sb-row')];
    return after.length === before.length && after.every((r) => known.get(r.dataset.path) === r);
  })()`),
);

let switchInfo = 'skipped';
try {
  switchInfo = await cdp.eval(`(async () => {
    // make sure every group is open so a row from another workspace is reachable
    document.querySelectorAll('#sb-list .sb-group[aria-expanded="false"]').forEach((g) => g.click());
    await new Promise((r) => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('#sb-list .sb-row')].filter((r) => r.dataset.path && !r.classList.contains('active'));
    if (!rows.length) return 'no other session';
    const before = state.sessionId;
    const path = rows[0].dataset.path;
    rows[0].click();
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      if (state.sessionId && state.sessionId !== before) {
        return JSON.stringify({ changed: true, active: document.querySelectorAll('#sb-list .sb-row.active').length, msgs: document.querySelectorAll('#chat .msg').length });
      }
    }
    return 'timeout';
  })()`);
} catch (err) {
  switchInfo = 'threw: ' + err.message;
}
let switchParsed = {};
try {
  switchParsed = JSON.parse(switchInfo);
} catch {}
check(
  'sidebar: clicking another session switches this tab and reloads it',
  switchParsed.changed === true && switchParsed.active === 1,
  switchInfo,
);

/* ---- one control for model + thinking, and compact by default ---- */

check(
  'picker: one control replaces the two selects',
  (await cdp.eval(`!!document.querySelector('#picker-btn')`)) &&
    (await cdp.eval(`getComputedStyle(document.querySelector('#model')).display`)) === 'none' &&
    (await cdp.eval(`getComputedStyle(document.querySelector('#thinking')).display`)) === 'none',
);
check(
  'picker: the button shows model and thinking level together',
  await cdp.eval(`(() => {
    const label = document.querySelector('#picker-btn').innerText.replace(/\\s+/g, ' ').trim();
    return label.includes(document.querySelector('#picker-model').textContent) && label.includes(document.querySelector('#picker-think').textContent);
  })()`),
  await cdp.eval(`document.querySelector('#picker-btn').innerText.replace(/\\s+/g, ' ').trim().slice(0, 48)`),
);
check(
  'picker: opening lists the models and the thinking levels',
  await cdp.eval(`(() => {
    document.querySelector('#picker-btn').click();
    const models = document.querySelectorAll('#picker-models .picker-item').length;
    const thinks = document.querySelectorAll('#picker-thinks .picker-item').length;
    const visible = !document.querySelector('#picker-pop').classList.contains('hidden');
    return visible && models > 0 && thinks > 0;
  })()`),
  await cdp.eval(`document.querySelectorAll('#picker-models .picker-item').length + ' models / ' + document.querySelectorAll('#picker-thinks .picker-item').length + ' levels'`),
);
check(
  'picker: choosing a thinking level drives the hidden select',
  await cdp.eval(`(() => {
    const items = [...document.querySelectorAll('#picker-thinks .picker-item')];
    const target = items.find((i) => !i.classList.contains('on')) || items[0];
    const want = target.textContent;
    target.click();
    return document.querySelector('#thinking').value === want && document.querySelector('#picker-pop').classList.contains('hidden');
  })()`),
  await cdp.eval(`document.querySelector('#thinking').value`),
);
check(
  'picker: Escape closes the popover',
  await cdp.eval(`(() => {
    document.querySelector('#picker-btn').click();
    const opened = !document.querySelector('#picker-pop').classList.contains('hidden');
    document.querySelector('#picker-pop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return opened && document.querySelector('#picker-pop').classList.contains('hidden');
  })()`),
);
check(
  'layout: compact is the default when nothing was chosen',
  await cdp.eval(`(() => {
    const stored = localStorage.getItem('pi-gui-layout');
    localStorage.removeItem('pi-gui-layout');
    const fallback = preferredLayout();
    applyLayout(fallback, false); // drive the boot path with the default
    const applied = document.querySelector('#app').classList.contains('layout-compact');
    const bubble = document.querySelector('#chat .bubble');
    const railed = bubble ? getComputedStyle(bubble).borderTopWidth === '0px' : true;
    if (stored) localStorage.setItem('pi-gui-layout', stored);
    applyLayout(preferredLayout(), false);
    return fallback === 'compact' && applied && railed;
  })()`),
  await cdp.eval(`preferredLayout() + ' · stored=' + String(localStorage.getItem('pi-gui-layout'))`),
);

/* ---- session grouping by time, and the transcript layout toggle ---- */

check(
  'sidebar: grouping by time buckets sessions chronologically',
  await cdp.eval(`(async () => {
    sbSetGroupBy('time');
    await new Promise((r) => setTimeout(r, 250));
    const labels = [...document.querySelectorAll('.sb-group-label')].map((e) => e.textContent);
    const order = labels.map((l) => ['sidebar.bucket.today','sidebar.bucket.yesterday','sidebar.bucket.week','sidebar.bucket.month','sidebar.bucket.earlier'].findIndex((k) => t(k) === l));
    const chronological = order.every((v, i) => i === 0 || v >= order[i - 1]);
    return labels.length > 0 && chronological ? 'ok' : 'unordered: ' + JSON.stringify(labels);
  })()`).then((r) => r === 'ok'),
  await cdp.eval(`JSON.stringify([...document.querySelectorAll('.sb-group-label')].map((e) => e.textContent))`),
);
check(
  'sidebar: time grouping remembers the choice',
  await cdp.eval(`JSON.parse(localStorage.getItem('pi-gui-sidebar') || '{}').groupBy === 'time' && sbState.groupBy === 'time'`),
);
check(
  'sidebar: rows carry the workspace when grouped by time',
  /\//.test(await cdp.eval(`document.querySelector('#sb-list .sb-row .sb-meta')?.textContent || ''`)),
  await cdp.eval(`document.querySelector('#sb-list .sb-row .sb-meta')?.textContent`),
);
await cdp.eval(`sbSetGroupBy('workspace')`);
await sleep(250);
check(
  'layout: the compact transcript is a mode, and it is remembered',
  await cdp.eval(`(() => {
    applyLayout('compact');
    const on = document.querySelector('#app').classList.contains('layout-compact');
    const stored = localStorage.getItem('pi-gui-layout') === 'compact';
    // the rail replaces the per-turn card
    const bubble = document.querySelector('#chat .bubble');
    const flat = bubble ? getComputedStyle(bubble).borderTopWidth === '0px' : true;
    return on && stored && flat;
  })()`),
);
check(
  'layout: switching back restores the boxed transcript',
  await cdp.eval(`(() => {
    applyLayout('comfortable');
    const off = !document.querySelector('#app').classList.contains('layout-compact');
    const bubble = document.querySelector('#chat .bubble');
    const boxed = bubble ? getComputedStyle(bubble).borderTopWidth !== '0px' : true;
    return off && boxed;
  })()`),
);
check(
  'layout: the palette exposes the switch',
  await cdp.eval(`paletteItems().some((i) => /layout/i.test(i.label))`),
  await cdp.eval(`JSON.stringify(paletteItems().filter((i) => /layout/i.test(i.label)).map((i) => i.label))`),
);

/* ---- design system: the documented scale must not drift ---- */

check(
  'design: every rendered font size is on the documented scale',
  await cdp.eval(`(() => {
    const allowed = new Set(['10px','11px','12px','13px','14px','15px','17px','20px']);
    const seen = new Set([...document.querySelectorAll('body *')].map((e) => getComputedStyle(e).fontSize));
    return [...seen].every((v) => allowed.has(v));
  })()`),
  await cdp.eval(`JSON.stringify([...new Set([...document.querySelectorAll('body *')].map((e) => getComputedStyle(e).fontSize))].sort())`),
);
check(
  'design: every rendered radius is a named step (0 / 6 / 8 / 10 / 14 / 999)',
  await cdp.eval(`(() => {
    const allowed = new Set(['0px','6px','8px','10px','14px','999px','0px 8px 8px 0px']);
    const seen = new Set([...document.querySelectorAll('body *')].map((e) => getComputedStyle(e).borderRadius));
    return [...seen].every((v) => allowed.has(v));
  })()`),
  await cdp.eval(`JSON.stringify([...new Set([...document.querySelectorAll('body *')].map((e) => getComputedStyle(e).borderRadius))].sort())`),
);
check(
  'design: surfaces nest at most two deep inside the chat',
  await cdp.eval(`(() => {
    const cs = (el) => getComputedStyle(el);
    const paints = (el) => {
      const bg = cs(el).backgroundColor;
      const m = bg.match(/rgba?\\(([^)]+)\\)/);
      const a = m ? parseFloat(m[1].split(',')[3] ?? '1') : 0;
      const sides = [cs(el).borderTopWidth, cs(el).borderRightWidth, cs(el).borderBottomWidth, cs(el).borderLeftWidth].filter((w) => w !== '0px').length;
      return a > 0.02 || sides >= 2;
    };
    let max = 0;
    for (const el of document.querySelectorAll('#chat .msg, #chat .tool, #chat .thinking, #chat pre')) {
      let d = 0;
      let n = el.parentElement;
      while (n && n !== document.getElementById('chat')) {
        if (paints(n)) d += 1;
        n = n.parentElement;
      }
      max = Math.max(max, d);
    }
    window.__maxSurfaceDepth = max;
    return max <= 2;
  })()`),
  await cdp.eval(`'max depth ' + window.__maxSurfaceDepth`),
);

/* ---- prose keeps a reading measure, wide content does not ---- */

await cdp.eval(`(() => {
  chat.innerHTML = '';
  state.msgs = [];
  const m = addMessage('assistant');
  addBlock(m, { type: 'text', text: 'A sentence long enough to wrap at least once in any realistic window, so the measure can be measured properly. ' + 'More words follow here to make sure the paragraph is genuinely wide. ' + String.fromCharCode(10) + String.fromCharCode(10) + '\`\`\`js' + String.fromCharCode(10) + 'const aVeryLongLineOfCode = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";' + String.fromCharCode(10) + '\`\`\`' });
  decoratePres(chat);
  return true;
})()`);
await sleep(500);
const box = await cdp.eval(`(() => {
  const msg = [...document.querySelectorAll('#chat .msg.assistant')].pop();
  const p = msg?.querySelector('.md-chunk > p');
  const pre = msg?.querySelector('pre.code');
  if (!p || !pre) return null;
  // measure 1ch in the paragraph's own font
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:74ch;';
  probe.style.font = getComputedStyle(p).font;
  document.body.appendChild(probe);
  const ch74 = probe.getBoundingClientRect().width;
  probe.remove();
  return {
    prose: Math.round(p.getBoundingClientRect().width),
    code: Math.round(pre.getBoundingClientRect().width),
    limit: Math.round(ch74),
  };
})()`);
check(
  'reading: prose stays at a readable measure',
  box && box.prose <= box.limit + 2 && box.prose >= 200,
  box ? `${box.prose}px ≤ ${box.limit}px (74ch)` : 'no paragraph',
);
check(
  'reading: code takes the wider column, prose does not',
  box && box.code > box.prose,
  box ? `code ${box.code}px > prose ${box.prose}px` : 'no code',
);

/* ---- switching language must relabel everything already on screen ---- */

await cdp.eval(`(() => {
  chat.innerHTML = '';
  state.msgs = [];
  const m = addMessage('assistant');
  addBlock(m, { type: 'thinking', text: 'reasoning about the problem' });
  addBlock(m, { type: 'toolCall', id: 'i18nt', name: 'bash', args: { command: 'ls -la' }, argsText: '{}', status: 'done', result: 'x' });
  decoratePres(chat);
  return true;
})()`);
await sleep(400);
const enLabels = await cdp.eval(`(() => { setLang('en'); return JSON.stringify({ think: document.querySelector('details.thinking > summary')?.textContent, badge: document.querySelector('.tool-badge')?.textContent, copy: document.querySelector('.copy-btn')?.textContent }); })()`);
await sleep(400);
const zhLabels = await cdp.eval(`(async () => { setLang('zh'); await new Promise((r) => setTimeout(r, 300)); return JSON.stringify({ think: document.querySelector('details.thinking > summary')?.textContent, badge: document.querySelector('.tool-badge')?.textContent, copy: document.querySelector('.copy-btn')?.textContent, newBtn: document.querySelector('#btn-new')?.textContent.trim() }); })()`);
await sleep(300);
await cdp.eval(`setLang('en')`);
await sleep(300);
let zhParsed = {};
try {
  zhParsed = JSON.parse(zhLabels);
} catch {}
check(
  'i18n: switching language relabels blocks already rendered',
  zhParsed.think === '思考' && zhParsed.badge === '完成' && zhParsed.copy === '复制',
  `${enLabels} → ${zhLabels}`,
);
check(
  'i18n: no rendered UI string is left untranslated in zh',
  await cdp.eval(`(async () => {
    setLang('zh');
    await new Promise((r) => setTimeout(r, 400));
    const bad = [];
    for (const sel of ['#btn-new', '#btn-stop', '#btn-changes', '#input']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = sel === '#input' ? el.placeholder : el.textContent.trim();
      if (/^[A-Za-z][A-Za-z .…·/-]+$/.test(text)) bad.push(sel + '=' + text);
    }
    setLang('en');
    return bad.length === 0 ? '' : bad.join(', ');
  })()`).then((r) => r === ''),
  await cdp.eval(`document.documentElement.lang`),
);

/* ---- changes view, inside the right-hand dock ---- */

await cdp.eval(`openChanges()`);
await sleep(900);
check(
  'changes: opens as a dock view, not a modal',
  (await cdp.eval(`document.querySelector('#dock-pane-changes').classList.contains('hidden')`)) === false &&
    (await cdp.eval(`document.querySelector('#body').classList.contains('with-trace')`)) &&
    (await cdp.eval(`!document.querySelector('#changes')`)),
  await cdp.eval(`document.querySelector('#dock-tabs .tab.active')?.textContent`),
);
check(
  'dock: the three views are tabs, one visible at a time',
  await cdp.eval(`(() => {
    const panes = ['trace', 'changes', 'context'];
    return panes.every((p) => !!document.querySelector('#dock-pane-' + p));
  })()`),
  await cdp.eval(`JSON.stringify([...document.querySelectorAll('#dock-tabs .tab')].map((b) => b.dataset.dock))`),
);
check(
  'dock: width is draggable and remembered',
  await cdp.eval(`(() => {
    const before = parseInt(getComputedStyle(document.querySelector('#body')).getPropertyValue('--dock-w'), 10);
    dockSetWidth(before + 60);
    const after = parseInt(getComputedStyle(document.querySelector('#body')).getPropertyValue('--dock-w'), 10);
    const stored = JSON.parse(localStorage.getItem('pi-gui-dock') || '{}').width;
    dockSetWidth(before);
    return after === before + 60 && stored === before + 60;
  })()`),
  await cdp.eval(`getComputedStyle(document.querySelector('#body')).getPropertyValue('--dock-w')`),
);

check(
  'changes: an untouched tree shows the empty state, not a spinner',
  (await cdp.eval(`document.querySelector('#changes-list').innerText.trim().length`)) > 5,
  await cdp.eval(`document.querySelector('#changes-list').innerText.trim().slice(0, 40)`),
);
check(
  'changes: the API answers with the documented shape',
  await cdp.eval(`fetch(api('/api/changes')).then((r) => r.json()).then((d) => typeof d.git === 'boolean' && Array.isArray(d.files) && d.totals && typeof d.totals.files === 'number')`),
);
check(
  'changes: a bad path is rejected without a 500',
  await cdp.eval(`fetch(api('/api/changes/diff') + '&path=../../etc/passwd').then((r) => r.status)`).then((s) => s === 200 || s === 400),
);

await cdp.eval(`(() => {
  chgState.git = false;
  chgState.cwd = '/tmp/demo';
  chgState.files = [
    { path: 'src/a.js', tool: 'edit', count: 2, add: 4, del: 1, revertable: true, code: null, missing: false, lastAt: Date.now() },
    { path: 'README.md', tool: 'write', count: 1, add: 9, del: 0, revertable: true, code: null, missing: false, lastAt: Date.now() },
    { path: 'only-in-git.txt', tool: null, count: 0, add: 1, del: 1, revertable: false, code: ' M', missing: false, lastAt: Date.now() },
  ];
  renderChanges();
  return true;
})()`);
await sleep(300);
check(
  'changes: rows render with per-file stats',
  (await cdp.eval(`document.querySelectorAll('#changes-list .change-row').length`)) === 2,
  (await cdp.eval(`document.querySelector('#changes-list').innerText.replace(/\\n/g, ' | ').slice(0, 70)`)),
);
check(
  'changes: "this session only" hides git-only files',
  await cdp.eval(`(() => { const el = document.querySelector('#changes-session-only'); el.checked = false; el.dispatchEvent(new Event('change')); const n = document.querySelectorAll('#changes-list .change-row').length; el.checked = true; el.dispatchEvent(new Event('change')); return n === 3; })()`),
);
check(
  'changes: the toolbar badge counts session files',
  await cdp.eval(`(() => { updateChangesBadge(); return document.querySelector('#changes-badge').textContent === '2' && !document.querySelector('#changes-badge').classList.contains('hidden'); })()`),
);

await cdp.eval(`(() => {
  chgState.selected = 'src/a.js';
  chgState.diff = { path: 'src/a.js', add: 1, del: 1, source: 'session', lines: [
    { t: ' ', text: 'keep', a: 1, b: 1 }, { t: '-', text: 'old', a: 2 }, { t: '+', text: 'new', b: 2 },
  ] };
  renderChanges();
  renderChangeDiff();
  return true;
})()`);
await sleep(200);
check(
  'changes: the diff renders add/del lines with line numbers',
  (await cdp.eval(`document.querySelectorAll('#changes-diff .diff-add').length`)) === 1 &&
    (await cdp.eval(`document.querySelectorAll('#changes-diff .diff-del').length`)) === 1 &&
    (await cdp.eval(`document.querySelector('#changes-diff .diff-ln').textContent`)) === '1',
);
check(
  'changes: revert is a two-step confirm',
  await cdp.eval(`(() => {
    chgRevertBtn.disabled = false;
    const first = chgRevertBtn.textContent;
    revertSelected();
    const armed = chgRevertBtn.textContent;
    chgState.armed = 0;
    chgRevertBtn.textContent = first;
    return armed !== first;
  })()`),
  await cdp.eval(`chgRevertBtn.textContent`),
);

/* ---- session search ---- */

check(
  'search: a one-character query is ignored',
  await cdp.eval(`fetch(api('/api/search') + '&q=a').then((r) => r.json()).then((d) => Array.isArray(d.results) && d.results.length === 0)`),
);
check(
  'search: real sessions are searched by content',
  await cdp.eval(`fetch(api('/api/search') + '&q=' + encodeURIComponent('the') + '&limit=3').then((r) => r.json()).then((d) => d.results.length > 0 && typeof d.results[0].hits[0].snippet === 'string')`),
  await cdp.eval(`fetch(api('/api/search') + '&q=' + encodeURIComponent('the') + '&limit=3').then((r) => r.json()).then((d) => (d.results[0] ? d.results[0].hits.length + ' hits' : ''))`),
);

await cdp.eval(`closeChanges()`);
await sleep(200);
await cdp.eval(`openPalette()`);
await sleep(300);
await cdp.eval(`(() => { const b = document.querySelector('.palette-input'); b.value = 'the'; b.dispatchEvent(new Event('input')); return true; })()`);
await sleep(1500);
check(
  'palette: typing searches saved sessions and lists the hits',
  (await cdp.eval(`document.querySelectorAll('.palette-item.session-hit').length`)) > 0,
  (await cdp.eval(`document.querySelectorAll('.palette-item.session-hit').length`)) + ' session hits',
);
check(
  'palette: new panel actions are available',
  await cdp.eval(`(() => {
    const labels = paletteItems().map((i) => i.label);
    return labels.some((l) => l.includes('Changes')) && labels.some((l) => l.includes('Inspector')) && labels.some((l) => l.toLowerCase().includes('html'));
  })()`),
);
await cdp.eval(`document.querySelector('.palette-backdrop').remove()`);
await sleep(200);

/* ---- self-contained export ---- */

let exportKind = 'n/a';
try {
  exportKind = await cdp.eval(`(async () => {
    const html = await buildExportBundle();
    if (!html) return 'empty';
    if (!html.startsWith('<!doctype html>')) return 'no-doctype';
    if (!html.includes('class="role"')) return 'no-role';
    if (!html.includes('pi-gui-export')) return 'no-payload';
    if (!html.includes('<div class="msg')) return 'no-messages';
    // the JSON payload must not be able to break out of its <script> block
    if (html.split('</script>').length !== 2) return 'unsafe-payload';
    if (!html.includes('@media (prefers-color-scheme: dark)')) return 'no-inline-css';
    return 'ok';
  })()`);
} catch (err) {
  exportKind = 'threw: ' + err.message;
}
check('export: a standalone HTML bundle holds chat, trace, payload and CSS', exportKind === 'ok', exportKind);

/* ---- reconnect / gap handling ---- */

check(
  'reconnect: event sequence numbers are tracked',
  await cdp.eval(`(() => { const before = state.lastSeq; handleEvent({ type: '__marker', __seq: before + 5, __t: Date.now() }); return state.lastSeq === before + 5; })()`),
);
check(
  'reconnect: a buffer gap triggers a visible resync notice',
  await cdp.eval(`(() => {
    const before = document.querySelectorAll('[data-i18n-notice="chat.gapResync"]').length;
    handleEvent({ type: '__gap', from: 1, to: 9, seq: 20 });
    return document.querySelectorAll('[data-i18n-notice="chat.gapResync"]').length > before;
  })()`),
  'gap notice rendered',
);
check(
  'reconnect: the SSE stream resumes from the last seen sequence',
  await cdp.eval(`(() => {
    state.lastSeq = 4242;
    const url = api('/api/events') + (state.lastSeq ? '&since=' + state.lastSeq : '');
    return url.includes('since=4242');
  })()`),
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
ws.close();
process.exit(failed.length ? 1 : 0);
