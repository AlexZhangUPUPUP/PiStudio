'use strict';
/* Debug board for the agent-task runtime (served at /tasks).
 * Deliberately plain DOM + polling — the real Mission Control UI lives in src/. */

const TOKEN = new URLSearchParams(location.search).get('token') || '';
const withToken = (u) => (TOKEN ? u + (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN) : u);

async function apiGet(u) {
  const r = await fetch(withToken(u));
  return r.json();
}
async function apiPost(u, body) {
  const r = await fetch(withToken(u), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

const $ = (sel) => document.querySelector(sel);
const mk = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k && k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};

const state = { current: null, timer: null, cols: new Map(), agentSeq: 0 };

/* ------------------------------------------------------------- launcher */

function agentRow() {
  state.agentSeq += 1;
  const i = state.agentSeq;
  const name = mk('input', { className: 'name', placeholder: 'name', value: 'agent ' + i });
  const model = mk('input', { className: 'model', placeholder: 'model (optional)' });
  const prompt = mk('textarea', { className: 'prompt', rows: 2, placeholder: i === 1 ? 'task for this agent…' : 'same task (optional)' });
  const rm = mk('button', { className: 'x', textContent: '×', title: 'remove' });
  rm.onclick = () => row.remove();
  const row = mk('div', { className: 'row' }, name, model, mk('div', { className: 'pwrap' }, prompt), rm);
  return row;
}

/* --------------------------------------------------------------- board */

function ensureCol(agent) {
  let c = state.cols.get(agent.id);
  if (c) return c;
  const head = mk('div', { className: 'head' });
  const body = mk('div', { className: 'body' });
  const input = mk('input', { placeholder: 'follow-up prompt…' });
  const send = mk('button', { textContent: 'send' });
  const foot = mk('div', { className: 'foot' }, input, send);
  const col = mk('div', { className: 'col' }, head, body, foot);
  const doSend = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await apiPost(`/api/tasks/${state.current}/agents/${agent.id}/command`, { type: 'prompt', message: text });
  };
  send.onclick = doSend;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  c = { col, head, body, input };
  state.cols.set(agent.id, c);
  $('#board').append(col);
  return c;
}

function fmtUsage(u) {
  if (!u) return '';
  const inp = u.input || 0;
  const out = u.output || 0;
  let cost = u.cost;
  if (cost && typeof cost === 'object') cost = cost.total;
  const parts = [];
  if (inp || out) parts.push(`↑${inp} ↓${out}`);
  if (typeof cost === 'number') parts.push('$' + cost.toFixed(4));
  return parts.join(' · ');
}

function toolSummary(events) {
  const counts = new Map();
  for (const rec of events || []) {
    const e = rec.evt;
    if (e && e.type === 'tool_execution_start' && e.toolName) {
      counts.set(e.toolName, (counts.get(e.toolName) || 0) + 1);
    }
  }
  return [...counts].map(([k, v]) => `${k}×${v}`).join(' · ');
}

function render(task) {
  $('#status').textContent = `task ${task.id} · ${task.status} · ${task.cwd}`;
  for (const a of task.agents) {
    const c = ensureCol(a);
    c.head.textContent = '';
    c.head.append(
      mk('div', {}, mk('span', { className: 'name', textContent: a.name }), ' ', mk('span', { className: `pill ${a.status}`, textContent: a.status })),
      mk('div', { className: 'meta', textContent: [a.model || 'default model', a.pid ? 'pid ' + a.pid : '', fmtUsage(a.usage)].filter(Boolean).join(' · ') }),
      mk('div', { className: 'meta', textContent: toolSummary(a.events) || '' }),
    );
    const atBottom = c.body.scrollHeight - c.body.scrollTop - c.body.clientHeight < 30;
    c.body.textContent = '';
    if (a.thinking) c.body.append(mk('div', { className: 'think', textContent: '💭 ' + a.thinking }));
    const text = a.text || (a.status === 'running' ? '…' : a.status === 'error' ? 'failed to start' : '');
    if (text) c.body.append(document.createTextNode(text));
    if (!c.body.childNodes.length) c.body.append(mk('div', { className: 'empty', textContent: '(no output yet)' }));
    if (atBottom) c.body.scrollTop = c.body.scrollHeight;
    c.input.disabled = ['done', 'failed', 'error', 'stopped'].includes(a.status);
  }
}

async function poll() {
  if (!state.current) return;
  try {
    const { task } = await apiGet(`/api/tasks/${state.current}`);
    if (task) render(task);
  } catch {}
}

function select(id) {
  state.current = id;
  state.cols.clear();
  $('#board').textContent = '';
  poll();
  if (!state.timer) state.timer = setInterval(poll, 1000);
}

async function loadRecent() {
  try {
    const { tasks } = await apiGet('/api/tasks');
    if (!tasks || !tasks.length) return;
    $('#recent').hidden = false;
    const list = $('#tasklist');
    list.textContent = '';
    for (const t of tasks) {
      const label = `${t.label || t.id} · ${t.status} · ${t.agents.length} agents`;
      const a = mk('a', { href: '#', textContent: label });
      a.onclick = (e) => {
        e.preventDefault();
        select(t.id);
      };
      list.append(a);
    }
  } catch {}
}

/* ---------------------------------------------------------------- boot */

$('#add').onclick = () => $('#rows').append(agentRow());
$('#rows').append(agentRow(), agentRow());

$('#launch').onclick = async () => {
  const rows = [...document.querySelectorAll('#rows .row')];
  const agents = [];
  for (const row of rows) {
    const name = row.querySelector('input.name').value.trim();
    const model = row.querySelector('input.model').value.trim();
    const prompt = row.querySelector('textarea.prompt').value.trim();
    const spec = {};
    if (name) spec.name = name;
    if (model) spec.model = model;
    if (prompt) spec.prompt = prompt;
    if (Object.keys(spec).length) agents.push(spec);
  }
  if (!agents.length) {
    $('#status').textContent = 'add at least one agent with a prompt';
    return;
  }
  // every agent without its own prompt inherits the first one
  const shared = agents.find((a) => a.prompt)?.prompt;
  for (const a of agents) if (!a.prompt && shared) a.prompt = shared;

  $('#status').textContent = 'launching…';
  const { task, error } = await apiPost('/api/tasks', { agents });
  if (error) {
    $('#status').textContent = 'error: ' + error;
    return;
  }
  loadRecent();
  select(task.id);
};

loadRecent();
