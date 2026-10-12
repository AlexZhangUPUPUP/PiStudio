import { useEffect, useMemo, useRef, useState } from 'react'
import { usePi } from '@/store/pi'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiUrl } from '@/lib/pi'
import { fmtCost } from '@/lib/format'

export interface SessionSummary {
  id?: string | null
  name?: string | null
  preview?: string | null
  title?: string | null
  file?: string
  path: string
  entries?: number
  size?: number
  mtime?: number
  turns?: number
  cost?: number
  workspaceLabel?: string | null
}

interface SessionListProps {
  sessions: SessionSummary[]
  loading?: boolean
  currentFile?: string | null
  onSwitch: (s: SessionSummary) => void
  onDeleted: () => void
}

export function SessionList({ sessions, loading, currentFile, onSwitch, onDeleted }: SessionListProps) {
  const { t, toast } = usePi()
  const [q, setQ] = useState('')
  const [range, setRange] = useState('all')
  const [sort, setSort] = useState('new')
  const [namedOnly, setNamedOnly] = useState(false)
  const [armedPath, setArmedPath] = useState<string | null>(null)
  const armedTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (armedTimer.current != null) window.clearTimeout(armedTimer.current)
    },
    [],
  )

  const items = useMemo(() => {
    let list = sessions.slice()
    const ql = q.trim().toLowerCase()
    if (ql) {
      list = list.filter((s) =>
        `${s.name || ''} ${s.preview || ''} ${s.id || ''} ${s.file || ''}`.toLowerCase().includes(ql),
      )
    }
    if (namedOnly) list = list.filter((s) => !!s.name)
    if (range !== 'all') {
      const cutoff = Date.now() - Number(range) * 86400000
      list = list.filter((s) => (s.mtime || 0) >= cutoff)
    }
    const comparators: Record<string, (a: SessionSummary, b: SessionSummary) => number> = {
      new: (a, b) => (b.mtime || 0) - (a.mtime || 0),
      old: (a, b) => (a.mtime || 0) - (b.mtime || 0),
      big: (a, b) => (b.size || 0) - (a.size || 0),
      entries: (a, b) => (b.entries || 0) - (a.entries || 0),
    }
    list.sort(comparators[sort] || comparators.new)
    return list
  }, [sessions, q, range, sort, namedOnly])

  const armDelete = async (s: SessionSummary) => {
    if (armedPath === s.path) {
      try {
        const r = await fetch(apiUrl('/api/session/delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: s.path }),
        })
        const data = await r.json()
        if (data.ok) {
          toast(t('toast.deleted', { file: s.file }))
          onDeleted()
        } else {
          toast(t('toast.deleteFailed', { msg: data.error || '?' }), 'error')
        }
      } catch (err) {
        toast(t('toast.deleteFailed', { msg: (err as Error).message }), 'error')
      }
      setArmedPath(null)
      return
    }
    setArmedPath(s.path)
    if (armedTimer.current != null) window.clearTimeout(armedTimer.current)
    armedTimer.current = window.setTimeout(() => {
      setArmedPath((cur) => (cur === s.path ? null : cur))
    }, 3000)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('sessions.list.search')}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          title={t('sessions.list.range.all')}
          className="h-8 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">{t('sessions.list.range.all')}</option>
          <option value="1">{t('sessions.list.range.1')}</option>
          <option value="7">{t('sessions.list.range.7')}</option>
          <option value="30">{t('sessions.list.range.30')}</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          title={t('sessions.list.sort.new')}
          className="h-8 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="new">{t('sessions.list.sort.new')}</option>
          <option value="old">{t('sessions.list.sort.old')}</option>
          <option value="big">{t('sessions.list.sort.big')}</option>
          <option value="entries">{t('sessions.list.sort.entries')}</option>
        </select>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
          title={t('sessions.list.namedOnly')}
        >
          <input
            type="checkbox"
            checked={namedOnly}
            onChange={(e) => setNamedOnly(e.target.checked)}
            className="size-3.5 accent-teal"
          />
          {t('sessions.list.namedOnly')}
        </label>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {items.length} / {sessions.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1 scrollbar-thin">
        {loading && sessions.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">…</div>
        )}
        {!loading && items.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {sessions.length ? t('sessions.list.noMatch') : t('sessions.list.empty')}
          </div>
        )}
        {items.map((s) => {
          const armed = armedPath === s.path
          const title = s.title || s.name || s.preview || t('sessions.emptySession')
          return (
            <div
              key={s.path}
              onClick={() => onSwitch(s)}
              className={cn(
                'group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                currentFile && s.path === currentFile ? 'bg-teal/10' : 'hover:bg-muted',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" title={title}>
                  {title}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {(s.workspaceLabel ? s.workspaceLabel + ' · ' : '') +
                    t('sessions.entryMeta', {
                      id: s.id ? s.id.slice(0, 8) : '?',
                      n: s.entries,
                      kb: ((s.size || 0) / 1024).toFixed(0),
                    }) +
                    (s.turns ? ` · ${s.turns}${t('sessions.turnsSuffix')} · ${fmtCost(s.cost || 0)}` : '')}
                </div>
              </div>
              <div className="shrink-0 text-[11px] text-muted-foreground">
                {s.mtime ? new Date(s.mtime).toLocaleString() : ''}
              </div>
              <Button
                variant={armed ? 'destructive' : 'ghost'}
                size="sm"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation()
                  void armDelete(s)
                }}
              >
                {armed ? t('common.armed') : t('common.delete')}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
