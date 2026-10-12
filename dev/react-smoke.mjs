#!/usr/bin/env node
/**
 * End-to-end smoke test for the React pi-gui.
 *
 * By default it is fully self-contained: it starts its own `pi` server on a
 * free port, launches headless Chrome, drives the real UI over CDP, and tears
 * everything down. Point it at an existing instance instead with --url.
 *
 *   node dev/react-smoke.mjs                 # self-contained (recommended)
 *   node dev/react-smoke.mjs --no-chat       # skip the real prompt round-trip
 *   node dev/react-smoke.mjs --url http://127.0.0.1:4173/ --port 9222
 *   CHROME_BIN=/path/to/chrome node dev/react-smoke.mjs
 *
 * Exit code is 0 only when every check passes, so it doubles as a CI gate.
 *
 * Selectors are language-agnostic on purpose: the UI is bilingual (en/zh) and
 * assertions keyed on copy broke the previous suite when the language flipped.
 * We instead key on structure, ARIA and lucide icon class names.
 */
import { spawn } from 'node:child_process'
import { existsSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const hasFlag = (name) => argv.includes(name)

const CHAT = !hasFlag('--no-chat')
const KEEP = hasFlag('--keep')
const ATTACH = hasFlag('--attach')
const DEBUG_PORT_ENV = arg('--port', process.env.CDP_PORT || '')
let DEBUG_PORT = Number(DEBUG_PORT_ENV) || 0
let PAGE_URL = arg('--url', '')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

/* ---------------------------------------------------------------- helpers */

async function freePort() {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) || null
}

async function fetchJson(url, timeout = 1500) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

/* ------------------------------------------------------------------- setup */

const cleanups = []
function cleanup() {
  for (const fn of cleanups.splice(0).reverse()) {
    try {
      fn()
    } catch {}
  }
}

async function startServer() {
  // `--port 0` lets the server pick a free port and report it back.
  const child = spawn(process.execPath, ['server.js', '--port', '0', '--cwd', ROOT], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  cleanups.push(() => child.kill('SIGTERM'))
  const url = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('server did not start within 20s')), 20000)
    child.stdout.on('data', (c) => {
      buf += c.toString('utf8')
      const line = buf.split('\n').find((l) => l.startsWith('__PI_GUI_READY__ '))
      if (line) {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(line.slice('__PI_GUI_READY__ '.length)).url)
        } catch (e) {
          reject(e)
        }
      }
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`server exited early (code=${code})`))
    })
  })
  return url
}

async function startChrome() {
  const bin = findChrome()
  if (!bin) throw new Error('no Chrome/Chromium found (set CHROME_BIN)')
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-gui-smoke-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const child = spawn(
    bin,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  cleanups.push(() => child.kill('SIGKILL'))
  for (let i = 0; i < 60; i++) {
    try {
      await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      return
    } catch {}
    await sleep(400)
  }
  throw new Error('Chrome did not expose a debugging port')
}

/* --------------------------------------------------------------------- CDP */

async function connect() {
  const list = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true })
    ws.addEventListener('error', j, { once: true })
  })
  cleanups.push(() => ws.close())

  let id = 0
  const pend = new Map()
  const errors = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m.result)
      pend.delete(m.id)
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || 'exception')
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
  })
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id
      pend.set(i, res)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || 'eval error')
    return r.result?.value
  }
  return { send, ev, errors }
}

/* ------------------------------------------------------------------- suite */

const results = []
const pass = (name) => results.push({ name, ok: true })
const fail = (name, detail = '') => results.push({ name, ok: false, detail })
const check = (name, ok, detail = '') => (ok ? pass(name) : fail(name, detail))

async function waitFor(ev, expr, label, timeout = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try {
      if (await ev(expr)) return true
    } catch {}
    await sleep(150)
  }
  fail(label, `timeout after ${timeout}ms`)
  return false
}

/** Type into the composer the way React expects (native setter + input event). */
const TYPE = (text) => `(() => {
  const el = document.querySelector('textarea');
  if (!el) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`

const PRESS_ENTER = `(() => {
  const el = document.querySelector('textarea');
  if (!el) return false;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return true;
})()`

async function run() {
  const { send, ev, errors } = await connect()
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await send('Page.navigate', { url: PAGE_URL })

  if (!(await waitFor(ev, `!!document.querySelector('textarea')`, 'app boot'))) return
  await sleep(2000) // let the SSE connect and pi settle

  /* ---- shell ---- */
  check('shell: React root + sidebar + main', await ev(
    `!!document.querySelector('.pi-root') && !!document.querySelector('aside') && !!document.querySelector('.pi-main')`,
  ))
  check('shell: composer textarea', await ev(`!!document.querySelector('textarea')`))
  check('shell: model picker', await ev(
    `!!document.querySelector('header button[aria-haspopup="listbox"]')`,
  ))
  check('shell: status bar', await ev(`!!document.querySelector('.pi-statusbar')`))
  check('shell: cwd shown', await ev(
    `(document.querySelector('header')?.innerText || '').includes('/')`,
  ))

  const isElectron = await ev(`navigator.userAgent.includes('Electron')`)
  if (isElectron) {
    check('desktop: is-electron class', await ev(
      `document.documentElement.classList.contains('is-electron')`,
    ))
    check('desktop: toolbar is draggable', await ev(
      `getComputedStyle(document.querySelector('.pi-toolbar')).getPropertyValue('-webkit-app-region').trim() === 'drag'`,
    ))
    check('desktop: desktop bridge present', await ev(`!!window.piDesktop?.setTheme`))
  }

  /* ---- theme toggle ---- */
  const themeBefore = await ev(`localStorage.getItem('pi-gui-theme')`)
  await ev(`[...document.querySelectorAll('header button')].find(b=>/lucide-(sun|moon)/.test(b.querySelector('svg')?.getAttribute('class')||''))?.click()`)
  await sleep(400)
  const themeAfter = await ev(`localStorage.getItem('pi-gui-theme')`)
  check('theme: toolbar toggles light/dark', themeBefore !== themeAfter, `${themeBefore} -> ${themeAfter}`)
  check('theme: html class matches', await ev(
    `(()=>{const dark=localStorage.getItem('pi-gui-theme')==='dark';return document.documentElement.classList.contains('dark')===dark})()`,
  ))
  check('theme: content column painted', await ev(
    `getComputedStyle(document.querySelector('.pi-main')).backgroundColor !== 'rgba(0, 0, 0, 0)' || getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'`,
  ))

  /* ---- layout ---- */
  await ev(`window.dispatchEvent(new CustomEvent('pi-gui:set-layout',{detail:{layout:'compact'}}))`)
  await sleep(250)
  check('layout: persists compact', (await ev(`localStorage.getItem('pi-gui-layout')`)) === 'compact')

  /* ---- sidebar ---- */
  check('sidebar: renders groups/rows', await ev(
    `document.querySelectorAll('aside button').length > 3`,
  ))
  check('sidebar: group-by toggle', await ev(
    `!!document.querySelector('aside [role="group"] button[aria-pressed]')`,
  ))

  /* ---- command palette ---- */
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}))`)
  const paletteOpen = await waitFor(
    ev,
    `!!document.querySelector('.fixed.inset-0')`,
    'palette opens (⌘K)',
    4000,
  )
  if (paletteOpen) pass('palette: opens via ⌘K')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  await sleep(300)

  /* ---- modals via window events (language-agnostic hooks) ---- */
  const modalOpen = async (event, label) => {
    await ev(`window.dispatchEvent(new CustomEvent(${JSON.stringify(event)}))`)
    const ok = await waitFor(ev, `!!document.querySelector('.fixed.inset-0')`, label, 4000)
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await sleep(300)
    return ok
  }
  if (await modalOpen('pi-gui:open-sessions', 'sessions modal opens')) pass('sessions: modal opens')
  if (await modalOpen('pi-gui:open-settings', 'settings modal opens')) pass('settings: modal opens')

  /* ---- dock ---- */
  for (const [event, tab] of [
    ['pi-gui:open-trace', 'trace'],
    ['pi-gui:open-changes', 'changes'],
    ['pi-gui:open-context', 'context'],
  ]) {
    await ev(`window.dispatchEvent(new CustomEvent(${JSON.stringify(event)}))`)
    const ok = await waitFor(
      ev,
      `(()=>{const d=[...document.querySelectorAll('aside')].pop();return d && d.offsetWidth>200 && d.querySelectorAll('button').length>2})()`,
      `dock ${tab}`,
      4000,
    )
    if (ok) pass(`dock: ${tab} tab renders`)
  }
  check('dock: trace ingested events', await ev(
    `(()=>{const d=[...document.querySelectorAll('aside')].pop();return (d?.innerText||'').length>40})()`,
  ))

  /* ---- autocomplete (@) ---- */
  await ev(TYPE('@serv'))
  const acOpen = await waitFor(
    ev,
    `[...document.querySelectorAll('div')].some(d=>{const s=d.innerText||'';return s.includes('server.js')||s.includes('src/')})`,
    '@ autocomplete',
    5000,
  )
  if (acOpen) pass('autocomplete: @ lists files')
  await ev(TYPE(''))
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)

  /* ---- live prompt round-trip (optional) ---- */
  if (CHAT) {
    const before = await ev(`document.querySelectorAll('.pi-main [class*="whitespace-pre-wrap"], .pi-main .text-sm').length`)
    await ev(TYPE('Reply with exactly the single word: PONG.'))
    await sleep(150)
    await ev(PRESS_ENTER)
    const started = await waitFor(
      ev,
      `!document.querySelector('svg.lucide-arrow-up')`,
      'streaming started',
      30000,
    )
    const settled = started
      ? await waitFor(
          ev,
          `!!document.querySelector('svg.lucide-arrow-up')`,
          'streaming settled',
          120000,
        )
      : false
    if (started) pass('chat: prompt starts the run')
    if (settled) pass('chat: run settles (send button returns)')
    const after = await ev(`document.querySelectorAll('.pi-main [class*="whitespace-pre-wrap"], .pi-main .text-sm').length`)
    check('chat: transcript grew', after > before, `${before} -> ${after}`)
  }

  /* ---- console hygiene ---- */
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  /* ---- screenshot on failure ---- */
  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      const fs = await import('node:fs')
      fs.writeFileSync('dev/smoke-failure.png', Buffer.from(shot.data, 'base64'))
      log('  (wrote dev/smoke-failure.png)')
    } catch {}
  }
}

/* -------------------------------------------------------------------- main */

async function main() {
  if (!DEBUG_PORT) DEBUG_PORT = await freePort()
  if (!PAGE_URL) {
    log('• starting pi server…')
    PAGE_URL = await startServer()
  }
  log('• page:', PAGE_URL)
  if (ATTACH) {
    if (!DEBUG_PORT) throw new Error('--attach needs --port <cdp-port>')
    log('• attaching to existing debugger on', DEBUG_PORT)
  } else {
    log('• launching headless Chrome…')
    await startChrome()
  }
  log('• running checks…\n')

  try {
    await run()
  } catch (err) {
    fail('suite crashed', String(err && err.message ? err.message : err))
  }

  for (const r of results) log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  const failed = results.filter((r) => !r.ok)
  log(`\n${results.length - failed.length}/${results.length} passed`)
  return failed.length === 0 ? 0 : 1
}

let code = 1
try {
  code = await main()
} catch (err) {
  console.error('fatal:', err && err.message ? err.message : err)
} finally {
  if (!KEEP) cleanup()
}
process.exit(code)
