import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { usePi } from '@/store/pi'
import { fmtCost, fmtTokens } from '@/lib/format'

export function StatusBar() {
  const { t, info, proc, connected, streaming, runAction, stats, extStatus, queue, runStartedAt } =
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

  const tokens = stats?.tokens?.total ?? 0
  const cost = stats?.cost ?? 0
  const cu = stats?.contextUsage
  let statsText = `${fmtTokens(tokens)} ${t('stats.tokens')} · ${fmtCost(cost)}`
  if (cu && cu.percent != null) statsText += ` · ${t('stats.ctx', { pct: Math.round(cu.percent) })}`

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
      <span className="ml-auto truncate" title={statsText}>
        {statsText}
      </span>
      <span className="text-border">|</span>
      <span className={cn(connected ? '' : 'text-destructive')}>
        {connected ? t('status.connected') : t('status.disconnected')}
      </span>
    </div>
  )
}
