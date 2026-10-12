import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import {
  apiUrl,
  extractText,
  messagesToItems,
  sendCommand,
  uid,
  type AssBlock,
  type ChatItem,
  type ProcStatus,
  type SessionInfo,
} from '@/lib/pi'
import type { Lang, TFunc } from '@/lib/i18n'
import { useI18n } from '@/lib/i18n'

/* ------------------------------------------------------------------ types */

export interface ModelInfo {
  provider: string
  id: string
  name?: string
}
export interface CommandInfo {
  name: string
  description?: string
  source?: string
}
export interface StatsState {
  tokens?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
  cost?: number
  contextUsage?: { percent?: number; tokens?: number; contextWindow?: number }
  sessionId?: string
  sessionFile?: string
  messageCount?: number
  userMessages?: number
  assistantMessages?: number
  toolCalls?: number
  totalMessages?: number
}
export interface ExtDialog {
  id: string
  method: 'select' | 'confirm' | 'input' | 'editor'
  title?: string
  message?: string
  options?: string[]
  placeholder?: string
  prefill?: string
  timeout?: number
}
export interface Widget {
  key: string
  lines: string[]
  placement?: string
}
export interface Toast {
  id: string
  message: string
  type: 'info' | 'warning' | 'error' | 'success'
}

export interface PiState {
  connected: boolean
  info: SessionInfo
  proc: ProcStatus
  streaming: boolean
  runAction: string
  items: ChatItem[]
  draft: string
  models: ModelInfo[]
  thinkingLevels: string[]
  currentModel?: { provider: string; id: string; name?: string }
  currentThinking?: string
  sessionName?: string
  commands: CommandInfo[]
  stats: StatsState | null
  dialogs: ExtDialog[]
  widgets: Widget[]
  extStatus: Record<string, string>
  toasts: Toast[]
  changesTick: number
  queue: { steer: number; follow: number }
  runStartedAt: number
  assistantStartedAt: number
  lastTps: number
  toolSchemas: Record<string, { name?: string; description?: string; parameters?: unknown; source?: unknown }>
  activeTools: string[]
}

const initialState: PiState = {
  connected: false,
  info: {},
  proc: { state: 'starting' },
  streaming: false,
  runAction: '',
  items: [],
  draft: '',
  models: [],
  thinkingLevels: [],
  commands: [],
  stats: null,
  dialogs: [],
  widgets: [],
  extStatus: {},
  toasts: [],
  changesTick: 0,
  queue: { steer: 0, follow: 0 },
  runStartedAt: 0,
  assistantStartedAt: 0,
  lastTps: 0,
  toolSchemas: {},
  activeTools: [],
}

/* --------------------------------------------------------------- bus/events */

type Listener = (event: Record<string, any>) => void

/* --------------------------------------------------------------- helpers */

type AssItem = Extract<ChatItem, { kind: 'assistant' }>

function lastAssistantIndex(items: ChatItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'assistant') return i
  return -1
}

function withLastAssistant(items: ChatItem[], fn: (a: AssItem) => AssItem): ChatItem[] {
  const idx = lastAssistantIndex(items)
  if (idx === -1) {
    return items.concat(fn({ kind: 'assistant', id: uid('a'), blocks: [], streaming: true }))
  }
  const next = items.slice()
  next[idx] = fn(next[idx] as AssItem)
  return next
}

function appendBlock(blocks: AssBlock[], kind: 'text' | 'thinking', delta: string): AssBlock[] {
  const next = blocks.slice()
  const last = next[next.length - 1]
  if (last && last.type === kind) next[next.length - 1] = { ...last, text: last.text + delta }
  else next.push({ type: kind, text: delta, streaming: true })
  return next
}

function updateTool(
  blocks: AssBlock[],
  id: string | undefined,
  fn: (b: Extract<AssBlock, { type: 'tool' }>) => AssBlock,
): AssBlock[] {
  const next = blocks.slice()
  let idx = -1
  if (id) {
    for (let i = next.length - 1; i >= 0; i--) {
      const b = next[i]
      if (b.type === 'tool' && b.id === id) {
        idx = i
        break
      }
    }
  }
  if (idx === -1) return next
  next[idx] = fn(next[idx] as Extract<AssBlock, { type: 'tool' }>)
  return next
}

/* ----------------------------------------------------------------- actions */

type Action =
  | { type: 'event'; event: Record<string, any> }
  | { type: 'connected'; value: boolean }
  | { type: 'draft'; value: string }
  | { type: 'clear' }
  | { type: 'toast'; toast: Toast }
  | { type: 'untoast'; id: string }
  | { type: 'respondDialog'; id: string }
  | { type: 'changes' }

function reduceEvent(state: PiState, e: Record<string, any>): PiState {
  switch (e.type) {
    case '__hello':
      return {
        ...state,
        info: {
          session: e.session,
          cwd: e.cwd,
          pid: e.pid,
          alive: e.alive,
          traceFile: e.traceFile,
          url: e.url,
        },
        proc:
          state.proc.state === 'starting'
            ? { state: e.alive ? 'running' : 'starting', pid: e.pid ?? undefined }
            : state.proc,
        dialogs: Array.isArray(e.dialogs)
          ? state.dialogs.filter((d) => e.dialogs.includes(d.id))
          : state.dialogs,
      }

    case '__proc':
      if (e.status === 'started') return { ...state, proc: { state: 'running', pid: e.pid } }
      if (e.status === 'exit')
        return { ...state, streaming: false, proc: { state: 'exited', code: e.code, signal: e.signal } }
      if (e.status === 'error')
        return { ...state, proc: { state: 'error', message: String(e.message || '') } }
      return state

    case 'agent_start':
      return { ...state, streaming: true, runAction: state.runAction || 'thinking', runStartedAt: Date.now() }
    case 'agent_settled':
      return {
        ...state,
        streaming: false,
        runAction: '',
        runStartedAt: 0,
        queue: { steer: 0, follow: 0 },
        items: state.items.map((it) =>
          it.kind === 'assistant' && it.streaming ? { ...it, streaming: false } : it,
        ),
      }

    case 'message_start': {
      const m = e.message || {}
      if (m.role === 'user')
        return {
          ...state,
          items: state.items.concat({
            kind: 'user',
            id: uid('u'),
            text: extractText(m.content),
            images: Array.isArray(m.content)
              ? m.content.filter((c: any) => c && c.type === 'image').length
              : 0,
          }),
        }
      if (m.role === 'assistant')
        return {
          ...state,
          streaming: true,
          assistantStartedAt: Date.now(),
          items: state.items.concat({ kind: 'assistant', id: uid('a'), blocks: [], streaming: true }),
        }
      // custom/system messages are rendered once, in message_end (honouring display:false)
      return state
    }

    case 'message_update': {
      const ae = e.assistantMessageEvent
      if (!ae || !ae.type) return state
      return {
        ...state,
        items: withLastAssistant(state.items, (a) => {
          const b = a.blocks
          if (ae.type === 'text_start') return { ...a, blocks: b.concat({ type: 'text', text: '', streaming: true }) }
          if (ae.type === 'text_delta') return { ...a, blocks: appendBlock(b, 'text', ae.delta || '') }
          if (ae.type === 'text_end') {
            const n = b.slice()
            const last = n[n.length - 1]
            if (last && last.type === 'text') n[n.length - 1] = { ...last, text: ae.content ?? last.text, streaming: false }
            return { ...a, blocks: n }
          }
          if (ae.type === 'thinking_start') return { ...a, blocks: b.concat({ type: 'thinking', text: '', streaming: true }), }
          if (ae.type === 'thinking_delta') return { ...a, blocks: appendBlock(b, 'thinking', ae.delta || '') }
          if (ae.type === 'thinking_end') {
            const n = b.slice()
            const last = n[n.length - 1]
            if (last && last.type === 'thinking') n[n.length - 1] = { ...last, text: ae.content ?? last.text, streaming: false }
            return { ...a, blocks: n }
          }
          if (ae.type === 'toolcall_start')
            return { ...a, blocks: b.concat({ type: 'tool', id: ae.id, name: ae.toolName, argsText: '', status: 'streaming' }) }
          if (ae.type === 'toolcall_delta')
            return { ...a, blocks: updateTool(b, ae.id, (t) => ({ ...t, argsText: t.argsText + (ae.delta || '') })) }
          if (ae.type === 'toolcall_end') {
            const tc = ae.toolCall || {}
            return {
              ...a,
              blocks: updateTool(b, ae.id || tc.id, (t) => ({
                ...t,
                id: tc.id || t.id,
                name: tc.name || t.name,
                args: tc.arguments,
                argsText: JSON.stringify(tc.arguments ?? {}, null, 2),
                status: 'pending',
              })),
            }
          }
          return a
        }),
      }
    }

    case 'message_end': {
      const m = e.message || {}
      if (m.role === 'custom') {
        if (m.display === false) return state
        return { ...state, items: state.items.concat({ kind: 'system', id: uid('s'), text: extractText(m.content) }) }
      }
      if (m.role !== 'assistant') return state
      const outTok = m.usage?.output ?? 0
      const elapsed = state.assistantStartedAt ? (Date.now() - state.assistantStartedAt) / 1000 : 0
      return {
        ...state,
        assistantStartedAt: 0,
        // generation throughput of this reply, like pi's footer
        lastTps: outTok > 0 && elapsed > 0.2 ? outTok / elapsed : state.lastTps,
        items: withLastAssistant(state.items, (a) => ({
          ...a,
          streaming: false,
          usage: m.usage,
          stopReason: m.stopReason,
          errorMessage: m.errorMessage,
        })),
      }
    }

    case 'tool_execution_start':
      return {
        ...state,
        items: withLastAssistant(state.items, (a) => {
          const exists = a.blocks.some((b) => b.type === 'tool' && b.id === e.toolCallId)
          if (!exists)
            return {
              ...a,
              blocks: a.blocks.concat({
                type: 'tool',
                id: e.toolCallId,
                name: e.toolName,
                args: e.args,
                argsText: JSON.stringify(e.args ?? {}, null, 2),
                status: 'running',
                startedAt: e.__t ?? Date.now(),
              }),
            }
          return {
            ...a,
            blocks: updateTool(a.blocks, e.toolCallId, (t) => ({
              ...t,
              name: t.name || e.toolName,
              args: e.args,
              argsText: JSON.stringify(e.args ?? {}, null, 2),
              status: 'running',
              startedAt: t.startedAt ?? e.__t ?? Date.now(),
            })),
          }
        }),
      }
    case 'tool_execution_update':
      return {
        ...state,
        items: withLastAssistant(state.items, (a) => ({
          ...a,
          blocks: updateTool(a.blocks, e.toolCallId, (t) => ({ ...t, result: extractText(e.partialResult) })),
        })),
      }
    case 'tool_execution_end':
      return {
        ...state,
        items: withLastAssistant(state.items, (a) => ({
          ...a,
          blocks: updateTool(a.blocks, e.toolCallId, (t) => ({
            ...t,
            result: extractText(e.result),
            isError: !!e.isError,
            status: 'done',
            endedAt: e.__t ?? Date.now(),
          })),
        })),
      }

    case 'response': {
      if (e.command === 'get_messages' && e.success) {
        return { ...state, items: messagesToItems(e.data?.messages || []) }
      }
      if (e.command === 'get_available_models' && e.success)
        return { ...state, models: e.data?.models || [] }
      if (e.command === 'get_available_thinking_levels' && e.success)
        return { ...state, thinkingLevels: e.data?.levels || [] }
      if (e.command === 'get_commands' && e.success)
        return { ...state, commands: e.data?.commands || [] }
      if (e.command === 'get_session_stats' && e.success)
        return { ...state, stats: e.data || null }
      if (e.command === 'get_state' && e.success) {
        const d = e.data || {}
        return {
          ...state,
          currentModel: d.model || state.currentModel,
          currentThinking: d.thinkingLevel ?? state.currentThinking,
          sessionName: 'sessionName' in d ? d.sessionName : state.sessionName,
          streaming: d.isStreaming != null ? !!d.isStreaming : state.streaming,
        }
      }
      if (e.command === 'set_model' && e.success && e.data?.id)
        return { ...state, currentModel: e.data }
      if (e.command === 'set_thinking_level' && e.success && e.data?.level)
        return { ...state, currentThinking: e.data.level }
      return state
    }

    case 'extension_ui_request': {
      const req = e
      switch (req.method) {
        case 'notify':
          return {
            ...state,
            toasts: state.toasts.concat({
              id: uid('t'),
              message: req.message || '',
              type: req.notifyType === 'error' ? 'error' : req.notifyType === 'warning' ? 'warning' : 'info',
            }),
          }
        case 'setStatus': {
          const key = req.statusKey || 'ext'
          const next = { ...state.extStatus }
          if (req.statusText) next[key] = req.statusText
          else delete next[key]
          return { ...state, extStatus: next }
        }
        case 'setWidget': {
          const key = req.widgetKey || 'ext'
          const widgets = state.widgets.filter((w) => w.key !== key)
          if (req.widgetLines?.length)
            widgets.push({ key, lines: req.widgetLines, placement: req.widgetPlacement })
          return { ...state, widgets }
        }
        case 'setTitle':
          if (typeof document !== 'undefined') document.title = req.title || 'π GUI'
          return state
        case 'set_editor_text':
          return { ...state, draft: req.text || '' }
        case 'select':
        case 'confirm':
        case 'input':
        case 'editor':
          if (state.dialogs.some((d) => d.id === req.id)) return state
          return {
            ...state,
            dialogs: state.dialogs.concat({
              id: req.id,
              method: req.method,
              title: req.title,
              message: req.message,
              options: req.options,
              placeholder: req.placeholder,
              prefill: req.prefill,
              timeout: req.timeout,
            }),
          }
        default:
          return state
      }
    }

    case '__ui_response': {
      const id = e.response?.id
      if (id) return { ...state, dialogs: state.dialogs.filter((d) => d.id !== id) }
      return state
    }

    case 'tool_execution_start_hint':
      return state
    case '__inspect': {
      // the inspector's `inventory` capture carries the tool schemas
      if (e.kind === 'inventory' && Array.isArray(e.data?.tools)) {
        const next = { ...state.toolSchemas }
        for (const tool of e.data.tools) {
          if (tool && tool.name) next[tool.name] = tool
        }
        return {
          ...state,
          toolSchemas: next,
          activeTools: Array.isArray(e.data.activeTools) ? e.data.activeTools : state.activeTools,
        }
      }
      return state
    }
    case 'queue_update':
      return {
        ...state,
        queue: { steer: e.steering?.length || 0, follow: e.followUp?.length || 0 },
      }
    case 'auto_retry_start':
      return { ...state, runAction: 'retrying' }
    case 'compaction_start':
      return { ...state, runAction: 'compacting' }

    default:
      return state
  }
}

function reducer(state: PiState, action: Action): PiState {
  switch (action.type) {
    case 'event': {
      const next = reduceEvent(state, action.event)
      // change-tracking: any tool result may have touched files
      if (
        action.event.type === 'tool_execution_end' ||
        action.event.type === 'agent_settled' ||
        action.event.type === 'compaction_end'
      ) {
        return { ...next, changesTick: next.changesTick + 1 }
      }
      return next
    }
    case 'connected':
      return { ...state, connected: action.value }
    case 'draft':
      return { ...state, draft: action.value }
    case 'clear':
      return { ...state, items: [], streaming: false, runAction: '' }
    case 'toast':
      return { ...state, toasts: state.toasts.concat(action.toast) }
    case 'untoast':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }
    case 'respondDialog':
      return { ...state, dialogs: state.dialogs.filter((d) => d.id !== action.id) }
    case 'changes':
      return { ...state, changesTick: state.changesTick + 1 }
    default:
      return state
  }
}

/* ---------------------------------------------------------------- context */

interface PiContextValue extends PiState {
  t: TFunc
  lang: Lang
  setLang: (l: Lang) => void
  send: (text: string, images?: { data: string; mimeType: string }[]) => void
  abort: () => void
  restart: () => void
  newSession: () => void
  editLast: () => void
  retryLast: () => void
  command: (cmd: Record<string, unknown>) => void
  setModel: (key: string) => void
  setThinking: (level: string) => void
  setDraft: (v: string) => void
  toast: (message: string, type?: Toast['type'], ms?: number) => void
  dismissToast: (id: string) => void
  respondDialog: (id: string, payload: Record<string, unknown>) => void
  onResponse: (command: string, cb: (e: Record<string, any>) => void) => () => void
  onEvent: (type: string, cb: (e: Record<string, any>) => void) => () => void
  /** Every server event (trace/inspector use this). */
  onAnyEvent: (cb: (e: Record<string, any>) => void) => () => void
}

const PiContext = createContext<PiContextValue | null>(null)

export function PiProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const { t, lang, setLang } = useI18n()
  const stateRef = useRef(state)
  stateRef.current = state

  const responseBus = useRef(new Map<string, Set<Listener>>())
  const eventBus = useRef(new Map<string, Set<Listener>>())
  const anyBus = useRef(new Set<Listener>())

  const onResponse = useCallback((command: string, cb: Listener) => {
    const m = responseBus.current
    if (!m.has(command)) m.set(command, new Set())
    m.get(command)!.add(cb)
    return () => m.get(command)?.delete(cb)
  }, [])

  const onEvent = useCallback((type: string, cb: Listener) => {
    const m = eventBus.current
    if (!m.has(type)) m.set(type, new Set())
    m.get(type)!.add(cb)
    return () => m.get(type)?.delete(cb)
  }, [])

  const onAnyEvent = useCallback((cb: Listener) => {
    anyBus.current.add(cb)
    return () => anyBus.current.delete(cb)
  }, [])

  const command = useCallback((cmd: Record<string, unknown>) => {
    void sendCommand(cmd)
  }, [])

  useEffect(() => {
    const es = new EventSource(apiUrl('/api/events'))
    es.onopen = () => {
      dispatch({ type: 'connected', value: true })
      void sendCommand({ type: 'get_state' })
      void sendCommand({ type: 'get_messages' })
      void sendCommand({ type: 'get_available_models' })
      void sendCommand({ type: 'get_available_thinking_levels' })
      void sendCommand({ type: 'get_commands' })
      void sendCommand({ type: 'get_session_stats' })
    }
    es.onmessage = (ev) => {
      let data: Record<string, any>
      try {
        data = JSON.parse(ev.data)
      } catch {
        return
      }
      dispatch({ type: 'event', event: data })
      anyBus.current.forEach((cb) => {
        try {
          cb(data)
        } catch (err) {
          console.error('any-event handler failed', data.type, err)
        }
      })
      if (data.type === 'response' && data.command) {
        // A session change replaces the whole conversation: resync everything.
        if (
          data.success &&
          ['switch_session', 'new_session', 'fork', 'clone'].includes(data.command)
        ) {
          void sendCommand({ type: 'get_messages' })
          void sendCommand({ type: 'get_state' })
          void sendCommand({ type: 'get_session_stats' })
        }
        responseBus.current.get(data.command)?.forEach((cb) => {
          try {
            cb(data)
          } catch (err) {
            console.error('response handler failed', data.command, err)
          }
        })
      }
      // keep totals / cache stats / step counts fresh after each turn
      if (data.type === 'agent_settled') void sendCommand({ type: 'get_session_stats' })
      eventBus.current.get(data.type)?.forEach((cb) => {
        try {
          cb(data)
        } catch (err) {
          console.error('event handler failed', data.type, err)
        }
      })
    }
    es.onerror = () => dispatch({ type: 'connected', value: false })
    return () => es.close()
  }, [])

  const toast = useCallback((message: string, type: Toast['type'] = 'info', ms = 5200) => {
    const id = uid('t')
    dispatch({ type: 'toast', toast: { id, message, type } })
    setTimeout(() => dispatch({ type: 'untoast', id }), ms)
  }, [])

  const send = useCallback((text: string, images?: { data: string; mimeType: string }[]) => {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        const p = Notification.requestPermission()
        if (p && p.catch) p.catch(() => {})
      }
    } catch {}
    const cmd: Record<string, unknown> = { type: 'prompt', message: trimmed }
    if (images?.length) cmd.images = images
    void sendCommand(cmd)
  }, [])

  /* edit & resend / retry: ask pi for the last fork point, then fork + prefill */
  const forkIntentRef = useRef<'edit' | 'retry' | null>(null)
  const pendingForkRef = useRef<'edit' | 'retry' | null>(null)
  const pendingForkTimer = useRef<number | null>(null)

  useEffect(() => {
    const clearPending = () => {
      pendingForkRef.current = null
      if (pendingForkTimer.current) {
        window.clearTimeout(pendingForkTimer.current)
        pendingForkTimer.current = null
      }
    }
    const offGet = onResponse('get_fork_messages', (e) => {
      const list = e.data?.messages || []
      const last = list[list.length - 1]
      const intent = forkIntentRef.current
      forkIntentRef.current = null
      if (!last || !intent) return
      clearPending()
      pendingForkRef.current = intent
      // a lost fork response must not hijack the *next* fork (e.g. from Sessions)
      pendingForkTimer.current = window.setTimeout(clearPending, 8000)
      void sendCommand({ type: 'fork', entryId: last.entryId })
    })
    const offFork = onResponse('fork', (e) => {
      const intent = pendingForkRef.current
      clearPending()
      // not our edit/retry flow (e.g. the Sessions modal) — let its caller toast
      if (!intent) return
      const d = e.data || {}
      if (d.cancelled) {
        toast(t('toast.forkCancelled'), 'warning')
        return
      }
      const text = d.text || ''
      if (intent === 'retry') {
        dispatch({ type: 'draft', value: '' })
        void sendCommand({ type: 'prompt', message: text })
      } else {
        dispatch({ type: 'draft', value: text })
        window.dispatchEvent(new CustomEvent('pi-gui:focus-composer'))
        toast(t('chat.editHint'))
      }
    })
    return () => {
      offGet()
      offFork()
      clearPending()
    }
  }, [onResponse, toast, t])

  /* tell the user a run finished while the tab was in the background */
  useEffect(() => {
    const off = onEvent('agent_settled', () => {
      if (!document.hidden) return
      try {
        if (!('Notification' in window) || Notification.permission !== 'granted') return
        const items = stateRef.current.items
        const last = [...items].reverse().find((it): it is AssItem => it.kind === 'assistant')
        const text = last
          ? last.blocks
              .filter((b): b is Extract<AssBlock, { type: 'text' }> => b.type === 'text')
              .map((b) => b.text)
              .join(' ')
          : ''
        const body = text.replace(/\s+/g, ' ').trim().slice(0, 140) || t('notify.done')
        new Notification('π GUI', { body, silent: true })
      } catch {}
    })
    return () => {
      off()
    }
  }, [onEvent, t])

  const value = useMemo<PiContextValue>(
    () => ({
      ...state,
      t,
      lang,
      setLang,
      send,
      abort: () => command({ type: 'abort' }),
      restart: () => void fetch(apiUrl('/api/restart'), { method: 'POST' }),
      newSession: () => command({ type: 'new_session' }),
      editLast: () => {
        if (stateRef.current.streaming) {
          toast(t('chat.busyStopFirst'), 'warning')
          return
        }
        forkIntentRef.current = 'edit'
        void sendCommand({ type: 'get_fork_messages' })
      },
      retryLast: () => {
        if (stateRef.current.streaming) {
          toast(t('chat.busyStopFirst'), 'warning')
          return
        }
        forkIntentRef.current = 'retry'
        void sendCommand({ type: 'get_fork_messages' })
      },
      command,
      setModel: (key: string) => {
        const [provider, ...rest] = key.split('/')
        command({ type: 'set_model', provider, modelId: rest.join('/') })
      },
      setThinking: (level: string) => command({ type: 'set_thinking_level', level }),
      setDraft: (v: string) => dispatch({ type: 'draft', value: v }),
      toast,
      dismissToast: (id: string) => dispatch({ type: 'untoast', id }),
      respondDialog: (id: string, payload: Record<string, unknown>) => {
        dispatch({ type: 'respondDialog', id })
        command({ type: 'extension_ui_response', id, ...payload })
      },
      onResponse,
      onEvent,
      onAnyEvent,
    }),
    [state, t, lang, setLang, send, command, toast, onResponse, onEvent, onAnyEvent],
  )

  return <PiContext.Provider value={value}>{children}</PiContext.Provider>
}

export function usePi(): PiContextValue {
  const ctx = useContext(PiContext)
  if (!ctx) throw new Error('usePi must be used inside <PiProvider>')
  return ctx
}
