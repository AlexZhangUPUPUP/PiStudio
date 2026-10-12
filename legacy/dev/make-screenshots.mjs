/**
 * Regenerates the README screenshots by driving the real UI in headless Chrome.
 *
 * Prereqs (same as cdp-test.mjs):
 *   node server.js --cwd . -- -e ./dev/dialogs-demo.ts &      # :4173
 *   ".../Google Chrome" --headless=new --remote-debugging-port=9222 \
 *       --user-data-dir=/tmp/pi-gui-chrome about:blank &
 *
 *   node dev/make-screenshots.mjs
 */
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/';
const PORT = process.argv[3] || '9222';
const OUT = new URL('./', import.meta.url).pathname;
const fs = await import('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m.result);
    pend.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result?.value;
};
async function waitFor(expr, label, timeout = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await ev(expr)) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('timeout: ' + label);
}
// Every group below sets the language explicitly: a persisted choice from a
// previous run must never leak into a screenshot (that is how an "English"
// shot ended up in Chinese).
const setLang = (l) => ev(`setLang('${l}')`);

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + name, Buffer.from(r.data, 'base64'));
  console.log('  wrote', name);
}
async function setTheme(mode) {
  await ev(`applyTheme(${JSON.stringify(mode)})`);
  await sleep(200);
}
async function setInput(text) {
  await ev(
    `(() => { const i = document.querySelector('#input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); return true; })()`,
  );
}

await send('Page.enable');
await send('Runtime.enable');
// README shots are English; the Chinese variants are captured at the end
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('pi-gui-lang', 'en'); } catch {}`,
});
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: PAGE_URL });
await sleep(2500);
await waitFor(`document.querySelector('#status')?.textContent.match(/ready|running/)`, 'connected');

/* a real exchange; if the model declines to call a tool, inject the tool
   lifecycle so the screenshots always show a tool card */
await setInput('List the three largest files in this folder and then write one sentence about what this project is.');
await ev(`document.querySelector('#btn-send').click()`);
try {
  await waitFor(`document.querySelector('#run-state').classList.contains('on')`, 'run state visible', 15000);
  await sleep(300);
  await shot('shot-running.png');
} catch {}
await waitFor(`document.querySelector('#btn-stop').disabled === true`, 'exchange settled', 180000);
await sleep(400);
if (!(await ev(`document.querySelectorAll('.tool-badge').length > 0`))) {
  await ev(`(() => {
    const now = Date.now();
    handleEvent({ type: 'message_start', __seq: 920001, __t: now, message: { role: 'assistant', content: [], timestamp: now } });
    handleEvent({ type: 'message_update', __seq: 920002, __t: now, assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, id: 'call_shot', toolName: 'bash' } });
    handleEvent({ type: 'message_update', __seq: 920003, __t: now, assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: { id: 'call_shot', name: 'bash', arguments: { command: 'ls -lS | head -4' } } } });
    handleEvent({ type: 'tool_execution_start', __seq: 920004, __t: now, toolCallId: 'call_shot', toolName: 'bash', args: { command: 'ls -lS | head -4' } });
    handleEvent({ type: 'tool_execution_end', __seq: 920005, __t: now, toolCallId: 'call_shot', toolName: 'bash', result: { content: [{ type: 'text', text: '-rw-r--r--  1 alex staff  9389 README.md  |  -rw-r--r--  1 alex staff  4286 package-lock.json  |  drwxr-xr-x 17 alex staff  544 public' }] }, isError: false });
    handleEvent({ type: 'message_end', __seq: 920006, __t: now, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call_shot', name: 'bash', arguments: { command: 'ls -lS | head -4' } }], stopReason: 'toolUse', timestamp: now } });
    return true;
  })()`);
  await sleep(400);
}

/* always showcase a diff card */
await ev(`(() => {
  const NL = String.fromCharCode(10);
  const now = Date.now();
  handleEvent({ type: 'message_start', __seq: 921001, __t: now, message: { role: 'assistant', content: [], timestamp: now } });
  handleEvent({ type: 'message_update', __seq: 921002, __t: now, assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: { id: 'shot_edit', name: 'edit', arguments: { path: 'public/app.js' } } } });
  handleEvent({ type: 'tool_execution_start', __seq: 921003, __t: now, toolCallId: 'shot_edit', toolName: 'edit', args: { path: 'public/app.js' } });
  handleEvent({ type: 'tool_execution_end', __seq: 921004, __t: now, toolCallId: 'shot_edit', toolName: 'edit',
    result: { content: [{ type: 'text', text: 'ok' }], details: { diff: [
      '@@ -112,6 +112,9 @@',
      '   const state = {',
      '     msgs: [],',
      '+    commands: [],',
      '+    attachments: [],',
      '   };',
      ' ',
      '-  function send(cmd) {',
      '+  function send(cmd, opts = {}) {'
    ].join(NL) } }, isError: false });
  handleEvent({ type: 'message_end', __seq: 921005, __t: now, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'shot_edit', name: 'edit', arguments: { path: 'public/app.js' } }], stopReason: 'toolUse', timestamp: now } });
  return true;
})()`);
await sleep(500);

/* showcase the per-tool renderers: grep grouping, read gutter, write diff */
await ev(`(() => {
  const NL = String.fromCharCode(10);
  const now = Date.now();
  handleEvent({ type: 'message_start', __seq: 922001, __t: now, message: { role: 'assistant', content: [], timestamp: now } });
  const tool = (id, name, args, text, seq) => {
    handleEvent({ type: 'message_update', __seq: seq, __t: now, assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: { id, name, arguments: args } } });
    handleEvent({ type: 'tool_execution_start', __seq: seq + 1, __t: now, toolCallId: id, toolName: name, args });
    handleEvent({ type: 'tool_execution_end', __seq: seq + 2, __t: now, toolCallId: id, toolName: name, result: { content: [{ type: 'text', text }] }, isError: false });
  };
  tool('shot_grep', 'grep', { pattern: 'i18n', path: 'public' }, ['public/app.js:172:  // i18n helpers', 'public/app.js:1180:  applyI18n();', 'public/index.html:64:    <script src="/i18n.js"></script>'].join(NL), 922010);
  tool('shot_read', 'read', { path: 'public/i18n.js', offset: 1, limit: 3 }, ['/* pi GUI — translations */', 'window.PI_I18N = {', '  en: {'].join(NL), 922020);
  tool('shot_write', 'write', { path: 'notes/new-file.txt', content: ['first line', 'second line', 'third line'].join(NL) }, 'wrote notes/new-file.txt', 922030);
  handleEvent({ type: 'message_end', __seq: 922040, __t: now, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'shot_grep', name: 'grep', arguments: {} }], stopReason: 'toolUse', timestamp: now } });
  return true;
})()`);
await sleep(600);
await shot('shot-tool-renderers.png');

await setTheme('light');
await sleep(500);
await shot('shot-chat-light.png');

await ev(`traceSetOpen(!trace.open)`);
await sleep(600);
await shot('shot-trace-light.png');
await ev(`traceSetOpen(!trace.open)`);
await sleep(300);

/* sessions panel + bookmark */
await ev(`openSessions()`);
await waitFor(`document.querySelectorAll('#tree-view .tree-node').length > 0`, 'tree');
await sleep(400);
const assistantId = await ev(`document.querySelector('#tree-view .tree-node.kind-assistant')?.dataset.id`);
if (assistantId) {
  await ev(
    `(() => { const n = [...document.querySelectorAll('#tree-view .tree-node')].find(e => e.dataset.id === ${JSON.stringify(assistantId)}); if (n) n.click(); return true; })()`,
  );
  await ev(`(() => { document.querySelector('#label-input').value = 'first answer'; document.querySelector('#btn-session-label').click(); return true; })()`);
  await sleep(1500);
}
await shot('shot-sessions-light.png');
await ev(`document.querySelector('#sessions .tab[data-tab=list]').click()`);
await sleep(1200);
await shot('shot-session-list.png');
await ev(`closeSessions()`);
await sleep(300);

/* attachments tray */
await ev(`(async () => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 320, 180); g.addColorStop(0, '#0969da'); g.addColorStop(1, '#8250df');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.fillText('screenshot.png', 24, 100);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await addImageFiles([new File([blob], 'screenshot.png', { type: 'image/png' })]);
  return true;
})()`);
await sleep(500);
await shot('shot-attachments-light.png');
await ev(`(() => { state.attachments = []; renderAttachments(); return true; })()`);

/* autocomplete popups */
await setInput('look at @public/');
await sleep(900);
await shot('shot-autocomplete.png');
await ev(`(() => { const i = document.querySelector('#input'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`);
await sleep(200);
await setInput('/');
await sleep(700);
await shot('shot-commands.png');
await ev(`(() => { const i = document.querySelector('#input'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`);
await sleep(200);

/* diagnostics panel */
await ev(`openDiagnostics()`);
await sleep(800);
await shot('shot-diagnostics.png');
await ev(`[...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent === 'Close')?.click()`);
await sleep(250);

/* settings modal */
await ev(`openSettings()`);
await sleep(600);
await shot('shot-settings.png');
await ev(`closeSettings()`);
await sleep(300);

/* command palette */
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))`);
await waitFor(`!!document.querySelector('.palette')`, 'palette');
await sleep(450);
await shot('shot-palette.png');
await ev(`document.querySelector('.palette-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(300);

/* inspector: the harness X-ray */
await ev(`openInspect()`);
await waitFor(`!document.querySelector('#inspect').classList.contains('hidden')`, 'inspector');
await sleep(1200);
await shot('shot-inspect-prompt.png');
for (const [tab, name] of [
  ['context', 'shot-inspect-context.png'],
  ['requests', 'shot-inspect-requests.png'],
  ['caps', 'shot-inspect-caps.png'],
]) {
  await ev(`document.querySelector('#inspect-tabs .tab[data-itab="${tab}"]').click()`);
  await sleep(500);
  await shot(name);
}
await ev(`closeInspect()`);
await sleep(300);

/* changes panel: diff review + revert (synthetic rows so the shot is stable) */
await ev(`openChanges()`);
await waitFor(`!document.querySelector('#dock-pane-changes').classList.contains('hidden')`, 'changes dock view');
await sleep(700);
await ev(`(() => {
  chgState.git = false;
  chgState.cwd = '~/project';
  chgState.files = [
    { path: 'src/server/session.ts', tool: 'edit', count: 3, add: 18, del: 6, revertable: true, code: null, missing: false, lastAt: Date.now() },
    { path: 'src/gui/panel.tsx', tool: 'edit', count: 1, add: 42, del: 11, revertable: true, code: null, missing: false, lastAt: Date.now() },
    { path: 'docs/notes.md', tool: 'write', count: 1, add: 9, del: 0, revertable: true, code: null, missing: false, lastAt: Date.now() },
  ];
  renderChanges();
  updateChangesBadge();
  chgState.selected = 'src/gui/panel.tsx';
  chgState.diff = { path: 'src/gui/panel.tsx', add: 3, del: 2, source: 'session', lines: [
    { t: ' ', text: 'export function Panel({ items }: Props) {', a: 12, b: 12 },
    { t: ' ', text: '  const [open, setOpen] = useState(false);', a: 13, b: 13 },
    { t: '-', text: '  const rows = items.map(toRow);', a: 14 },
    { t: '+', text: '  const rows = useMemo(() => items.map(toRow), [items]);', b: 14 },
    { t: '+', text: '  const total = rows.length;', b: 15 },
    { t: ' ', text: '  return <Table rows={rows} />;', a: 15, b: 16 },
    { t: '-', text: '}', a: 16 },
    { t: '+', text: '}', b: 17 },
  ] };
  renderChanges();
  renderChangeDiff();
  return true;
})()`);
await sleep(600);
await shot('shot-changes.png');
await ev(`dockSetTab('context')`);
await sleep(500);
await shot('shot-context.png');
await ev(`dockClose()`);
await sleep(300);

/* dialog */
await setInput('/dialogtest');
await ev(`document.querySelector('#btn-send').click()`);
await waitFor(`document.querySelector('.modal-kind')?.dataset.method === 'select'`, 'select dialog', 30000);
await sleep(400);
await shot('shot-dialog-light.png');
await ev(`document.querySelector('.modal-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await ev(`document.querySelector('#modal-root .modal-backdrop')?.click()`);
await sleep(300);
await ev(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Cancel')?.click()`);
await sleep(600);
await ev(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Cancel')?.click()`);
await sleep(600);

/* dark variants */
await setTheme('dark');
await sleep(600);
await ev(`traceSetOpen(!trace.open)`);
await sleep(600);
await shot('shot-trace-dark.png');
await ev(`traceSetOpen(!trace.open)`);
await sleep(300);
await shot('shot-chat-dark.png');

/* ---------------------------------------------------------- chinese UI --- */

await setTheme('light');
await sleep(400);
// explicit, not a toggle: a persisted language from an earlier run used to leak
await setLang('zh');
await sleep(600);
await shot('shot-zh-chat.png');
await ev(`openSessions()`);
await waitFor(`document.querySelectorAll('#tree-view .tree-node').length > 0`, 'zh tree');
await sleep(500);
await shot('shot-zh-sessions.png');
await ev(`closeSessions()`);
await sleep(300);
await ev(`traceSetOpen(!trace.open)`);
await sleep(600);
await shot('shot-zh-trace.png');
await setLang('en');
await sleep(300);

console.log('done');
process.exit(0);
