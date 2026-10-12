import { useState } from 'react'
import { Check, ChevronRight, Loader2, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AssBlock } from '@/lib/pi'

type Tool = Extract<AssBlock, { type: 'tool' }>

export function ToolCard({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false)
  const running = tool.status === 'streaming' || tool.status === 'running' || tool.status === 'pending'

  const argPreview = (() => {
    try {
      const a = tool.args as Record<string, unknown> | undefined
      if (!a) return tool.argsText?.split('\n')[0] || ''
      const p = a.path || a.file || a.command || a.pattern
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
        <span className="font-mono text-xs font-medium">{tool.name || 'tool'}</span>
        {argPreview && (
          <span className="truncate font-mono text-xs text-muted-foreground">{argPreview}</span>
        )}
        <span className="ml-auto shrink-0">
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
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">args</div>
            <pre className="max-h-64 overflow-auto rounded bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
              {tool.argsText || '—'}
            </pre>
          </div>
          {tool.result != null && tool.result !== '' && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">output</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
