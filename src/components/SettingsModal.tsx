import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileCode, FileText, MessageSquarePlus, Puzzle, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { usePi } from '@/store/pi'
import { cn } from '@/lib/utils'
import {
  applyLayout,
  applyTheme,
  getLayout,
  getTheme,
  type LayoutMode,
  type ThemeMode,
} from '@/components/palette/prefs'
import {
  buildHtmlBundle,
  conversationMarkdown,
  downloadText,
  fetchRawMessages,
  type ExportMessage,
} from '@/lib/export'

export interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Settings modal.
 *
 * Sections mirror public/app.js `openSettings`:
 *   - Appearance: theme (light/dark/system) + language (en/zh)
 *   - Panels: transcript layout (compact/comfortable) → localStorage 'pi-gui-layout'
 *   - Conversation: new session, export .md, export HTML, clear
 *
 * Theme/language/layout are applied directly (theme writes `pi-gui-theme` and
 * toggles the `.dark` class, the same key App's `useTheme` uses). Window events
 * `pi-gui:set-theme`, `pi-gui:set-layout` and `pi-gui:clear-conversation` are
 * also emitted so App can stay in sync.
 */
export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    t,
    lang,
    setLang,
    command,
    onResponse,
    newSession,
    toast,
    info,
    sessionName,
    currentModel,
  } = usePi()

  const [theme, setTheme] = useState<ThemeMode>(() => getTheme())
  const [layout, setLayout] = useState<LayoutMode>(() => getLayout())
  const [busy, setBusy] = useState<'' | 'md' | 'html'>('')

  // Re-sync preferences each time the modal opens (the palette may have changed them).
  useEffect(() => {
    if (open) {
      setTheme(getTheme())
      setLayout(getLayout())
    }
  }, [open])

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

  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

  const meta = {
    sessionId: info.session,
    sessionName: sessionName || info.session,
    cwd: info.cwd,
    model: currentModel?.name || currentModel?.id,
  }

  const exportMd = async () => {
    if (busy) return
    setBusy('md')
    try {
      const messages = await fetchRawMessages(command, onResponse)
      const md = conversationMarkdown(messages)
      if (md.length < 80) {
        toast(t('toast.nothingToExport'), 'warning')
      } else {
        downloadText(`pi-gui-${stamp()}.md`, md, 'text/markdown')
        toast(t('toast.exportedMd'))
      }
    } finally {
      setBusy('')
    }
  }

  const exportHtml = async () => {
    if (busy) return
    setBusy('html')
    try {
      const messages: ExportMessage[] = await fetchRawMessages(command, onResponse)
      const html = await buildHtmlBundle(messages, meta)
      if (!html) {
        toast(t('toast.nothingToExport'), 'warning')
      } else {
        downloadText(`pi-gui-${stamp()}.html`, html, 'text/html')
        toast(t('toast.exportedHtml'))
      }
    } finally {
      setBusy('')
    }
  }

  const clearConversation = () => {
    onClose()
    window.dispatchEvent(new CustomEvent('pi-gui:clear-conversation'))
  }

  const startNew = () => {
    newSession()
    onClose()
    toast(t('chat.newSession'))
  }

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
        aria-label={t('settings.title')}
        className="flex max-h-[85vh] w-full max-w-xl animate-fade-in flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t('settings.title')}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {/* Appearance */}
          <Section label={t('settings.appearance')} hint={t('settings.appearanceHint')}>
            <div className="flex items-center gap-1">
              <Segmented
                value={theme}
                options={[
                  { value: 'light' as ThemeMode, label: 'Light' },
                  { value: 'dark' as ThemeMode, label: 'Dark' },
                  { value: 'system' as ThemeMode, label: 'System' },
                ]}
                onChange={(v) => {
                  setTheme(v)
                  applyTheme(v)
                }}
              />
            </div>
            <div className="mt-2 flex items-center gap-1">
              <Segmented
                value={lang}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'zh', label: '中文' },
                ]}
                onChange={(v) => setLang(v)}
              />
            </div>
          </Section>

          <Separator />

          {/* Panels / layout */}
          <Section label={t('settings.layout')} hint={t('settings.layoutHint')}>
            <Segmented
              value={layout}
              options={[
                { value: 'compact' as LayoutMode, label: t('settings.layoutCompact') },
                { value: 'comfortable' as LayoutMode, label: t('settings.layoutComfortable') },
              ]}
              onChange={(v) => {
                setLayout(v)
                applyLayout(v)
              }}
            />
          </Section>

          <Separator />

          {/* Extensions */}
          <Section label={t('ext.title')}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onClose()
                window.dispatchEvent(new CustomEvent('pi-gui:open-extensions'))
              }}
            >
              <Puzzle className="size-4" />
              {t('ext.title')}
            </Button>
          </Section>

          <Separator />

          {/* Conversation */}
          <Section label={t('settings.conversation')} hint={t('settings.conversationHint')}>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={startNew}>
                <MessageSquarePlus className="size-4" />
                {t('common.new')}
              </Button>
              <Button variant="outline" size="sm" onClick={exportMd} disabled={busy !== ''}>
                <FileText className="size-4" />
                {t('settings.exportMd')}
              </Button>
              <Button variant="outline" size="sm" onClick={exportHtml} disabled={busy !== ''}>
                <FileCode className="size-4" />
                {t('palette.exportHtml')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={clearConversation}
              >
                <Trash2 className="size-4" />
                {t('common.clear')}
              </Button>
            </div>
          </Section>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Section({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            o.value === value
              ? 'bg-popover text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
