/**
 * Conversation export helpers, ported from public/app.js.
 *
 * `exportMessagesHtml` / `buildHtmlBundle` produce the same standalone
 * self-contained HTML file the legacy UI wrote, and `conversationMarkdown`
 * mirrors the legacy `.md` export. Raw messages (not the rendered ChatItem[]
 * tree) are required, so callers should fetch them with `fetchRawMessages`
 * using the store's `command` + `onResponse` bridge.
 */
import { apiUrl, extractText, type RawMessage } from './pi'
import { t, getLang } from './i18n'

export type ExportMessage = RawMessage & {
  customType?: string
  display?: boolean
  toolName?: string
  isError?: boolean
  output?: string
}

export interface ExportMeta {
  sessionId?: string | null
  sessionName?: string | null
  cwd?: string
  model?: string
}

/* ------------------------------------------------------------------ utils */

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function inlineMd(text: string): string {
  let out = esc(text)
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  return out
}

function tableHtml(header: string[], rows: string[][]): string {
  const head = header.map((h) => `<th>${inlineMd(h)}</th>`).join('')
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

/** Block-level markdown. */
function blockMd(text: string): string {
  const lines = String(text).split('\n')
  const out: string[] = []
  const para: string[] = []
  const flush = () => {
    if (!para.length) return
    out.push(`<p>${para.join('\n')}</p>`)
    para.length = 0
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flush()
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      out.push(tableHtml(header, rows))
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      const lvl = h[1].length
      out.push(`<h${lvl} class="md-h md-h${lvl}">${inlineMd(h[2])}</h${lvl}>`)
      i += 1
      continue
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flush()
      out.push('<hr class="md-hr">')
      i += 1
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      flush()
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote class="md-quote">${inlineMd(buf.join('\n'))}</blockquote>`)
      continue
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flush()
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
        i += 1
      }
      const li = items.map((x) => `<li>${inlineMd(x)}</li>`).join('')
      out.push(ordered ? `<ol class="md-list">${li}</ol>` : `<ul class="md-list">${li}</ul>`)
      continue
    }

    if (!line.trim()) {
      flush()
      i += 1
      continue
    }

    para.push(inlineMd(line))
    i += 1
  }
  flush()
  return out.join('')
}

function prettyJson(text: string): string | null {
  const trimmed = String(text).trim()
  if (!/^[[{]/.test(trimmed)) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object') return null
    return JSON.stringify(parsed, null, 2)
  } catch {
    return null
  }
}

/* ------------------------------------------------------ syntax highlight */

const HL_KEYWORDS = {
  js: 'const let var function return if else for while do break continue new class extends super this typeof instanceof in of delete void yield await async try catch finally throw switch case default import export from as static get set null undefined true false',
  py: 'def class return if elif else for while break continue import from as pass raise try except finally with lambda None True False and or not in is global nonlocal yield async await del assert',
  go: 'package import func var const type struct interface return if else for range break continue go defer chan map make new nil true false switch case default select',
  rust: 'fn let mut const struct enum impl trait for while loop if else match return use mod pub crate self super where async await move ref dyn box true false Some None Ok Err',
  java: 'public private protected class interface extends implements new return if else for while do switch case default break continue import package static final void int long double float boolean char String try catch finally throw throws this super null true false',
  sql: 'select from where insert update delete into values join left right inner outer on group by order having limit offset create table drop alter index as and or not null distinct count sum avg min max union',
}

function cLikeRules(keywords: string): Array<[string, RegExp]> {
  const kw = new RegExp(`\\b(?:${keywords.split(/\s+/).filter(Boolean).join('|')})\\b`, 'y')
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
  ]
}

function rulesFor(lang: string): Array<[string, RegExp]> | null {
  const l = String(lang || '').toLowerCase()
  if (l === 'json' || l === 'jsonc') {
    return [
      ['k', /"(?:[^"\\]|\\.)*"(?=\s*:)/y],
      ['s', /"(?:[^"\\]|\\.)*"/y],
      ['n', /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
      ['c', /\b(?:true|false|null)\b/y],
      ['p', /[{}\[\],:]/y],
    ]
  }
  if (l === 'diff' || l === 'patch') {
    return [
      ['c', /^@@[^\n]*/my],
      ['f', /^\+\+\+[^\n]*/my],
      ['f', /^---[^\n]*/my],
      ['a', /^\+[^\n]*/my],
      ['d', /^-[^\n]*/my],
    ]
  }
  if (l === 'yaml' || l === 'yml' || l === 'toml' || l === 'ini') {
    return [
      ['c', /#[^\n]*/y],
      ['k', /^[ \t]*[\w.$-]+(?=\s*[:=])/my],
      ['s', /'(?:[^'\\\n]|\\.)*'/y],
      ['s', /"(?:[^"\\\n]|\\.)*"/y],
      ['n', /\b\d+(?:\.\d+)?\b/y],
      ['p', /[-:,\[\]{}]/y],
    ]
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
    ]
  }
  if (l === 'html' || l === 'xml' || l === 'svg' || l === 'vue') {
    return [
      ['c', /<!--[\s\S]*?-->/y],
      ['t', /<\/?[A-Za-z][\w:-]*/y],
      ['a', /[A-Za-z_:][\w:.-]*(?==)/y],
      ['s', /"(?:[^"\\]|\\.)*"/y],
      ['s', /'(?:[^'\\]|\\.)*'/y],
      ['p', /[<>/=]/y],
    ]
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
    ]
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
    ]
  }
  if (l === 'sql') {
    return [
      ['c', /--[^\n]*/y],
      ['s', /'(?:[^'\\\n]|\\.)*'/y],
      ['k', new RegExp(`\\b(?:${HL_KEYWORDS.sql.split(/\s+/).join('|')})\\b`, 'iy')],
      ['n', /\b\d+(?:\.\d+)?\b/y],
      ['p', /[();,.*=<>]/y],
    ]
  }
  if (/^(?:js|jsx|ts|tsx|mjs|cjs|javascript|typescript|json5)$/.test(l)) return cLikeRules(HL_KEYWORDS.js)
  if (/^(?:go|golang)$/.test(l)) return cLikeRules(HL_KEYWORDS.go)
  if (/^(?:rs|rust)$/.test(l)) return cLikeRules(HL_KEYWORDS.rust)
  if (/^(?:java|kt|kotlin)$/.test(l)) return cLikeRules(HL_KEYWORDS.java)
  if (/^(?:c|cpp|cc|h|hpp|cs|swift|php|scala)$/.test(l)) return cLikeRules(HL_KEYWORDS.java)
  return null
}

const HL_MAX = 200_000

function highlightCode(code: unknown, lang: string): string {
  const src = String(code ?? '')
  const rules = src.length > HL_MAX ? null : rulesFor(lang)
  if (!rules) return esc(src)
  let out = ''
  let plain = ''
  let i = 0
  const flush = () => {
    if (plain) {
      out += esc(plain)
      plain = ''
    }
  }
  while (i < src.length) {
    let hit: [string, string] | null = null
    for (const rule of rules) {
      rule[1].lastIndex = i
      const m = rule[1].exec(src)
      if (m && m[0]) {
        hit = [rule[0], m[0]]
        break
      }
    }
    if (hit) {
      flush()
      out += `<span class="tok-${hit[0]}">${esc(hit[1])}</span>`
      i += hit[1].length
    } else {
      plain += src[i]
      i += 1
    }
  }
  flush()
  return out
}

/** Minimal markdown: code fences, headings, lists, tables, quotes, links. */
function md(src: unknown): string {
  if (src == null) return ''
  const parts = String(src).split('```')
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      let body = parts[i]
      let lang = ''
      const nl = body.indexOf('\n')
      if (nl !== -1 && !body.slice(0, nl).includes(' ')) {
        lang = body.slice(0, nl).trim()
        body = body.slice(nl + 1)
      }
      let code = body.replace(/\n$/, '')
      if (/^json$/i.test(lang)) code = prettyJson(code) ?? code
      const label = lang ? `<span class="code-lang">${esc(lang)}</span>` : ''
      out += `<div class="codeblock">${label}<pre class="code"><code>${highlightCode(code, lang)}</code></pre></div>`
    } else {
      out += blockMd(parts[i])
    }
  }
  return out
}

/* ------------------------------------------------------- markdown export */

function blocksToMd(content: RawMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => {
      if (!c || typeof c !== 'object') return ''
      const any = c as Record<string, any>
      if (any.type === 'text') return any.text || ''
      if (any.type === 'thinking') return `> _thinking_\n> ${String(any.thinking || '').replace(/\n/g, '\n> ')}`
      if (any.type === 'toolCall')
        return `**tool: ${any.name}**\n\`\`\`json\n${JSON.stringify(any.arguments ?? {}, null, 2)}\n\`\`\``
      if (any.type === 'image') return '_[image]_'
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

export function conversationMarkdown(messages: ExportMessage[]): string {
  const out = ['# pi-gui conversation', '', `_${new Date().toISOString()}_`, '']
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    if (m.role === 'user') out.push('## User', '', blocksToMd(m.content), '')
    else if (m.role === 'assistant') {
      out.push('## Assistant', '', blocksToMd(m.content), '')
      if (m.usage) out.push(`_in ${m.usage.input ?? 0} / out ${m.usage.output ?? 0} tokens_`, '')
    } else if (m.role === 'toolResult') {
      out.push(`### tool result: ${m.toolName}${m.isError ? ' (error)' : ''}`, '', '```', extractText(m), '```', '')
    } else if (m.role === 'custom') {
      out.push(`> [${m.customType || 'custom'}] ${extractText(m.content)}`, '')
    }
  }
  return out.join('\n')
}

/* --------------------------------------------------------- html export */

function renderExportBlocks(content: RawMessage['content']): string {
  if (typeof content === 'string') return md(content)
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => {
      if (!c || typeof c !== 'object') return esc(String(c ?? ''))
      const any = c as Record<string, any>
      if (any.type === 'text') return md(any.text || '')
      if (any.type === 'thinking')
        return `<details><summary>thinking</summary><pre>${esc(any.thinking || any.text || '')}</pre></details>`
      if (any.type === 'toolCall')
        return `<div class="tool"><h4>${esc(any.name || 'tool')}</h4><pre>${esc(JSON.stringify(any.arguments ?? {}, null, 2))}</pre></div>`
      if (any.type === 'image') return '<p><em>[image]</em></p>'
      return ''
    })
    .join('\n')
}

export function exportMessagesHtml(messages: ExportMessage[]): string {
  const out: string[] = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    if (m.role === 'user') {
      out.push(`<div class="msg user"><div class="role">${esc(t('role.user'))}</div>${renderExportBlocks(m.content)}</div>`)
    } else if (m.role === 'assistant') {
      out.push(`<div class="msg assistant"><div class="role">${esc(t('role.assistant'))}</div>${renderExportBlocks(m.content)}</div>`)
    } else if (m.role === 'toolResult') {
      out.push(
        `<div class="tool"><h4>${esc(m.toolName || 'tool')}${m.isError ? ` <span class="err">(error)</span>` : ''}</h4>` +
          `<pre>${esc(extractText(m)).slice(0, 20000)}</pre></div>`,
      )
    } else if (m.role === 'bashExecution') {
      out.push(`<div class="tool"><h4>bash</h4><pre>${esc(m.output || '')}</pre></div>`)
    } else if (m.role === 'custom' && m.display !== false) {
      out.push(`<div class="msg"><div class="role">${esc(m.customType || 'custom')}</div><pre>${esc(extractText(m.content))}</pre></div>`)
    }
  }
  return out.join('\n')
}

function exportTraceHtml(records: unknown[]): string {
  if (!Array.isArray(records) || !records.length) return ''
  const rows = records
    .slice(0, 4000)
    .map((r) => {
      const rec = r as Record<string, any>
      const evt = rec.evt || rec
      const type = evt.type || '?'
      const extra = evt.text || evt.message || evt.toolName || evt.command || ''
      return `<div>${String(rec.seq ?? '').padStart(5, ' ')}  ${esc(type)}  ${esc(String(extra).slice(0, 160))}</div>`
    })
    .join('')
  return `<details><summary>trace (${records.length} events)</summary><div class="trace">${rows}</div></details>`
}

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
`

/** Build (but do not download) the standalone HTML bundle. Null when empty. */
export async function buildHtmlBundle(
  messages: ExportMessage[],
  meta: ExportMeta = {},
): Promise<string | null> {
  if (!messages.length) return null
  let records: unknown[] = []
  try {
    const res = await fetch(apiUrl('/api/trace'))
    const d = await res.json()
    records = d.records || []
  } catch {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const title = meta.sessionName || meta.sessionId || 'pi-gui session'
  const payload = JSON.stringify({ session: meta.sessionId, cwd: meta.cwd, messages, trace: records }).replace(/<\//g, '<\\/')
  const lang = getLang()
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
  ${esc(meta.cwd || '')} · ${esc(stamp)} · ${messages.length} ${esc(t('stats.messages'))}
  ${meta.model ? ' · ' + esc(meta.model) : ''}
</div>
${exportMessagesHtml(messages)}
${exportTraceHtml(records)}
<script type="application/json" id="pi-gui-export">${payload}</script>
</body>
</html>`
  return html
}

export function downloadText(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * Fetch the raw (non-rendered) message list through the store's command/response
 * bridge. Resolves to [] when the response never arrives.
 */
export async function fetchRawMessages(
  command: (cmd: Record<string, unknown>) => void,
  onResponse: (cmd: string, cb: (e: Record<string, any>) => void) => () => void,
): Promise<ExportMessage[]> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: ExportMessage[]) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const off = onResponse('get_messages', (e) => {
      off()
      finish(Array.isArray(e?.data?.messages) ? (e.data.messages as ExportMessage[]) : [])
    })
    command({ type: 'get_messages' })
    setTimeout(() => {
      off()
      finish([])
    }, 4000)
  })
}
