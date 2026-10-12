import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { usePi } from '@/store/pi'
import { cn } from '@/lib/utils'

export function ModelPicker() {
  const { t, models, thinkingLevels, currentModel, currentThinking, setModel, setThinking } = usePi()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const currentKey = currentModel ? `${currentModel.provider}/${currentModel.id}` : ''
  const currentName =
    currentModel?.name || (currentKey ? currentKey : '…')

  useEffect(() => {
    if (!open) return
    const onDoc = (ev: MouseEvent) => {
      if (!ref.current?.contains(ev.target as Node)) setOpen(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const modelItems = useMemo(
    () =>
      models.map((m) => {
        const key = `${m.provider}/${m.id}`
        return { key, label: m.name || key }
      }),
    [models],
  )

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${t('toolbar.pickerTitle')}\n${currentKey} · ${currentThinking || '—'}`}
        className="flex max-w-[320px] items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/50"
      >
        <span className="truncate font-medium">{currentName}</span>
        <span className="text-muted-foreground">·</span>
        <span className="shrink-0 text-muted-foreground">{currentThinking || '—'}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 flex w-[440px] gap-2 rounded-lg border border-border bg-popover p-2 shadow-lg">
          <div className="min-w-0 flex-1">
            <div className="px-1.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('toolbar.model')}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {modelItems.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">—</div>
              )}
              {modelItems.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="option"
                  aria-selected={m.key === currentKey}
                  onClick={() => {
                    setModel(m.key)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted',
                    m.key === currentKey && 'bg-muted/60',
                  )}
                  title={m.label}
                >
                  <span className="min-w-0 flex-1 truncate">{m.label}</span>
                  {m.key === currentKey && <Check className="size-3.5 shrink-0 text-teal" />}
                </button>
              ))}
            </div>
          </div>
          <div className="w-32 shrink-0 border-l border-border pl-2">
            <div className="px-1.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('toolbar.thinking')}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {thinkingLevels.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="option"
                  aria-selected={l === currentThinking}
                  onClick={() => {
                    setThinking(l)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted',
                    l === currentThinking && 'bg-muted/60',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{l}</span>
                  {l === currentThinking && <Check className="size-3.5 shrink-0 text-teal" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
