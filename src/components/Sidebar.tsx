import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, RefreshCw, Search } from 'lucide-react'
import { usePi } from '@/store/pi'
import { tp } from '@/lib/i18n'
import { apiUrl, sendCommand } from '@/lib/pi'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { fmtCost, fmtTokens } from '@/lib/format'

interface SidebarProps {
  open: boolean
  onClose: () => void
}

interface SbSession {
  id?: string | null
  path: string
  name?: string | null
  title?: string | null
  preview?: string | null
  file?: string
  mtime?: number
  turns?: number
  toolCalls?: number
  tokens?: number
  cost?: number
  workspace?: string
  workspaceLabel?: string | null
  isCurrentWorkspace?: boolean
}

interface SbHit {
  label: string
  snippet: string
  path: string
  id?: string
}

const SB_KEY = 'pi-gui-sidebar'

function relTime(ms: number | undefined, t: (k: string, v?: Record<string, unknown>) => string) {
  const d = Date.now() - (ms || 0)
  if (d < 60_000) return t('time.now')
  const m = Math.floor(d / 60_000)
  if (m < 60) return t('time.min', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('time.hour', { n: h })
  const days = Math.floor(h / 24)
  if (days < 30) return t('time.day', { n: days })
  const mo = Math.floor(days / 30)
  if (mo < 12) return t('time.month', { n: mo })
  return t('time.year', { n: Math.floor(mo / 12) })
}

function bucket(ms = 0): number {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  if (ms >= startOfToday) return 0
  if (ms >= startOfToday - day) return 1
  if (ms >= startOfToday - 6 * day) return 2
  if (ms >= startOfToday - 29 * day) return 3
  return 4
}

function shortWorkspace(label?: string | null) {
  const parts = String(label || '').split('/').filter(Boolean)
  if (!parts.length) return label || ''
  const tail = parts.slice(-2).join('/')
  return String(label).startsWith('~') ? '~/' + tail : tail
}

function loadPrefs(): { groupBy: 'workspace' | 'time'; groups: string[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(SB_KEY) || '{}')
    return {
      groupBy: raw.groupBy === 'time' ? 'time' : 'workspace',
      groups: Array.isArray(raw.groups) ? raw.groups : [],
    }
  } catch {
    return { groupBy: 'workspace', groups: [] }
  }
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { t, stats, command } = usePi()
  const prefs = useRef(loadPrefs())
  const [sessions, setSessions] = useState<SbSession[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [groupBy, setGroupBy] = useState<'workspace' | 'time'>(prefs.current.groupBy)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(prefs.current.groups))
  const [hits, setHits] = useState<SbHit[]>([])
  const [moreFor, setMoreFor] = useState<string | null>(null)
  const searchTimer = useRef<number | null>(null)

  const savePrefs = useCallback(
    (nextGroupBy: 'workspace' | 'time', nextCollapsed: Set<string>) => {
      try {
        localStorage.setItem(
          SB_KEY,
          JSON.stringify({ groupBy: nextGroupBy, groups: [...nextCollapsed] }),
        )
      } catch {}
    },
    [],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(apiUrl('/api/sessions?scope=all&limit=300'))
      const d = await r.json()
      setSessions(Array.isArray(d.sessions) ? d.sessions : [])
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onRefresh = () => void load()
    window.addEventListener('pi-gui:refresh-sessions', onRefresh)
    return () => window.removeEventListener('pi-gui:refresh-sessions', onRefresh)
  }, [load])

  useEffect(() => {
    void load()
  }, [stats?.sessionFile, load])

  // Debounced full-text search across saved sessions (content hits).
  useEffect(() => {
    const term = filter.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(async () => {
      try {
        const d = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(term)}&limit=8`)).then((r) =>
          r.json(),
        )
        setHits(
          (d.results || []).map((r: any) => ({
            label: r.name || String(r.file).slice(0, 40),
            snippet: (r.hits?.[0]?.snippet || '').slice(0, 90),
            path: r.path,
            id: r.id,
          })),
        )
      } catch {
        setHits([])
      }
    }, 220)
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [filter])

  const switchTo = useCallback(
    (path: string) => {
      void sendCommand({ type: 'switch_session', sessionPath: path })
      onClose()
    },
    [onClose],
  )

  const currentFile = stats?.sessionFile

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const byTime = groupBy === 'time'
    const map = new Map<
      string,
      { label: string; cwd?: string; isCurrent: boolean; order: number; sessions: SbSession[] }
    >()
    for (const s of sessions) {
      const label = byTime
        ? t(
            bucket(s.mtime) === 0
              ? 'sidebar.bucket.today'
              : bucket(s.mtime) === 1
                ? 'sidebar.bucket.yesterday'
                : bucket(s.mtime) === 2
                  ? 'sidebar.bucket.week'
                  : bucket(s.mtime) === 3
                    ? 'sidebar.bucket.month'
                    : 'sidebar.bucket.earlier',
          )
        : s.workspaceLabel || s.workspace || t('sidebar.unknownWorkspace')
      if (!map.has(label))
        map.set(label, {
          label,
          cwd: s.workspace,
          isCurrent: false,
          order: byTime ? bucket(s.mtime) : 0,
          sessions: [],
        })
      const g = map.get(label)!
      g.sessions.push(s)
      if (!byTime && s.isCurrentWorkspace) g.isCurrent = true
    }
    const out = [...map.values()]
    for (const g of out) {
      g.sessions.sort((a, b) => {
        const aa = a.path === currentFile ? 1 : 0
        const bb = b.path === currentFile ? 1 : 0
        return bb - aa || (b.mtime || 0) - (a.mtime || 0)
      })
    }
    if (byTime) {
      out.sort((a, b) => a.order - b.order)
      return out
    }
    const activeGroup = out.find((g) => g.sessions.some((s) => s.path === currentFile))
    out.sort((a, b) => {
      if (a === activeGroup) return -1
      if (b === activeGroup) return 1
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return a.label.localeCompare(b.label)
    })
    return out
  }, [sessions, groupBy, filter, currentFile, t])

  const q = filter.trim().toLowerCase()
  const filteredGroups = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          sessions: q
            ? g.sessions.filter((s) =>
                `${s.title || ''} ${s.name || ''} ${s.preview || ''} ${s.file || ''}`
                  .toLowerCase()
                  .includes(q),
              )
            : g.sessions,
        }))
        .filter((g) => g.sessions.length > 0),
    [groups, q],
  )

  const toggleGroup = (label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      savePrefs(groupBy, next)
      return next
    })
  }

  const setMode = (mode: 'workspace' | 'time') => {
    if (mode === groupBy) return
    const next = new Set<string>()
    setGroupBy(mode)
    setCollapsed(next)
    savePrefs(mode, next)
  }

  const rowMeta = (s: SbSession) => {
    const bits: string[] = []
    if (groupBy === 'time' && s.workspaceLabel) bits.push(shortWorkspace(s.workspaceLabel))
    if (s.turns) bits.push(tp('sidebar.turnOne', 'sidebar.turns', s.turns))
    if (s.cost) bits.push(fmtCost(s.cost))
    bits.push(relTime(s.mtime, t))
    return bits.join(' · ')
  }

  return (
    <aside
      className={cn(
        'pi-sidebar flex h-full shrink-0 flex-col border-r border-border bg-card/40',
        open ? 'w-64' : 'hidden',
      )}
      aria-label={t('common.sessions')}
    >
      <div className="pi-sidebar-head flex items-center gap-1.5 border-b border-border px-2 py-2">
        <Button
          size="sm"
          variant="secondary"
          className="flex-1 justify-start gap-1.5"
          onClick={() => command({ type: 'new_session' })}
        >
          <Plus className="size-3.5" />
          {t('sidebar.newSession')}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => void load()}
          title={t('common.refresh')}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="space-y-1.5 px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('sidebar.search')}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="inline-flex rounded-md bg-muted p-0.5 text-[11px]" role="group">
          {(['workspace', 'time'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={groupBy === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded px-2 py-0.5 transition-colors',
                groupBy === m
                  ? 'bg-popover text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'workspace' ? t('sidebar.byWorkspace') : t('sidebar.byTime')}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {filteredGroups.length === 0 && !hits.length && (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            {loading ? t('sidebar.loading') : q ? t('sidebar.noMatch') : t('sidebar.empty')}
          </div>
        )}

        {filteredGroups.map((g) => {
          const isCollapsed = collapsed.has(g.label) && !q
          const limit = q ? 60 : moreFor === g.label ? g.sessions.length : 40
          const shown = g.sessions.slice(0, limit)
          const rest = g.sessions.length - shown.length
          return (
            <div key={g.label} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(g.label)}
                aria-expanded={!isCollapsed}
                title={g.cwd || g.label}
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left hover:bg-muted/50"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[11px] font-medium',
                    g.isCurrent && 'text-teal',
                  )}
                >
                  {g.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{g.sessions.length}</span>
              </button>

              {!isCollapsed &&
                shown.map((s) => {
                  const active = !!currentFile && s.path === currentFile
                  const title =
                    s.title ||
                    s.name ||
                    s.preview ||
                    s.id ||
                    s.file ||
                    t('sidebar.untitled')
                  const tip = [
                    s.title || s.preview || '',
                    s.workspace || '',
                    s.mtime ? new Date(s.mtime).toLocaleString() : '',
                    s.turns
                      ? t('sidebar.tipStats', {
                          turns: s.turns,
                          tools: s.toolCalls || 0,
                          tokens: fmtTokens(s.tokens || 0),
                          cost: fmtCost(s.cost || 0),
                        })
                      : '',
                  ]
                    .filter(Boolean)
                    .join('\n')
                  return (
                    <button
                      key={s.path}
                      type="button"
                      onClick={() => switchTo(s.path)}
                      title={tip}
                      className={cn(
                        'flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted',
                        active && 'bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1 size-1.5 shrink-0 rounded-full',
                          active ? 'bg-teal' : 'bg-transparent',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">{title}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {rowMeta(s)}
                        </span>
                      </span>
                    </button>
                  )
                })}

              {!isCollapsed && rest > 0 && (
                <button
                  type="button"
                  onClick={() => setMoreFor(g.label)}
                  className="w-full rounded px-2 py-1 text-left text-[10px] text-muted-foreground hover:bg-muted/50"
                >
                  {t('sidebar.more', { n: rest })}
                </button>
              )}
            </div>
          )
        })}

        {hits.length > 0 && (
          <div className="mb-1">
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('sidebar.contentHits', { n: hits.length })}
            </div>
            {hits.map((h) => (
              <button
                key={h.path}
                type="button"
                onClick={() => switchTo(h.path)}
                title={h.snippet}
                className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="block truncate text-xs">{h.label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{h.snippet}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
