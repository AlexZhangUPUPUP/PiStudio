import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { usePi } from '@/store/pi'
import { cn } from '@/lib/utils'

/**
 * Bottom-right toast stack. Toasts are queued in the store (see `store.toast`)
 * and auto-dismissed there; each entry here just renders with a manual dismiss
 * button wired to `dismissToast`.
 */
export default function Toasts() {
  const { toasts, dismissToast } = usePi()

  if (!toasts.length) return null

  return createPortal(
    <div className="fixed bottom-12 right-5 z-[60] flex max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'flex animate-fade-in items-start gap-2 rounded-lg border border-border bg-popover px-3.5 py-2.5 text-sm text-foreground shadow-md',
            t.type === 'error'
              ? 'border-l-4 border-l-destructive'
              : t.type === 'warning'
                ? 'border-l-4 border-l-gold'
                : 'border-l-4 border-l-teal',
          )}
        >
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
