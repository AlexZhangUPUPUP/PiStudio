#!/usr/bin/env node
/**
 * Regenerate the README screenshots from the *React* UI.
 *
 * The old generator (`legacy/dev/make-screenshots.mjs`) drove the retired
 * vanilla frontend through globals (`handleEvent`, `traceSetOpen`, …) that the
 * React app no longer exposes. This one drives the real React UI the same way
 * `dev/react-smoke.mjs` does: a throwaway `server.js` + headless Chrome over
 * CDP, real DOM interaction, plus the app's `pi-gui:*` window events.
 *
 *   node dev/make-screenshots.mjs                 # self-contained (recommended)
 *   node dev/make-screenshots.mjs --keep          # leave server/chrome running
 *   node dev/make-screenshots.mjs --no-chat       # skip the real prompt (empty UI)
 *
 * The chat/trace/tool shots need a working `pi` with a configured model — that
 * is what makes them show real content. Set CHROME_BIN if Chrome is elsewhere.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dev') + path.sep
const SCRATCH = path.join(ROOT, 'dev', '.shot-scratch.txt')

const argv = process.argv.slice(2)
const hasFlag = (n) => argv.includes(n)
const KEEP = hasFlag('--keep')
const CHAT = !hasFlag('--no-chat')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

/* -------------------------------------------------------------- process mgmt */

const cleanups = []
function cleanup() {
  for (const fn of cleanups.splice(0).reverse()) {
    try {
      fn()
    } catch {}
  }
  try {
    rmSync(SCRATCH, { force: true })
  } catch {}
}
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

function findChrome() {
  return [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p))
}

async function fetchJson(url, timeout = 1500) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    return await (await fetch(url, { signal: ctrl.signal })).json()
  } finally {
    clearTimeout(t)
  }
}

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

async function startServer() {
  // Load the demo extension so we can capture a real extension dialog.
  const child = spawn(
    process.execPath,
    ['server.js', '--port', '0', '--cwd', ROOT, '--', '-e', './dev/dialogs-demo.ts'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stderr.on('data', (c) => process.stderr.write(c))
  cleanups.push(() => child.kill('SIGTERM'))
  return new Promise((resolve, reject) => {
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
}

async function startChrome(port) {
  const bin = findChrome()
  if (!bin) throw new Error('no Chrome/Chromium found (set CHROME_BIN)')
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-gui-shots-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const child = spawn(
    bin,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
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
      await fetchJson(`http://127.0.0.1:${port}/json/version`)
      return
    } catch {}
    await sleep(400)
  }
  throw new Error('Chrome did not expose a debugging port')
}

/* --------------------------------------------------------------------- CDP */

async function connect(port) {
  const list = await fetchJson(`http://127.0.0.1:${port}/json/list`)
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  cleanups.push(() => ws.close())
  let id = 0
  const pend = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m.result)
      pend.delete(m.id)
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error')
    return r.result?.value
  }
  return { send, ev }
}

/* ------------------------------------------------------------------ helpers */

let shotCount = 0
const missed = []

async function main() {
  const port = await freePort()
  log('• starting pi server…')
  const url = await startServer()
  log('• page:', url)
  await startChrome(port)
  const { send, ev } = await connect(port)

  async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(OUT + name, Buffer.from(r.data, 'base64'))
    shotCount++
    log('  ✓', name)
  }
  async function attempt(label, fn) {
    try {
      await fn()
    } catch (err) {
      missed.push(`${label}: ${err?.message || err}`)
      log('  ✗', label, '—', err?.message || err)
    }
  }
  async function waitFor(expr, label, timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try {
        if (await ev(expr)) return true
      } catch {}
      await sleep(150)
    }
    throw new Error('timeout: ' + label)
  }
  const open = (name) =>
    ev(`window.dispatchEvent(new CustomEvent(${JSON.stringify(name)})), true`)
  const escape = async () => {
    await ev(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
    )
    await sleep(300)
  }
  const closeDock = async () => {
    await ev(
      `(()=>{const d=document.querySelector('[aria-label="Dock"]');` +
        `const b=[...d.querySelectorAll('button')].find(x=>x.querySelector('svg')?.classList.contains('lucide-x'));` +
        `b?.click();return true})()`,
    )
    await sleep(400)
  }
  async function setTheme(mode) {
    await ev(
      `window.dispatchEvent(new CustomEvent('pi-gui:set-theme',{detail:{mode:${JSON.stringify(mode)}}}))`,
    )
    await sleep(450)
  }
  async function setLang(target) {
    for (let i = 0; i < 5; i++) {
      if ((await ev(`localStorage.getItem('pi-gui-lang')`)) === target) return
      await ev(
        `(()=>{const b=[...document.querySelectorAll('header button')].find(b=>/^(中|EN)$/.test((b.textContent||'').trim()));b?.click();return true})()`,
      )
      await sleep(400)
    }
  }
  const TYPE = (text) => `(() => {
    const el = document.querySelector('textarea');
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return true;
  })()`
  const ENTER = `(()=>{const el=document.querySelector('textarea');el?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return true})()`
  const clickText = (text) =>
    ev(
      `(()=>{const els=[...document.querySelectorAll('button,a,[role="tab"],[role="option"],li')];` +
        `const el=els.find(e=>(e.textContent||'').trim()===${JSON.stringify(text)});if(el){el.click();return true}return false})()`,
    )

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 950,
    deviceScaleFactor: 2,
    mobile: false,
  })
  // English + a defined theme so nothing leaks from a previous profile.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('pi-gui-lang','en');localStorage.setItem('pi-gui-theme','light')}catch{}`,
  })
  await send('Page.navigate', { url })
  await waitFor(`!!document.querySelector('textarea')`, 'app boot')
  await sleep(2500)
  await setTheme('light')

  /* ------------------------------------------------- seed real content ---- */
  if (CHAT) {
    log('• running a real prompt…')
    await ev(
      TYPE(
        'Use a bash command to list the 5 largest files in this folder, read package.json, ' +
          'then write a new file dev/.shot-scratch.txt containing exactly three lines: ' +
          'alpha, beta, gamma. Finally, summarize this project in one short sentence.',
      ),
    )
    await sleep(200)
    await ev(ENTER)
    await attempt('shot-running', async () => {
      await waitFor(`!document.querySelector('svg.lucide-arrow-up')`, 'run started', 30000)
      await sleep(400)
      await shot('shot-running.png')
    })
    await waitFor(`!!document.querySelector('svg.lucide-arrow-up')`, 'run settled', 180000)
    await sleep(600)
  }

  await attempt('chat-light', async () => {
    await setTheme('light')
    await ev(`document.querySelector('.pi-main')?.scrollTo(0,0)`)
    await sleep(300)
    await shot('shot-chat-light.png')
  })

  await attempt('tool-renderers', async () => {
    // scroll the newest tool card into view so it is the focus of the frame
    await ev(`(()=>{const m=document.querySelector('.pi-main');const cards=[...document.querySelectorAll('[class*="rounded"][class*="border"]')].filter(e=>/lucide-(terminal|file-text|file-pen|search|git)/.test(e.querySelector('svg')?.getAttribute('class')||''));const c=cards[cards.length-1]||cards[0];c?.scrollIntoView({block:'center'});return true})()`)
    await sleep(500)
    await shot('shot-tool-renderers.png')
  })

  /* ------------------------------------------------- dark chat + trace ---- */
  await attempt('chat-dark', async () => {
    await setTheme('dark')
    await sleep(500)
    await shot('shot-chat-dark.png')
  })
  await attempt('trace-dark', async () => {
    await open('pi-gui:open-trace')
    await sleep(900)
    await shot('shot-trace-dark.png')
  })
  await attempt('trace-light', async () => {
    await setTheme('light')
    await sleep(700)
    await shot('shot-trace-light.png')
  })
  await closeDock()

  /* ---------------------------------------------------------- sessions ---- */
  await attempt('sessions', async () => {
    await open('pi-gui:open-sessions')
    await waitFor(`document.querySelectorAll('[class*="tree"], [role="tree"]').length>0`, 'tree', 8000)
    await sleep(600)
    await shot('shot-sessions-light.png')
    await clickText('Saved') // best-effort: switch to the saved-session list tab
    await sleep(700)
    await shot('shot-session-list.png')
  })
  await escape()

  /* ----------------------------------------------------------- settings -- */
  await attempt('settings', async () => {
    await open('pi-gui:open-settings')
    await sleep(700)
    await shot('shot-settings.png')
  })
  await escape()

  /* ------------------------------------------------------------ palette -- */
  await attempt('palette', async () => {
    await ev(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true,cancelable:true}))`,
    )
    await sleep(600)
    await shot('shot-palette.png')
  })
  await attempt('diagnostics', async () => {
    if (await clickText('Diagnostics')) {
      await sleep(900)
      await shot('shot-diagnostics.png')
    } else throw new Error('no Diagnostics palette item')
  })
  await escape()

  /* -------------------------------------------------- inspector (context) - */
  await attempt('inspector', async () => {
    await open('pi-gui:open-context')
    await sleep(1400)
    await shot('shot-context.png')
    await shot('shot-inspect-prompt.png')
    for (const [tab, name] of [
      ['Context', 'shot-inspect-context.png'],
      ['Requests', 'shot-inspect-requests.png'],
      ['Capabilities', 'shot-inspect-caps.png'],
    ]) {
      if (await clickText(tab)) {
        await sleep(700)
        await shot(name)
      }
    }
  })

  /* ------------------------------------------------------------ changes -- */
  await attempt('changes', async () => {
    await open('pi-gui:open-changes')
    await sleep(900)
    await shot('shot-changes.png')
  })

  /* ------------------------------------------------------- completion UI - */
  await attempt('autocomplete', async () => {
    await ev(TYPE('look at @src/'))
    await sleep(1000)
    await shot('shot-autocomplete.png')
  })
  await attempt('commands', async () => {
    await ev(TYPE('/'))
    await sleep(900)
    await shot('shot-commands.png')
  })
  await ev(TYPE(''))
  await escape()

  /* --------------------------------------------------------- attachments - */
  await attempt('attachments', async () => {
    await ev(`(async () => {
      const c=document.createElement('canvas');c.width=320;c.height=180;
      const x=c.getContext('2d');const g=x.createLinearGradient(0,0,320,180);
      g.addColorStop(0,'#0969da');g.addColorStop(1,'#8250df');
      x.fillStyle=g;x.fillRect(0,0,320,180);x.fillStyle='#fff';x.font='28px sans-serif';
      x.fillText('screenshot.png',24,100);
      const blob=await new Promise(r=>c.toBlob(r,'image/png'));
      const input=document.querySelector('input[type=file]');
      const dt=new DataTransfer();dt.items.add(new File([blob],'screenshot.png',{type:'image/png'}));
      input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
      return true})()`)
    await sleep(900)
    await shot('shot-attachments-light.png')
  })

  /* -------------------------------------------------------------- dialog - */
  await attempt('dialog', async () => {
    await ev(TYPE('/dialogtest'))
    await sleep(800) // let the command autocomplete open
    await ev(ENTER) // 1st Enter accepts the highlighted command
    await sleep(300)
    await ev(ENTER) // 2nd Enter sends it
    await waitFor(`!!document.querySelector('.fixed.inset-0')`, 'extension dialog', 30000)
    await sleep(500)
    await shot('shot-dialog-light.png')
  })
  await escape()
  await sleep(600)
  await escape()

  /* ------------------------------------------------------------ tasks ---- */
  await attempt('tasks', async () => {
    // close any leftover modal (the /dialogtest step may have left one open)
    await ev(
      `(()=>{document.querySelectorAll('[role="dialog"]').forEach(d=>{const b=[...d.querySelectorAll('button')].find(x=>/cancel|close/i.test(x.textContent||'')||x.querySelector('svg.lucide-x'));b?.click()});return true})()`,
    )
    await escape()
    await open('pi-gui:open-tasks')
    await waitFor(`!!document.querySelector('[aria-label="Agent tasks"] textarea')`, 'tasks modal', 8000)
    await sleep(300)
    await ev(
      `(()=>{const el=document.querySelector('[aria-label="Agent tasks"] textarea');` +
        `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'In one short sentence: what is this project?');` +
        `el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    )
    await ev(
      `(()=>{const ins=[...document.querySelectorAll('[aria-label="Agent tasks"] input')];const m=ins[3];if(!m)return false;` +
        `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(m,'deepseek/deepseek-v4-pro');` +
        `m.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    )
    await sleep(200)
    await ev(
      `(()=>{const b=[...document.querySelectorAll('[aria-label="Agent tasks"] button')].find(b=>/Launch/.test(b.textContent||''));b?.click();return !!b})()`,
    )
    await sleep(2000)
    {
      const t0 = Date.now()
      let settled = false
      while (Date.now() - t0 < 90000) {
        const s = String(await ev(`document.querySelector('[aria-label="Agent tasks"]')?.innerText || ''`))
        if (!/running|starting/.test(s) && /idle|done|failed|stopped/.test(s)) {
          settled = true
          break
        }
        // slow model still running? capture anyway once there is real content
        if (Date.now() - t0 > 50000 && /\$\d/.test(s)) break
        await sleep(1000)
      }
      log('  · tasks settled=' + settled)
    }
    await sleep(1200)
    await shot('shot-tasks.png')
    // clean up the task's worktrees + branches so repeated runs don't leak them
    await ev(
      `(async()=>{const j=await fetch('/api/tasks').then(r=>r.json());const t=(j.tasks||[])[0];if(!t)return false;` +
        `await fetch('/api/tasks/'+t.id+'/cleanup',{method:'POST'}).catch(()=>{});` +
        `await fetch('/api/tasks/'+t.id,{method:'DELETE'}).catch(()=>{});return true})()`,
    )
  })
  await escape()
  await sleep(600)

  /* ------------------------------------------------------------- usage ---- */
  await attempt('usage', async () => {
    await escape()
    await open('pi-gui:open-usage')
    await waitFor(`!!document.querySelector('[aria-label="Usage & spend"]')`, 'usage modal', 8000)
    await sleep(1400)
    await shot('shot-usage.png')
  })
  await escape()
  await sleep(400)

  /* ------------------------------------------------------------- 中文 UI - */
  await attempt('zh', async () => {
    await closeDock()
    await setTheme('light')
    await setLang('zh')
    await sleep(600)
    await shot('shot-zh-chat.png')
    await open('pi-gui:open-sessions')
    await sleep(900)
    await shot('shot-zh-sessions.png')
    await escape()
    await open('pi-gui:open-trace')
    await sleep(900)
    await shot('shot-zh-trace.png')
    await setLang('en')
  })

  log(`\n• wrote ${shotCount} screenshots to dev/`)
  if (missed.length) {
    log(`• ${missed.length} skipped:`)
    for (const m of missed) log('   -', m)
  }
  if (!KEEP) cleanup()
  process.exit(missed.length ? 1 : 0)
}

main().catch((err) => {
  console.error('fatal:', err?.stack || err)
  cleanup()
  process.exit(1)
})
