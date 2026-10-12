import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Package, Puzzle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { usePi } from '@/store/pi'
import { apiUrl } from '@/lib/pi'
import { cn } from '@/lib/utils'

interface GuiExt {
  key: string
  path: string
  enabled: boolean
  exists: boolean
}
interface DiscoveredExt {
  scope: string
  name: string
  path: string
  kind: string
}
interface ExtData {
  gui: GuiExt[]
  discovered: DiscoveredExt[]
  settings: { extensions: string[]; packages: string[] }
  cwd: string
}

export interface ExtensionsModalProps {
  open: boolean
  onClose: () => void
}

export default function ExtensionsModal({ open, onClose }: ExtensionsModalProps) {
  const { t, toast, commands, toolSchemas, activeTools } = usePi()
  const [data, setData] = useState<ExtData | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await fetch(apiUrl('/api/extensions')).then((r) => r.json()))
    } catch {
      setData(null)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

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

  const toggle = async (ext: GuiExt) => {
    setBusy(ext.key)
    try {
      await fetch(apiUrl('/api/extensions/toggle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: ext.key, enabled: !ext.enabled }),
      })
      toast(`${ext.key}: ${!ext.enabled ? 'on' : 'off'}`)
      await load()
    } finally {
      setBusy('')
    }
  }

  const toolNames = Object.keys(toolSchemas)
  const activeSet = new Set(activeTools)

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
        aria-label={t('ext.title')}
        className="flex max-h-[85vh] w-full max-w-2xl animate-fade-in flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Puzzle className="size-4 text-teal" />
            {t('ext.title')}
          </h2>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label={t('common.close')}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3 text-sm">
          {/* Built-in GUI extensions */}
          <SectionLabel>{t('ext.gui')}</SectionLabel>
          {(data?.gui || []).map((ext) => (
            <div key={ext.key} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs">{ext.key}</div>
                <div className="truncate text-[11px] text-muted-foreground" title={ext.path}>
                  {ext.path}
                </div>
              </div>
              <Switch
                on={ext.enabled && ext.exists}
                disabled={!ext.exists || busy === ext.key}
                onToggle={() => void toggle(ext)}
              />
            </div>
          ))}
          <div className="px-1 text-[11px] text-muted-foreground">{t('ext.restartHint')}</div>

          <Separator className="my-2" />

          {/* Auto-discovered */}
          <SectionLabel>{t('ext.discovered')}</SectionLabel>
          {(data?.discovered || []).length === 0 && (
            <div className="px-1 text-xs text-muted-foreground">{t('ext.none')}</div>
          )}
          {(data?.discovered || []).map((ext) => (
            <button
              key={ext.path}
              type="button"
              title={`${ext.path}\n(${ext.scope})`}
              onClick={() => void navigator.clipboard?.writeText(ext.path)}
              className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-left hover:bg-muted"
            >
              <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{ext.scope}</span>
              <span className="min-w-0 flex-1 truncate text-xs">{ext.name}</span>
              <span className="truncate text-[10px] text-muted-foreground">{ext.path}</span>
            </button>
          ))}

          <Separator className="my-2" />

          {/* From settings.json */}
          <SectionLabel>{t('ext.settingsPaths')}</SectionLabel>
          {[...(data?.settings.extensions || []), ...(data?.settings.packages || [])].length === 0 ? (
            <div className="px-1 text-xs text-muted-foreground">{t('ext.none')}</div>
          ) : (
            <div className="space-y-1">
              {(data?.settings.extensions || []).map((p) => (
                <PathRow key={p} path={p} kind="ext" />
              ))}
              {(data?.settings.packages || []).map((p) => (
                <PathRow key={p} path={p} kind="pkg" />
              ))}
            </div>
          )}

          <Separator className="my-2" />

          {/* Registered commands + tools */}
          <SectionLabel>
            {t('ext.title')} · {commands.length} {t('ext.commands')} · {toolNames.length} {t('ext.tools')}
          </SectionLabel>
          <div className="flex flex-wrap gap-1">
            {commands.slice(0, 40).map((c) => (
              <span key={`c:${c.name}`} title={c.description || ''} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                /{c.name.replace(/^\//, '')}
              </span>
            ))}
            {toolNames.slice(0, 60).map((n) => (
              <span
                key={`t:${n}`}
                title={toolSchemas[n]?.description || ''}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px]',
                  activeSet.has(n) ? 'bg-teal/15 text-teal' : 'bg-muted text-muted-foreground line-through',
                )}
              >
                {n}
              </span>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" onClick={() => void load()}>
            {t('common.refresh')}
          </Button>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-1 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

function PathRow({ path, kind }: { path: string; kind: 'ext' | 'pkg' }) {
  return (
    <button
      type="button"
      title={path}
      onClick={() => void navigator.clipboard?.writeText(path)}
      className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-left hover:bg-muted"
    >
      <Package className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{kind}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{path}</span>
    </button>
  )
}

function Switch({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40',
        on ? 'bg-teal' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full bg-background transition-transform',
          on ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
