import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { usePi } from '@/store/pi'
import { fmtCost, fmtTokens, cacheHitRate } from '@/lib/format'

export function StatusBar() {
  const { t, info, proc, connected, streaming, runAction, stats, extStatus, queue, runStartedAt, lastTps } =
    usePi()
  const [, tick] = useState(0)

  useEffect(() => {
    if (!runStartedAt) return
    const id = window.setInterval(() => tick((x) => x + 1), 200)
    return () => window.clearInterval(id)
  }, [runStartedAt])

  const dot =
    proc.state === 'error' || proc.state === 'exited'
      ? 'bg-destructive'
      : connected && proc.state === 'running'
        ? 'bg-teal'
        : 'bg-gold'

  const secs = runStartedAt ? ((Date.now() - runStartedAt) / 1000).toFixed(1) : ''
  const runState = runStartedAt
    ? `${t('run.' + (runAction || 'working'))}${secs ? ` · ${secs}s` : ''}`
    : streaming
      ? t('status.working')
      : ''

  const queued = queue.steer + queue.follow
  const ext = Object.values(extStatus).filter(Boolean).join('  ·  ')

  const tok = stats?.tokens || {}
  const cost = stats?.cost ?? 0
  const cu = stats?.contextUsage
  const hit = cacheHitRate(tok)
  const turns = stats?.userMessages ?? 0
  const steps = stats?.toolCalls ?? 0

  const parts: string[] = []
  if (hit != null) parts.push(`${t('stats.cacheHit')} ${hit.toFixed(1)}%`)
  if (lastTps > 0) parts.push(`${Math.round(lastTps)} tok/s`)
  if (turns || steps) parts.push(t('stats.steps', { turns, steps }))
  parts.push(`${fmtTokens(tok.total)} ${t('stats.tokens')}`)
  if (cost > 0) parts.push(fmtCost(cost))
  if (cu && cu.percent != null) parts.push(t('stats.ctx', { pct: Math.round(cu.percent) }))
  const statsText = parts.join(' · ')

  const statsTitle =
    hit != null
      ? [
          `input ${tok.input ?? 0}`,
          `cache read ${tok.cacheRead ?? 0}`,
          `cache write ${tok.cacheWrite ?? 0}`,
          `output ${tok.output ?? 0}`,
          `cache hit ${hit.toFixed(1)}%`,
        ].join(' · ')
      : ''

  return (
    <div className="pi-statusbar flex items-center gap-3 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cn('size-2 rounded-full', dot)} />
        {proc.state === 'error'
          ? t('status.piFailed', { msg: proc.message || '' })
          : proc.state === 'exited'
            ? t('status.piExited', { code: proc.code ?? '-' })
            : proc.state === 'running'
              ? t('status.piRunning', { pid: proc.pid ?? '?' })
              : t('status.ready')}
      </span>
      {runState && (
        <>
          <span className="text-border">|</span>
          <span className={cn(streaming && 'text-teal')}>{runState}</span>
        </>
      )}
      {queued > 0 && (
        <>
          <span className="text-border">|</span>
          <span className="text-gold">
            {t('status.queued', { steer: queue.steer, follow: queue.follow })}
          </span>
        </>
      )}
      {ext && (
        <>
          <span className="text-border">|</span>
          <span>{ext}</span>
        </>
      )}
      <span className="ml-auto truncate" title={statsTitle}>
        {statsText}
      </span>
      <span className="text-border">|</span>
      <span className={cn(connected ? '' : 'text-destructive')}>
        {connected ? t('status.connected') : t('status.disconnected')}
      </span>
    </div>
  )
}
