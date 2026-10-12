import { useState } from 'react'
import { Brain, Check, ChevronRight, Copy, GitBranch, RefreshCw, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtTokens, type ChatItem } from '@/lib/pi'
import { cacheHitRate } from '@/lib/format'
import { usePi } from '@/store/pi'
import Markdown from '@/components/markdown/Markdown'
import { ToolCard } from './ToolCard'

export function MessageBubble({
  item,
  userOrdinal,
  isLastUser,
}: {
  item: ChatItem
  userOrdinal?: number
  isLastUser?: boolean
}) {
  const { t } = usePi()

  if (item.kind === 'notice')
    return (
      <div
        className={cn(
          'mx-auto max-w-[80%] rounded-full border px-3 py-1 text-center text-xs',
          item.level === 'error'
            ? 'border-destructive/40 text-destructive'
            : item.level === 'warning'
              ? 'border-gold/50 text-foreground'
              : 'border-border text-muted-foreground',
        )}
      >
        {item.text}
      </div>
    )

  if (item.kind === 'system')
    return (
      <div className="mx-auto max-w-[85%] rounded-md border border-border bg-muted/30 px-3 py-1.5 text-center text-xs text-muted-foreground">
        {item.text}
      </div>
    )

  if (item.kind === 'user')
    return (
      <div className="flex animate-fade-in flex-col items-end gap-1">
        <div className="flex justify-end gap-2">
          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
            <div className="whitespace-pre-wrap break-words">{item.text}</div>
            {item.images > 0 && <div className="mt-1 text-[11px] opacity-70">{item.images} image(s)</div>}
          </div>
          <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <User className="size-3.5" />
          </div>
        </div>
        {(userOrdinal != null || isLastUser) && (
          <UserActions userOrdinal={userOrdinal} isLastUser={isLastUser} />
        )}
      </div>
    )

  const usage = item.usage
  const tokens = (usage?.input ?? 0) + (usage?.output ?? 0)
  const hit = cacheHitRate(usage)
  let toolN = 0
  const toolSteps = item.blocks.map((b) => (b.type === 'tool' ? ++toolN : 0))
  return (
    <div className="group animate-fade-in space-y-2">
      {item.blocks.map((b, i) => {
        if (b.type === 'text')
          return (
            <div key={i} className="text-sm leading-relaxed">
              <Markdown text={b.text} />
              {b.streaming && (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-blink bg-teal align-text-bottom" />
              )}
            </div>
          )
        if (b.type === 'thinking') return <ThinkingBlock key={i} text={b.text} streaming={b.streaming} />
        return <ToolCard key={i} tool={b} step={toolSteps[i] || undefined} />
      })}

      {item.errorMessage && (
        <div className="rounded-md border border-destructive/50 px-2.5 py-1.5 text-xs text-destructive">
          {item.errorMessage}
        </div>
      )}

      <div className="flex items-center gap-2">
        {tokens > 0 && !item.streaming && (
          <span className="text-[11px] text-muted-foreground">
            {item.stopReason || 'stop'} · in {fmtTokens(usage?.input)} / out {fmtTokens(usage?.output)}
            {hit != null ? ` · ${t('stats.cacheHit')} ${hit.toFixed(0)}%` : ''}
            {usage?.cost?.total ? ` · $${usage.cost.total.toFixed(5)}` : ''}
          </span>
        )}
        <CopyButton item={item} />
      </div>
    </div>
  )
}

function UserActions({ userOrdinal, isLastUser }: { userOrdinal?: number; isLastUser?: boolean }) {
  const { t, editLast, retryLast } = usePi()
  return (
    <div className="flex items-center gap-2 pr-8 text-[11px] text-muted-foreground">
      {userOrdinal != null && (
        <button
          type="button"
          title={t('chat.traceJumpTitle')}
          onClick={() =>
            window.dispatchEvent(new CustomEvent('pi-gui:trace-jump', { detail: { ordinal: userOrdinal } }))
          }
          className="rounded px-1.5 py-0.5 hover:bg-muted"
        >
          {t('chat.traceJump')}
        </button>
      )}
      {isLastUser && (
        <>
          <button
            type="button"
            title={t('chat.editResendTitle')}
            onClick={editLast}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
          >
            <GitBranch className="size-3" />
            {t('chat.editResend')}
          </button>
          <button
            type="button"
            title={t('chat.retryTitle')}
            onClick={retryLast}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
          >
            <RefreshCw className="size-3" />
            {t('chat.retry')}
          </button>
        </>
      )}
    </div>
  )
}

function CopyButton({ item }: { item: Extract<ChatItem, { kind: 'assistant' }> }) {
  const [copied, setCopied] = useState(false)
  const text = item.blocks
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
  if (!text.trim()) return null
  return (
    <button
      type="button"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {}
      }}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? 'copied' : 'copy'}
    </button>
  )
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-border bg-muted/30 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        <Brain className="size-3.5" />
        <span>thinking</span>
        {streaming && <span className="ml-1 size-1.5 animate-pulse rounded-full bg-teal" />}
      </button>
      {open && (
        <div className="whitespace-pre-wrap border-t border-border px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  )
}
