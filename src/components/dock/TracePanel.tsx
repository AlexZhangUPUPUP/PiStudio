import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eraser } from 'lucide-react'
import { usePi } from '@/store/pi'
import { apiUrl } from '@/lib/pi'
import { fmtDur, fmtTokens } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  normalizeRecords,
  type TraceGroup,
  type TraceRecord,
  type TraceRow,
  type ToolSpan,
} from './traceModel'

const TRACE_MAX_BYTES = 8 * 1024 * 1024
const TRACE_ROWS_PER_GROUP = 40

interface HistoryFile {
  file: string
  size: number
  mtime: number
  current?: boolean
}

function kindBorder(kind: string): string {
  switch (kind) {
    case 'user':
    case 'thinking':
    case 'marker':
      return 'border-coral'
    case 'assistant':
    case 'tool':
    case 'dialog':
      return 'border-teal'
    case 'error':
      return 'border-destructive'
    case 'meta':
      return 'border-gold'
    default:
      return 'border-border'
  }
}

function LazyDetail({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="mt-1"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none font-mono text-[11px] text-muted-foreground">
        {label}
      </summary>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
          {text}
        </pre>
      )}
    </details>
  )
}

function detailText(detail: unknown): string {
  if (detail == null) return ''
  return typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)
}

function TraceRowView({ row, startT }: { row: TraceRow; startT: number }) {
  const rel = row.t - startT
  const time = (rel >= 0 ? '+' : '') + (rel / 1000).toFixed(2) + 's'
  return (
    <div
      className={cn(
        'grid grid-cols-[62px_18px_minmax(0,1fr)] gap-1.5 border-l-2 px-2 py-0.5 hover:bg-muted/30',
        kindBorder(row.kind),
      )}
    >
      <div
        className="pt-px text-right font-mono text-[10px] text-muted-foreground/70"
        title={new Date(row.t).toLocaleTimeString()}
      >
        {time}
      </div>
      <div className="text-center text-[11px] leading-4">{row.icon}</div>
      <div className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.35]">
        {row.label && <span className="text-muted-foreground">{row.label} </span>}
        <span className={cn(row.dim && 'text-muted-foreground', row.isError && 'text-destructive')}>
          {row.text || ''}
        </span>
        {row.detail != null && <LazyDetail label={row.detailLabel || 'detail'} text={detailText(row.detail)} />}
      </div>
    </div>
  )
}

function Waterfall({ spans, startT, dur }: { spans: ToolSpan[]; startT: number; dur: number }) {
  if (dur <= 0) return null
  return (
    <div className="relative h-1.5 w-14 shrink-0 overflow-hidden rounded-sm bg-muted/40">
      {spans.slice(-40).map((s, i) => {
        const left = Math.max(0, ((s.start - startT) / dur) * 100)
        const width = Math.max(2, ((Math.max(s.end, s.start + 1) - s.start) / dur) * 100)
        return (
          <i
            key={i}
            title={`${s.name} ${fmtDur(s.end - s.start)}`}
            className={cn('absolute top-0 h-full', s.isError ? 'bg-destructive' : 'bg-teal')}
            style={{ left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%` }}
          />
        )
      })}
    </div>
  )
}

export function TracePanel() {
  const { t, onAnyEvent, info, toast } = usePi()
  const [records, setRecords] = useState<TraceRecord[]>([])
  const [showDeltas, setShowDeltas] = useState(false)
  const [follow, setFollow] = useState(true)
  const [fileLabel, setFileLabel] = useState('')
  const [history, setHistory] = useState<HistoryFile[]>([])
  const [cleared, setCleared] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const recordsRef = useRef<TraceRecord[]>([])
  const sizesRef = useRef<number[]>([])
  const bytesRef = useRef(0)
  const seqRef = useRef(0)
  const pinnedRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  const setTraceRaw = useCallback((next: TraceRecord[]) => {
    recordsRef.current = next
    sizesRef.current = []
    bytesRef.current = 0
    let maxSeq = 0
    for (const rec of next) {
      const size = JSON.stringify(rec).length
      sizesRef.current.push(size)
      bytesRef.current += size
      if (rec.seq != null && rec.seq > maxSeq) maxSeq = rec.seq
    }
    seqRef.current = Math.max(seqRef.current, maxSeq)
    setRecords(next)
  }, [])

  const pushRaw = useCallback(
    (rec: TraceRecord) => {
      let next = recordsRef.current.concat(rec)
      const size = JSON.stringify(rec).length
      sizesRef.current.push(size)
      bytesRef.current += size
      while (next.length > 500 && (next.length > 20000 || bytesRef.current > TRACE_MAX_BYTES)) {
        next = next.slice(1)
        bytesRef.current -= sizesRef.current.shift() || 0
      }
      recordsRef.current = next
      setRecords(next)
      setCleared(false)
    },
    [],
  )

  // consume every server event
  useEffect(() => {
    return onAnyEvent((e: Record<string, any>) => {
      const seq = typeof e.__seq === 'number' ? e.__seq : undefined
      if (seq != null && seq <= seqRef.current) return
      if (seq != null) seqRef.current = seq
      pushRaw({ seq, t: typeof e.__t === 'number' ? e.__t : Date.now(), evt: e })
    })
  }, [onAnyEvent, pushRaw])

  const loadHistory = useCallback(async () => {
    try {
      const [listRes, curRes] = await Promise.all([
        fetch(apiUrl('/api/traces')).then((r) => r.json()),
        fetch(apiUrl('/api/trace')).then((r) => r.json()),
      ])
      setHistory(Array.isArray(listRes.files) ? listRes.files : [])
      if (!pinnedRef.current && curRes.file) setFileLabel(curRes.file)
      if (!pinnedRef.current && Array.isArray(curRes.records) && curRes.records.length) {
        setTraceRaw(curRes.records)
      }
    } catch {
      /* ignore */
    }
  }, [setTraceRaw])

  const selectTraceFile = useCallback(
    async (file: string) => {
      if (!file) {
        pinnedRef.current = false
        try {
          const cur = await fetch(apiUrl('/api/trace')).then((r) => r.json())
          if (cur && Array.isArray(cur.records)) {
            setTraceRaw(cur.records)
            setFileLabel(cur.file || '')
          }
        } catch {
          /* ignore */
        }
        return
      }
      try {
        const data = await fetch(apiUrl('/api/trace?file=' + encodeURIComponent(file))).then((r) => r.json())
        pinnedRef.current = true
        setTraceRaw(Array.isArray(data.records) ? data.records : [])
        setFileLabel(data.file || file)
      } catch (err) {
        toast(t('trace.loadFailed', { msg: err instanceof Error ? err.message : String(err) }), 'error')
      }
    },
    [setTraceRaw, t, toast],
  )

  // load persisted trace once connected (and when the underlying file changes)
  useEffect(() => {
    if (info.traceFile != null || info.session) loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.traceFile, info.session])

  const normalized = useMemo(() => normalizeRecords(records, t), [records, t])

  // follow: auto-scroll to the newest row
  useEffect(() => {
    if (follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [records, follow])

  // "trace jump" chips on user messages scroll the matching prompt group into view
  useEffect(() => {
    const onJump = (e: Event) => {
      const ordinal = (e as CustomEvent).detail?.ordinal
      if (!ordinal) return
      window.setTimeout(() => {
        const el = listRef.current?.querySelector(`[data-trace-group="${ordinal}"]`)
        el?.scrollIntoView({ block: 'start' })
      }, 200)
    }
    window.addEventListener('pi-gui:trace-jump', onJump)
    return () => window.removeEventListener('pi-gui:trace-jump', onJump)
  }, [])

  const clear = () => {
    recordsRef.current = []
    sizesRef.current = []
    bytesRef.current = 0
    seqRef.current = 0
    setRecords([])
    setCleared(true)
    setCollapsed(new Set())
    setExpanded(new Set())
  }

  const exportTrace = () => {
    const blob = new Blob(
      [recordsRef.current.map((r) => JSON.stringify(r)).join('\n') + '\n'],
      { type: 'application/x-ndjson' },
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (fileLabel || 'trace') + '.ndjson'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
        <span className="max-w-32 truncate font-mono text-[11px] text-muted-foreground" title={fileLabel}>
          {fileLabel || ''}
        </span>
        <span className="flex-1" />
        <label className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-muted-foreground" title={t('trace.deltasHint')}>
          <input type="checkbox" checked={showDeltas} onChange={(e) => setShowDeltas(e.target.checked)} className="accent-teal" />
          {t('trace.deltas')}
        </label>
        <label className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-muted-foreground" title={t('trace.followHint')}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-teal" />
          {t('trace.follow')}
        </label>
        <select
          onChange={(e) => selectTraceFile(e.target.value)}
          title={t('trace.history')}
          className="h-6 max-w-28 rounded border border-input bg-background font-mono text-[11px] text-foreground"
        >
          <option value="">{t('trace.current')}</option>
          {history.map((f) => (
            <option key={f.file} value={f.file}>
              {f.current ? '● ' : ''}
              {new Date(f.mtime).toLocaleString()} · {(f.size / 1024).toFixed(0)}kB
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={clear} title={t('common.clear')}>
          <Eraser className="size-3" />
          {t('common.clear')}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={exportTrace} title={t('common.export')}>
          <Download className="size-3" />
          {t('common.export')}
        </Button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto pb-6 font-mono text-[11px]">
        {records.length === 0 && cleared && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground">
            <span>·</span>
            <span className="text-muted-foreground">{t('trace.cleared')}</span>
          </div>
        )}
        {normalized.groups.map((g) => (
          <TraceGroupView
            key={g.id}
            group={g}
            showDeltas={showDeltas}
            collapsed={collapsed.has(g.id)}
            expanded={expanded.has(g.id)}
            onToggleCollapsed={() => toggleCollapsed(g.id)}
            onExpand={() => toggleExpanded(g.id)}
          />
        ))}
      </div>
    </div>
  )
}

function TraceGroupView({
  group,
  showDeltas,
  collapsed,
  expanded,
  onToggleCollapsed,
  onExpand,
}: {
  group: TraceGroup
  showDeltas: boolean
  collapsed: boolean
  expanded: boolean
  onToggleCollapsed: () => void
  onExpand: () => void
}) {
  const dur = group.endT && group.startT ? group.endT - group.startT : 0
  const visibleRows = showDeltas ? group.rows : group.rows.filter((r) => !r.delta)
  const shown = expanded ? visibleRows : visibleRows.slice(-TRACE_ROWS_PER_GROUP)
  const hidden = visibleRows.length - shown.length
  const parts = [fmtDur(dur)]
  if (group.tools) parts.push(group.tools === 1 ? '1 tool' : `${group.tools} tools`)
  if (group.tokens) parts.push(fmtTokens(group.tokens) + ' tok')
  if (group.cost) parts.push('$' + group.cost.toFixed(5))

  return (
    <div data-trace-group={group.isPrompt ? group.ordinal : undefined} className="border-b border-border/50">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border/30 bg-muted/60 px-2.5 py-1 text-left hover:bg-muted"
      >
        <span className="shrink-0 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-semibold text-foreground">
          {group.isPrompt ? '#' + group.ordinal : '·'}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground" title={group.prompt}>
          {group.prompt}
        </span>
        <Waterfall spans={group.toolSpans} startT={group.startT} dur={dur} />
        {group.files.length > 0 && (
          <span
            className="shrink-0 text-[10px] text-muted-foreground"
            title={group.files.join('\n')}
          >
            {group.files.length} file{group.files.length > 1 ? 's' : ''}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">{parts.join(' · ')}</span>
      </button>

      {!collapsed && (
        <div>
          {shown.map((row) => (
            <TraceRowView key={row.id} row={row} startT={group.startT} />
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={onExpand}
              className="block w-full px-2.5 py-0.5 text-left text-[10px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              {hidden} more rows hidden — click to show all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
