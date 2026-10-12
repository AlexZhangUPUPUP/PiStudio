import { extractText } from '@/lib/pi'
import { fmtDur, fmtTokens, shortJson } from '@/lib/format'
import type { TFunc } from '@/lib/i18n'

/* Pure trace-model: turns raw `{seq,t,evt}` records into grouped rows,
 * mirroring public/app.js traceNormalize / traceStartGroup / tracePushRow. */

export interface TraceRecord {
  seq?: number
  t: number
  evt: Record<string, any>
}

export interface TraceRow {
  id: string
  t: number
  seq?: number
  kind: string
  icon: string
  label?: string
  text: string
  detail?: unknown
  detailLabel?: string
  dim?: boolean
  isError?: boolean
  delta?: boolean
  toolCallId?: string
  startedAt?: number
}

export interface ToolSpan {
  name: string
  start: number
  end: number
  isError?: boolean
}

export interface TraceGroup {
  id: string
  isPrompt: boolean
  prompt: string
  ordinal: number
  startT: number
  endT: number
  tokens: number
  cost: number
  tools: number
  files: string[]
  toolSpans: ToolSpan[]
  rows: TraceRow[]
}

export interface Normalized {
  groups: TraceGroup[]
  rows: TraceRow[]
}

export const TRACE_ICON: Record<string, string> = {
  user: '👤',
  assistant: '🤖',
  thinking: '🧠',
  tool: '🔧',
  llm: '◇',
  error: '⚠',
  meta: '·',
  dialog: '❓',
  marker: '⚑',
}

const INTERESTING_COMMANDS = [
  'prompt',
  'new_session',
  'abort',
  'compact',
  'set_model',
  'bash',
  'clear_queue',
  'fork',
  'clone',
  'switch_session',
  'set_session_name',
  'export_html',
]

export function normalizeRecords(records: TraceRecord[], t: TFunc): Normalized {
  const tp = (one: string, other: string, n: number, vars?: Record<string, unknown>) =>
    t(n === 1 ? one : other, { n, ...(vars || {}) })

  const groups: TraceGroup[] = []
  const rows: TraceRow[] = []
  const toolRows = new Map<string, TraceRow>()
  const dialogRows = new Map<string, TraceRow>()
  const st: { cur: TraceGroup | null } = { cur: null }

  const startGroup = (prompt: string, at: number, isPrompt: boolean): TraceGroup => {
    const g: TraceGroup = {
      id: 'g' + groups.length,
      isPrompt,
      prompt: prompt || '(empty prompt)',
      ordinal: isPrompt ? groups.filter((x) => x.isPrompt).length + 1 : 0,
      startT: at,
      endT: at,
      tokens: 0,
      cost: 0,
      tools: 0,
      files: [],
      toolSpans: [],
      rows: [],
    }
    groups.push(g)
    st.cur = g
    return g
  }

  for (const rec of records) {
    const evt = rec && rec.evt
    if (!evt || typeof evt !== 'object') continue
    const ts = rec.t
    let rowIdx = 0
    const push = (row: Omit<TraceRow, 'id' | 't' | 'seq'>): TraceRow => {
      if (!st.cur) {
        st.cur = startGroup('(session start)', ts, false)
        st.cur.prompt = '(session start)'
      }
      const full: TraceRow = { ...row, t: ts, seq: rec.seq, id: `${rec.seq ?? 't' + ts}-${rowIdx++}` }
      st.cur.rows.push(full)
      st.cur.endT = full.t
      rows.push(full)
      return full
    }

    switch (evt.type) {
      case 'message_start': {
        const m = evt.message || {}
        if (m.role === 'user') {
          startGroup(extractText(m.content), ts, true)
          push({
            kind: 'user',
            icon: '👤',
            label: t('label.prompt'),
            text: shortJson(extractText(m.content), 160),
            detail: m,
          })
          break
        }
        if (m.role === 'custom') {
          if (m.display === false) break
          push({
            kind: 'marker',
            icon: '✦',
            label: m.customType || t('role.custom'),
            text: shortJson(extractText(m.content), 200),
            detail: m,
          })
          break
        }
        if (m.role === 'assistant')
          push({ kind: 'llm', icon: '◇', label: t('label.assistant'), text: t('trace.text.started'), dim: true })
        break
      }

      case 'message_end': {
        const m = evt.message || {}
        if (m.role !== 'assistant') break
        const u = m.usage || {}
        const cost = u.cost?.total ?? 0
        const summary = `stop=${m.stopReason || 'stop'} · in ${u.input ?? 0} / out ${u.output ?? 0}${cost ? ` · $${Number(cost).toFixed(5)}` : ''}`
        push({
          kind: 'llm',
          icon: '◇',
          label: t('label.assistant'),
          text: summary,
          detail: m,
          detailLabel: t('trace.detail.message'),
        })
        if (m.stopReason === 'error')
          push({
            kind: 'error',
            icon: '⚠',
            label: t('label.error'),
            text: m.errorMessage || t('trace.text.modelError'),
            isError: true,
          })
        if (st.cur) {
          st.cur.tokens += (u.input ?? 0) + (u.output ?? 0)
          st.cur.cost += cost
        }
        break
      }

      case 'message_update': {
        const ae = evt.assistantMessageEvent || {}
        if (!ae.type) break
        let kind = 'llm'
        let label = ae.type
        let text = ''
        if (ae.type.startsWith('text')) {
          kind = 'assistant'
          label = 'text'
          text = ae.delta ?? ae.content ?? ''
        } else if (ae.type.startsWith('thinking')) {
          kind = 'thinking'
          label = 'thinking'
          text = ae.delta ?? ae.content ?? ''
        } else if (ae.type.startsWith('toolcall')) {
          kind = 'tool'
          label = 'toolargs'
          text = ae.toolName || ae.id || ae.delta || ''
        }
        if (!text) break
        push({
          kind,
          icon: TRACE_ICON[kind] || '·',
          label,
          text: shortJson(text, 220),
          delta: true,
          detail: ae,
          detailLabel: t('trace.detail.event'),
        })
        break
      }

      case 'tool_execution_start': {
        const row = push({
          kind: 'tool',
          icon: '🔧',
          label: evt.toolName || t('label.tool'),
          text: shortJson(evt.args, 200),
          detail: evt.args,
          detailLabel: t('trace.detail.args'),
        })
        row.toolCallId = evt.toolCallId
        row.startedAt = ts
        if (evt.toolCallId) toolRows.set(evt.toolCallId, row)
        if (st.cur) {
          st.cur.tools += 1
          const p = evt.args && (evt.args.path || evt.args.file)
          if (p && !st.cur.files.includes(p)) st.cur.files.push(p)
        }
        break
      }

      case 'tool_execution_update': {
        const row = evt.toolCallId && toolRows.get(evt.toolCallId)
        const partial = extractText(evt.partialResult)
        if (row) {
          row.text = t('trace.text.streaming', { dur: fmtDur(ts - (row.startedAt ?? ts)), n: partial.length })
        }
        break
      }

      case 'tool_execution_end': {
        const row = evt.toolCallId && toolRows.get(evt.toolCallId)
        const out = extractText(evt.result)
        const durMs = row ? ts - (row.startedAt ?? ts) : undefined
        const text = evt.isError
          ? t('trace.text.toolFail', { dur: fmtDur(durMs), n: out.length })
          : t('trace.text.toolOk', { dur: fmtDur(durMs), n: out.length })
        if (row) {
          row.text = text
          row.isError = !!evt.isError
          row.detail = out
          row.detailLabel = t('trace.detail.output')
        } else {
          push({
            kind: 'tool',
            icon: '🔧',
            label: evt.toolName || t('label.tool'),
            text,
            isError: !!evt.isError,
            detail: out,
            detailLabel: t('trace.detail.output'),
          })
        }
        if (st.cur) {
          const start = row && row.startedAt ? row.startedAt : ts
          st.cur.toolSpans.push({ name: evt.toolName || 'tool', start, end: ts, isError: !!evt.isError })
        }
        break
      }

      case 'turn_start':
        push({ kind: 'meta', icon: '·', label: t('label.turn'), text: t('trace.text.start'), dim: true })
        break

      case 'turn_end': {
        const n = Array.isArray(evt.toolResults) ? evt.toolResults.length : 0
        push({
          kind: 'meta',
          icon: '·',
          label: t('label.turn'),
          text: t('trace.text.end') + (n ? tp('trace.text.toolResult', 'trace.text.toolResults', n) : ''),
          dim: true,
        })
        break
      }

      case 'agent_start':
        push({ kind: 'meta', icon: '▶', label: t('label.agent'), text: t('trace.text.started'), dim: true })
        break

      case 'agent_end':
        push({
          kind: 'meta',
          icon: '■',
          label: t('label.agent'),
          text: t('trace.text.ended') + (evt.willRetry ? t('trace.text.willRetry') : ''),
          dim: true,
        })
        break

      case 'agent_settled':
        push({ kind: 'meta', icon: '✓', label: t('label.agent'), text: t('trace.text.settled'), dim: true })
        break

      case 'queue_update':
        if (evt.steering?.length || evt.followUp?.length)
          push({
            kind: 'meta',
            icon: '⇢',
            label: t('label.queue'),
            text: t('trace.text.steer', { steer: evt.steering?.length || 0, follow: evt.followUp?.length || 0 }),
          })
        break

      case 'compaction_start':
        push({
          kind: 'meta',
          icon: '⛶',
          label: t('label.compaction'),
          text: t('trace.text.compactionStart', { reason: evt.reason || t('trace.text.auto') }),
        })
        break

      case 'compaction_end': {
        const r = evt.result
        const text = evt.errorMessage
          ? t('trace.text.failed', { msg: evt.errorMessage })
          : r
            ? t('trace.text.compacted', { before: fmtTokens(r.tokensBefore), after: fmtTokens(r.estimatedTokensAfter) })
            : evt.aborted
              ? t('chat.aborted')
              : t('trace.text.done')
        push({ kind: 'meta', icon: '⛶', label: t('label.compaction'), text, isError: !!evt.errorMessage, detail: evt })
        break
      }

      case 'auto_retry_start':
        push({
          kind: 'meta',
          icon: '↻',
          label: t('label.retry'),
          text: t('trace.text.retry', { attempt: evt.attempt, max: evt.maxAttempts, msg: evt.errorMessage || '' }),
          detail: evt,
        })
        break

      case 'auto_retry_end':
        push({
          kind: 'meta',
          icon: '↻',
          label: t('label.retry'),
          text: evt.errorMessage ? t('trace.text.failed', { msg: evt.errorMessage }) : t('trace.text.recovered'),
          isError: !!evt.errorMessage,
        })
        break

      case 'extension_error':
        push({
          kind: 'error',
          icon: '⚠',
          label: t('label.extension'),
          text: evt.errorMessage || evt.message || t('label.error'),
          isError: true,
          detail: evt,
        })
        break

      case 'extension_ui_request': {
        const row = push({
          kind: 'dialog',
          icon: '❓',
          label: t('label.dialog'),
          text: `${evt.method}${evt.title ? ': ' + evt.title : evt.message ? ': ' + evt.message : ''}`,
          detail: evt,
          detailLabel: t('trace.detail.request'),
        })
        if (evt.id) dialogRows.set(evt.id, row)
        break
      }

      case '__ui_response': {
        const r = evt.response || {}
        const row = r.id && dialogRows.get(r.id)
        const answer = r.cancelled
          ? t('trace.text.cancelled')
          : r.confirmed != null
            ? t(r.confirmed ? 'common.yes' : 'common.no')
            : r.value
        const text = t('trace.text.answered', { value: shortJson(answer, 120) })
        if (row) row.text = text
        else push({ kind: 'dialog', icon: '❓', label: t('label.dialog'), text, dim: true })
        break
      }

      case '__marker':
        push({ kind: 'marker', icon: '⚑', label: evt.kind || t('role.marker'), text: evt.text || '', detail: evt.meta })
        break

      case '__proc':
        push({
          kind: 'meta',
          icon: '⚙',
          label: t('label.process'),
          text: `${evt.status}${evt.pid ? ' pid=' + evt.pid : ''}${evt.code != null ? ' code=' + evt.code : ''}`,
          isError: evt.status === 'error',
        })
        break

      case '__stderr':
        push({ kind: 'error', icon: '⚠', label: t('label.stderr'), text: evt.text, dim: true })
        break

      case 'response': {
        if (evt.success && !INTERESTING_COMMANDS.includes(evt.command)) break
        push({
          kind: evt.success ? 'meta' : 'error',
          icon: evt.success ? '·' : '⚠',
          label: evt.command,
          text: evt.success ? t('trace.text.ok') : t('trace.text.failed', { msg: shortJson(evt.error, 160) }),
          isError: !evt.success,
          dim: evt.success,
        })
        break
      }
    }
  }

  return { groups, rows }
}
