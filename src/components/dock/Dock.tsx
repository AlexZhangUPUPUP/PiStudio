import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { usePi } from '@/store/pi'
import { cn } from '@/lib/utils'
import { TracePanel } from './TracePanel'
import { ChangesPanel } from './ChangesPanel'
import { ContextPanel } from './ContextPanel'

type DockTab = 'trace' | 'changes' | 'context'

interface DockProps {
  open: boolean
  tab: DockTab
  onTab: (t: DockTab) => void
  onClose: () => void
}

const DOCK_KEY = 'pi-gui-dock'
const DOCK_MIN = 320
const DOCK_MAX = 820

function loadWidth(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_KEY) || '{}')
    return Math.min(DOCK_MAX, Math.max(DOCK_MIN, Number(raw.width) || 420))
  } catch {
    return 420
  }
}

const TABS: { key: DockTab; label: string }[] = [
  { key: 'trace', label: 'dock.trace' },
  { key: 'changes', label: 'dock.changes' },
  { key: 'context', label: 'dock.context' },
]

export default function Dock({ open, tab, onTab, onClose }: DockProps) {
  const { t } = usePi()
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)

  const clampWidth = useCallback(
    (px: number) => Math.min(DOCK_MAX, Math.max(DOCK_MIN, Math.round(px))),
    [],
  )

  useEffect(() => {
    try {
      localStorage.setItem(DOCK_KEY, JSON.stringify({ width, tab }))
    } catch {
      /* ignore */
    }
  }, [width, tab])

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    ev.preventDefault()
    handleRef.current?.setPointerCapture(ev.pointerId)
    setDragging(true)
  }

  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setWidth(clampWidth(window.innerWidth - ev.clientX - 8))
  }

  const stopDrag = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    try {
      handleRef.current?.releasePointerCapture(ev.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === 'ArrowLeft') {
      ev.preventDefault()
      setWidth((w) => clampWidth(w + 24))
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault()
      setWidth((w) => clampWidth(w - 24))
    }
  }

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-l border-border bg-background',
        !open && 'hidden',
        dragging && 'select-none',
      )}
      style={{ width }}
      aria-label="Dock"
    >
      <div
        ref={handleRef}
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        title={t('dock.resize')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onKeyDown={onKeyDown}
        className={cn(
          'absolute -left-1 top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors',
          dragging ? 'bg-teal/70' : 'bg-transparent hover:bg-teal/40',
        )}
      />

      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            role="tab"
            aria-selected={tab === tb.key}
            onClick={() => onTab(tb.key)}
            className={cn(
              'rounded px-2 py-0.5 text-[12px] font-medium transition-colors',
              tab === tb.key
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            {t(tb.label)}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          title={t('common.close')}
          aria-label={t('common.close')}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* All panels stay mounted so the trace keeps ingesting events even when hidden. */}
      <div className="relative min-h-0 flex-1">
        <div className={cn('h-full', tab !== 'trace' && 'hidden')}>
          <TracePanel />
        </div>
        <div className={cn('h-full', tab !== 'changes' && 'hidden')}>
          <ChangesPanel />
        </div>
        <div className={cn('h-full', tab !== 'context' && 'hidden')}>
          <ContextPanel />
        </div>
      </div>
    </aside>
  )
}
