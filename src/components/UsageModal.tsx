import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePi } from '@/store/pi'
import { cn } from '@/lib/utils'
import { fmtCost, fmtTokens } from '@/lib/tasks'
import {
  getIndexStatus,
  getRuns,
  getUsage,
  type IndexStatus,
  type RunRecord,
  type UsageRange,
  type UsageResponse,
  type UsageSeriesPoint,
} from '@/lib/usage'

export interface UsageModalProps {
  open: boolean
  onClose: () => void
}

interface BucketRow {
  key: string
  label: string
  cost: number
  tokens: number
  turns: number
  count: number
}

const RANGES: Array<{ value: UsageRange; labelKey: string }> = [
  { value: 7, labelKey: 'usage.range7' },
  { value: 30, labelKey: 'usage.range30' },
  { value: 90, labelKey: 'usage.range90' },
]

/**
 * Usage / spend dashboard.
 *
 * Reads the server's usage index (see `src/lib/usage.ts`). The daily chart is
 * plain divs (no chart library) and the two breakdown tables are sorted by cost
 * descending. Index availability is reported in the footer.
 */
export default function UsageModal({ open, onClose }: UsageModalProps) {
  const { t } = usePi()
  const [range, setRange] = useState<UsageRange>(7)
  const [data, setData] = useState<UsageResponse | null>(null)
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [runs, setRuns] = useState<RunRecord[]>([])

  // Re-fetch whenever the modal opens or the range changes.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const [usage, idx, recentRuns] = await Promise.all([
        getUsage(range),
        getIndexStatus(),
        getRuns(),
      ])
      if (cancelled) return
      setData(usage)
      setStatus(idx)
      setRuns(recentRuns)
    })()
    return () => {
      cancelled = true
    }
  }, [open, range])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const totals = data?.totals
  const modelRows: BucketRow[] = (data?.byModel || [])
    .map((b) => ({ key: b.key, label: b.key, cost: b.cost, tokens: b.tokens, turns: b.turns, count: b.count }))
    .sort((a, b) => b.cost - a.cost)
  const workspaceRows: BucketRow[] = (data?.byWorkspace || [])
    .map((b) => ({ key: b.key, label: b.label || b.key, cost: b.cost, tokens: b.tokens, turns: b.turns, count: b.count }))
    .sort((a, b) => b.cost - a.cost)

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('usage.title')}
        className="flex max-h-[85vh] w-full max-w-2xl animate-fade-in flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{t('usage.title')}</h2>
            <p className="text-[11px] text-muted-foreground">{t('usage.subtitle')}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <Segmented
              value={range}
              options={RANGES.map((r) => ({ value: r.value, label: t(r.labelKey) }))}
              onChange={(v) => setRange(v)}
            />
            <span className="text-[11px] text-muted-foreground">{t('usage.vsPrev')}</span>
          </div>

          {!data ? (
            <div className="py-10 text-center text-sm text-muted-foreground">…</div>
          ) : (
            <div className="mt-3 space-y-4">
              {/* totals */}
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                <Stat
                  label={t('usage.cost')}
                  value={fmtCost(totals?.cost || 0)}
                  accent
                  delta={<Delta cur={totals?.cost || 0} prev={data.prev?.cost || 0} />}
                />
                <Stat
                  label={t('usage.tokens')}
                  value={fmtTokens(totals?.tokens || 0)}
                  delta={<Delta cur={totals?.tokens || 0} prev={data.prev?.tokens || 0} />}
                />
                <Stat
                  label={t('usage.turns')}
                  value={String(totals?.turns || 0)}
                  delta={<Delta cur={totals?.turns || 0} prev={data.prev?.turns || 0} />}
                />
                <Stat label={t('usage.sessions')} value={String(totals?.sessions || 0)} />
                <Stat label={t('usage.tasks')} value={String(totals?.tasks || 0)} />
              </div>

              {/* daily bars */}
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('usage.daily')}</h3>
                <DailyChart series={data.series} />
              </div>

              {/* breakdowns */}
              <BucketTable title={t('usage.byModel')} rows={modelRows} />
              <BucketTable title={t('usage.byWorkspace')} rows={workspaceRows} />

              {/* recent runs */}
              {runs.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    {t('usage.recentRuns')}
                  </h3>
                  <RunsTable runs={runs} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          {status ? (
            status.available ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-1 text-teal">
                  <span className="size-1.5 rounded-full bg-teal" />
                  {t('usage.indexOn')}
                </span>
                <span className="max-w-[320px] truncate font-mono" title={status.db}>
                  {t('usage.db')}: {status.db}
                </span>
                <span>
                  {t('usage.sessions')}: {status.sessions}
                </span>
                <span>
                  {t('usage.runs')}: {status.runs}
                </span>
                <span>
                  {t('usage.tasks')}: {status.tasks}
                </span>
              </div>
            ) : (
              <span>{t('usage.indexOff')}</span>
            )
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            o.value === value
              ? 'bg-popover text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  delta,
}: {
  label: string
  value: string
  accent?: boolean
  delta?: ReactNode
}) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={cn('text-sm font-semibold', accent && 'text-teal')}>{value}</span>
        {delta}
      </div>
    </div>
  )
}

/** Percentage change vs the previous window. Nothing is rendered when there is no baseline. */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return null
  const pct = ((cur - prev) / prev) * 100
  const rounded = Math.round(pct)
  if (rounded === 0) {
    return <span className="text-[10px] text-muted-foreground">→ 0%</span>
  }
  if (rounded > 0) {
    return <span className="text-[10px] font-medium text-destructive">↑ {rounded}%</span>
  }
  return <span className="text-[10px] font-medium text-teal">↓ {Math.abs(rounded)}%</span>
}

function DailyChart({ series }: { series: UsageSeriesPoint[] }) {
  const { t } = usePi()
  if (!series.length) {
    return <div className="rounded-md border border-border bg-muted/40 py-6 text-center text-sm text-muted-foreground">{t('usage.empty')}</div>
  }

  const max = series.reduce((m, p) => Math.max(m, p.cost || 0), 0)
  const step = Math.max(1, Math.ceil(series.length / 6))

  return (
    <div className="rounded-md border border-border bg-muted/40 px-2 pb-2 pt-3">
      <div className="flex h-24 items-end gap-1">
        {series.map((p) => {
          const h = max > 0 ? Math.max(3, Math.round(((p.cost || 0) / max) * 96)) : 3
          return (
            <div
              key={p.key}
              title={`${p.key} · ${fmtCost(p.cost || 0)}`}
              className={cn('flex-1 rounded-t', p.cost > 0 ? 'bg-teal/80' : 'bg-muted')}
              style={{ height: `${h}px` }}
            />
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-1 text-[10px] text-muted-foreground">
        {series.map((p, i) => (
          <div key={p.key} className="min-w-0 flex-1 truncate text-center">
            {i === 0 || i === series.length - 1 || i % step === 0 ? p.key.slice(5) : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

function BucketTable({ title, rows }: { title: string; rows: BucketRow[] }) {
  const { t } = usePi()
  if (!rows.length) {
    return <div className="rounded-md border border-border bg-muted/40 py-4 text-center text-sm text-muted-foreground">{t('usage.empty')}</div>
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">{title}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t('usage.cost')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t('usage.tokens')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t('usage.turns')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t('usage.count')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border/60">
              <td className="max-w-[180px] truncate px-2 py-1 font-medium" title={r.label}>
                {r.label}
              </td>
              <td className={cn('px-2 py-1 text-right', r.cost > 0 && 'text-teal')}>{fmtCost(r.cost)}</td>
              <td className="px-2 py-1 text-right">{fmtTokens(r.tokens)}</td>
              <td className="px-2 py-1 text-right">{r.turns}</td>
              <td className="px-2 py-1 text-right">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RunsTable({ runs }: { runs: RunRecord[] }) {
  const { t } = usePi()
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-[11px]">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            {/* when / duration / model / status have no usage.* or common.* key, so
                only the numeric columns get text headers (per i18n key constraint). */}
            <th className="px-2 py-1.5 text-left font-medium" />
            <th className="px-2 py-1.5 text-right font-medium" />
            <th className="px-2 py-1.5 text-left font-medium" />
            <th className="px-2 py-1.5 text-right font-medium">{t('usage.tokens')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t('usage.cost')}</th>
            <th className="px-2 py-1.5 text-right font-medium" />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runFile} className="border-t border-border/60">
              <td className="whitespace-nowrap px-2 py-1 font-mono text-muted-foreground">
                {fmtWhen(r.startedAt)}
              </td>
              <td className="whitespace-nowrap px-2 py-1 text-right text-muted-foreground">
                {fmtDuration(r.startedAt, r.endedAt)}
              </td>
              <td className="max-w-[180px] truncate px-2 py-1 font-medium" title={r.model || undefined}>
                {r.model || '—'}
              </td>
              <td className="px-2 py-1 text-right">{fmtTokens(r.tokens)}</td>
              <td className={cn('px-2 py-1 text-right', r.cost > 0 && 'text-teal')}>{fmtCost(r.cost)}</td>
              <td className="px-2 py-1 text-right">
                <span
                  className={cn(
                    r.status === 'failed' || r.status === 'error'
                      ? 'text-destructive'
                      : r.status === 'done'
                        ? 'text-teal'
                        : 'text-muted-foreground',
                  )}
                >
                  {r.status || '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtWhen(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtDuration(startedAt: number, endedAt: number | null): string {
  if (!startedAt || !endedAt) return '—'
  const ms = Math.max(0, endedAt - startedAt)
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m${s}s`
}
