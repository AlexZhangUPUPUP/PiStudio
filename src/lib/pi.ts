/* ------------------------------------------------------------------ types */

export type RawContent =
  | string
  | Array<Record<string, any> & { type?: string }>
  | null
  | undefined

export interface RawMessage {
  role?: string
  content?: RawContent
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }
  }
  provider?: string
  model?: string
  stopReason?: string
  errorMessage?: string
  timestamp?: number
}

/** A block inside an assistant bubble. */
export type AssBlock =
  | { type: 'text'; text: string; streaming?: boolean }
  | { type: 'thinking'; text: string; streaming?: boolean }
  | {
      type: 'tool'
      id?: string
      name?: string
      argsText: string
      args?: unknown
      result?: string
      isError?: boolean
      status: 'streaming' | 'pending' | 'running' | 'done'
      startedAt?: number
      endedAt?: number
    }

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images: number }
  | {
      kind: 'assistant'
      id: string
      blocks: AssBlock[]
      streaming: boolean
      usage?: RawMessage['usage']
      stopReason?: string
      errorMessage?: string
    }
  | { kind: 'notice'; id: string; text: string; level: 'info' | 'warning' | 'error' }
  | { kind: 'system'; id: string; text: string }

export interface ProcStatus {
  state: 'starting' | 'running' | 'exited' | 'error'
  pid?: number
  code?: number | string | null
  signal?: string | null
  message?: string
}

export interface SessionInfo {
  session?: string | null
  cwd?: string
  pid?: number | null
  alive?: boolean
  traceFile?: string | null
  url?: string
}

/* ---------------------------------------------------------------- client */

/** Per-tab session id: a reload stays on the same session, a new tab is fresh. */
export function getClientId(): string {
  try {
    let id = sessionStorage.getItem('pi-gui-client')
    if (!id) {
      id = Math.random().toString(36).slice(2, 10)
      sessionStorage.setItem('pi-gui-client', id)
    }
    return id
  } catch {
    return 'default'
  }
}

/** Only present when the server is bound beyond loopback (see --host). */
export function getAuthToken(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('token')
    if (fromUrl) {
      sessionStorage.setItem('pi-gui-token', fromUrl)
      return fromUrl
    }
    return sessionStorage.getItem('pi-gui-token') || ''
  } catch {
    return ''
  }
}

/* --------------------------------------------------- per-session channels *
 * pi keeps one conversation per process, and the pi-gui server keeps one pi
 * process per client id (`c`). So a distinct `c` per conversation means one
 * live process per conversation: switching sessions no longer replaces (and so
 * stops) the current one — they run in parallel, and switching back re-attaches
 * to the process that is still running it.
 *
 * The channel key is the session file path once we know it; a brand-new session
 * starts under a temporary key, bound to its file as soon as pi reports it.
 */
let sessionKey = ''
const pathToKey = new Map<string, string>()
const KEY_EVENT = 'pi-gui-session-key'

export function getSessionKey(): string {
  return sessionKey
}

/** Stable channel key for a saved session file (falls back to the path itself). */
export function keyForSessionPath(p: string): string {
  return pathToKey.get(p) || p
}

/** Remember which channel a session file belongs to (so switching re-attaches). */
export function bindSessionPath(p: string, key: string = sessionKey): void {
  if (p) pathToKey.set(p, key)
}

function setSessionKey(key: string): void {
  if (key === sessionKey) return
  sessionKey = key
  try {
    window.dispatchEvent(new Event(KEY_EVENT))
  } catch {}
}

export function onSessionKeyChange(cb: () => void): () => void {
  window.addEventListener(KEY_EVENT, cb)
  return () => window.removeEventListener(KEY_EVENT, cb)
}

/** Append the client id (tab + active session) and token to an API path. */
export function apiUrl(path: string): string {
  const id = getClientId() + (sessionKey ? ':' + sessionKey : '')
  let out = path + (path.includes('?') ? '&' : '?') + 'c=' + encodeURIComponent(id)
  const token = getAuthToken()
  if (token) out += '&token=' + encodeURIComponent(token)
  return out
}

/** POST one raw RPC command to the target conversation's pi process. */
export async function sendCommand(cmd: Record<string, unknown>): Promise<Response> {
  const type = String((cmd as { type?: unknown }).type ?? '')
  const target = (cmd as { sessionPath?: unknown }).sessionPath
  // Route to (and switch to) the target conversation's channel *before* building
  // the URL, so apiUrl() picks the new `c`.
  if (type === 'switch_session' && typeof target === 'string') {
    const key = keyForSessionPath(target)
    // Switching to the conversation already on screen would send `switch_session`
    // to its running pi process, which aborts the in-flight turn. It is a no-op.
    if (key === sessionKey) return new Response('{"ok":true}', { status: 200 })
    setSessionKey(key)
  } else if (type === 'new_session' || type === 'fork' || type === 'clone') {
    setSessionKey('new:' + Math.random().toString(36).slice(2, 10))
  }
  return fetch(apiUrl('/api/command'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
}

/* --------------------------------------------------------------- helpers */

/** Flatten a raw pi content / tool-result value into plain text. */
export function extractText(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  const obj = result as Record<string, any>
  const content = obj.content ?? result
  if (Array.isArray(content)) {
    return content
      .map((c: any) =>
        c && c.type === 'text'
          ? c.text
          : c && c.type === 'thinking'
            ? (c.thinking ?? c.text ?? '')
            : c && c.type === 'image'
              ? '[image]'
              : typeof c === 'string'
                ? c
                : JSON.stringify(c),
      )
      .join('\n')
  }
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

/** Convert persisted `get_messages` output into renderable chat items. */
export function messagesToItems(messages: RawMessage[]): ChatItem[] {
  const items: ChatItem[] = []
  messages.forEach((m, i) => {
    if (!m || typeof m !== 'object') return
    if (m.role === 'user') {
      items.push({
        kind: 'user',
        id: `h-${i}`,
        text: extractText(m.content),
        images: Array.isArray(m.content)
          ? m.content.filter((c) => c && c.type === 'image').length
          : 0,
      })
      return
    }
    if (m.role === 'custom') {
      items.push({ kind: 'system', id: `h-${i}`, text: extractText(m.content) })
      return
    }
    if (m.role !== 'assistant') return

    const blocks: AssBlock[] = []
    const content = m.content
    if (typeof content === 'string') {
      if (content) blocks.push({ type: 'text', text: content })
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (!c || typeof c !== 'object') continue
        if (c.type === 'text') blocks.push({ type: 'text', text: c.text ?? '' })
        else if (c.type === 'thinking')
          blocks.push({ type: 'thinking', text: c.thinking ?? c.text ?? '' })
        else if (c.type === 'toolCall')
          blocks.push({
            type: 'tool',
            id: c.id,
            name: c.name,
            args: c.arguments,
            argsText: JSON.stringify(c.arguments ?? {}, null, 2),
            status: 'done',
          })
      }
    }
    items.push({
      kind: 'assistant',
      id: `h-${i}`,
      blocks,
      streaming: false,
      usage: m.usage,
      stopReason: m.stopReason,
      errorMessage: m.errorMessage,
    })
  })
  return items
}

let counter = 0
export function uid(prefix = 'x'): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

export function fmtTokens(n?: number): string {
  if (n == null) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
