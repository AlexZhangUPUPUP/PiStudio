import { useEffect, useState } from 'react'
import { Check, ChevronRight, Loader2, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtDur } from '@/lib/format'
import type { AssBlock } from '@/lib/pi'
import { usePi } from '@/store/pi'

type Tool = Extract<AssBlock, { type: 'tool' }>

function useNow(active: boolean) {
  const [, force] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => force((x) => x + 1), 200)
    return () => window.clearInterval(id)
  }, [active])
}

export function ToolCard({ tool, step }: { tool: Tool; step?: number }) {
  const { t, toolSchemas } = usePi()
  const [open, setOpen] = useState(false)

  const running = tool.status === 'streaming' || tool.status === 'running' || tool.status === 'pending'
  useNow(running)

  const durationMs =
    tool.startedAt != null
      ? (tool.endedAt ?? Date.now()) - tool.startedAt
      : null

  const statusLabel = tool.isError
    ? t('tool.error')
    : tool.status === 'running'
      ? t('tool.running')
      : tool.status === 'streaming' || tool.status === 'pending'
        ? t('tool.pending')
        : t('tool.done')

  const schema = tool.name ? toolSchemas[tool.name]?.parameters : undefined
  const schemaText = schema ? JSON.stringify(schema, null, 2) : ''

  const argPreview = (() => {
    try {
      const a = tool.args as Record<string, unknown> | undefined
      if (!a) return tool.argsText?.split('\n')[0] || ''
      const p = a.path || a.file || a.command || a.pattern || a.query
      return typeof p === 'string' ? p : ''
    } catch {
      return ''
    }
  })()

  return (
    <div
      className={cn(
        'rounded-md border bg-card/60 text-sm',
        tool.isError ? 'border-destructive/50' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs font-medium">{tool.name || t('label.tool')}</span>
        {argPreview && (
          <span className="truncate font-mono text-xs text-muted-foreground">{argPreview}</span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {step ? (
            <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
              {t('tool.step', { n: step })}
            </span>
          ) : null}
          {durationMs != null && (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {fmtDur(durationMs)}
            </span>
          )}
          {running ? (
            <Loader2 className="size-3.5 animate-spin text-teal" />
          ) : tool.isError ? (
            <X className="size-3.5 text-destructive" />
          ) : (
            <Check className="size-3.5 text-teal" />
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>
              {t('tool.status')}: <span className={cn(tool.isError && 'text-destructive')}>{statusLabel}</span>
            </span>
            {durationMs != null && (
              <span>
                {t('tool.timing')}: <span className="font-mono tabular-nums">{fmtDur(durationMs)}</span>
              </span>
            )}
          </div>

          <Section label={t('trace.detail.args')} text={tool.argsText || '—'} />

          {tool.result != null && tool.result !== '' && (
            <Section label={t('trace.detail.output')} text={tool.result} wrap />
          )}

          {schemaText && <Section label={t('tool.schema')} text={schemaText} />}
        </div>
      )}
    </div>
  )
}

function Section({ label, text, wrap }: { label: string; text: string; wrap?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre
        className={cn(
          'max-h-80 overflow-auto rounded bg-muted/60 p-2 font-mono text-[11px] leading-relaxed',
          wrap && 'whitespace-pre-wrap',
        )}
      >
        {text}
      </pre>
    </div>
  )
}
