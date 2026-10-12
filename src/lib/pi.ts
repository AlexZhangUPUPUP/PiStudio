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
    cost?: { total?: number }
  }
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

/** Append the session id (and token) to an API path. */
export function apiUrl(path: string): string {
  const id = getClientId()
  let out = path + (path.includes('?') ? '&' : '?') + 'c=' + encodeURIComponent(id)
  const token = getAuthToken()
  if (token) out += '&token=' + encodeURIComponent(token)
  return out
}

/** POST one raw RPC command to this tab's pi process. */
export async function sendCommand(cmd: Record<string, unknown>): Promise<Response> {
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
