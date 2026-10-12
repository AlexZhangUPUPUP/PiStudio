import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { usePi } from '@/store/pi'
import { cn } from '@/lib/utils'

/** Built-ins that can touch the system; the reference client calls this "full access". */
const FULL_ACCESS = new Set(['bash', 'powershell', 'write', 'edit'])

export function ToolsBadge() {
  const { t, activeTools, toolSchemas } = usePi()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const count = activeTools.length
  const risky = activeTools.filter((n) => FULL_ACCESS.has(n))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('perm.title')}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-muted/60"
      >
        <ShieldCheck className={cn('size-4', risky.length ? 'text-gold' : 'text-teal')} />
        <span className="text-muted-foreground">{count}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-lg border border-border bg-popover p-2 shadow-lg">
          <div className="flex items-center gap-2 px-1.5 pb-1.5">
            <span className="text-xs font-medium">{t('perm.title')}</span>
            <span className="ml-auto rounded bg-gold/20 px-1.5 py-0.5 text-[10px] text-foreground">
              {t('perm.full')}
            </span>
          </div>

          <div className="mb-1 px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {count} {t('perm.activeTools')}
          </div>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {activeTools.length === 0 && (
              <div className="px-1.5 py-1 text-[11px] text-muted-foreground">{t('ext.none')}</div>
            )}
            {activeTools.map((name) => {
              const schema = toolSchemas[name]
              return (
                <div key={name} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/50">
                  <span className="font-mono text-[11px]">{name}</span>
                  {FULL_ACCESS.has(name) && (
                    <span className="rounded bg-gold/20 px-1 text-[9px] text-foreground">{t('perm.full')}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground">
                    {schema?.description || ''}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="mt-1.5 border-t border-border px-1.5 pt-1.5 text-[10px] text-muted-foreground">
            {t('perm.note')}
          </div>
        </div>
      )}
    </div>
  )
}
