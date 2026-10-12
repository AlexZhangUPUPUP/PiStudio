/**
 * Command palette (⌘/Ctrl+K).
 *
 * A modal list of actions with fuzzy filtering and keyboard navigation
 * (ArrowUp/ArrowDown/Enter/Escape). Most actions use the React store directly;
 * actions owned by App are dispatched as CustomEvents on `window` so App can
 * wire them up:
 *
 *   - `pi-gui:open-settings`    open the Settings modal
 *   - `pi-gui:open-sessions`    open the sessions panel
 *   - `pi-gui:open-trace`       open/toggle the trace dock
 *   - `pi-gui:open-changes`     open/toggle the changes dock
 *   - `pi-gui:open-context`     open/toggle the context dock
 *   - `pi-gui:toggle-sidebar`   collapse/expand the session sidebar
 *
 * Theme is applied directly (via `prefs.cycleTheme`, which writes the same
 * `pi-gui-theme` key App's `useTheme` uses and toggles `.dark`), and emits an
 * informational `pi-gui:set-theme` event so App can sync. Diagnostics are
 * rendered locally with `InfoModal`; exports go through `src/lib/export.ts`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { usePi } from '@/store/pi'
import { cn } from '@/lib/utils'
import { apiUrl } from '@/lib/pi'
import { fmtDur } from '@/lib/format'
import { cycleTheme, getTheme } from '@/components/palette/prefs'
import {
  buildHtmlBundle,
  conversationMarkdown,
  downloadText,
  fetchRawMessages,
  type ExportMessage,
} from '@/lib/export'
import InfoModal from '@/components/InfoModal'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

interface Action {
  label: string
  hint: string
  run: () => void
}

interface DiagData {
  diag: Record<string, any>
  info: Record<string, any>
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const {
    t,
    lang,
    setLang,
    command,
    onResponse,
    newSession,
    abort,
    restart,
    toast,
    items,
    info,
    sessionName,
    currentModel,
  } = usePi()

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [diag, setDiag] = useState<DiagData | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset + focus every time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setDiag(null)
      const id = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [open])

  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

  const copyConversation = async () => {
    const text = items
      .map((it) => {
        if (it.kind === 'user') return `## ${t('role.user')}\n${it.text}`
        if (it.kind === 'assistant') {
          const body = it.blocks
            .map((b) => {
              if (b.type === 'text') return b.text
              if (b.type === 'thinking') return `> _thinking_\n> ${b.text.replace(/\n/g, '\n> ')}`
              if (b.type === 'tool') return `**tool: ${b.name || 'tool'}**\n${b.result || b.argsText || ''}`
              return ''
            })
            .filter(Boolean)
            .join('\n\n')
          return `## ${t('role.assistant')}\n${body}`
        }
        if (it.kind === 'system') return `> [custom] ${it.text}`
        if (it.kind === 'notice') return `> ${it.text}`
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      toast(t('common.copied'), 'success')
    } catch {
      toast(t('common.copyTitle'), 'warning')
    }
  }

  const openDiagnostics = async () => {
    onClose()
    let diagData: Record<string, any> = {}
    let infoData: Record<string, any> = {}
    try {
      ;[diagData, infoData] = await Promise.all([
        fetch(apiUrl('/api/diagnostics')).then((r) => r.json()),
        fetch(apiUrl('/api/info')).then((r) => r.json()),
      ])
    } catch {
      /* keep empty on failure */
    }
    setDiag({ diag: diagData, info: infoData })
  }

  const exportMd = async () => {
    const messages = await fetchRawMessages(command, onResponse)
    const md = conversationMarkdown(messages)
    if (md.length < 80) {
      toast(t('toast.nothingToExport'), 'warning')
    } else {
      downloadText(`pi-gui-${stamp()}.md`, md, 'text/markdown')
      toast(t('toast.exportedMd'))
    }
  }

  const exportHtml = async () => {
    const messages: ExportMessage[] = await fetchRawMessages(command, onResponse)
    const html = await buildHtmlBundle(messages, {
      sessionId: info.session,
      sessionName: sessionName || info.session,
      cwd: info.cwd,
      model: currentModel?.name || currentModel?.id,
    })
    if (!html) {
      toast(t('toast.nothingToExport'), 'warning')
    } else {
      downloadText(`pi-gui-${stamp()}.html`, html, 'text/html')
      toast(t('toast.exportedHtml'))
    }
  }

  const actions: Action[] = useMemo(
    () => [
      { label: t('palette.newSession'), hint: '', run: () => { newSession(); toast(t('chat.newSession')) } },
      {
        label: t('palette.restart'),
        hint: '',
        run: () => {
          restart()
          toast(t('diag.restarting'))
        },
      },
      { label: t('common.stop'), hint: 'abort', run: () => abort() },
      { label: t('palette.theme'), hint: getTheme(), run: () => cycleTheme() },
      {
        label: t('palette.language'),
        hint: lang,
        run: () => setLang(lang === 'zh' ? 'en' : 'zh'),
      },
      { label: t('palette.sessions'), hint: '', run: () => window.dispatchEvent(new CustomEvent('pi-gui:open-sessions')) },
      { label: t('dock.trace'), hint: t('palette.trace'), run: () => window.dispatchEvent(new CustomEvent('pi-gui:open-trace')) },
      { label: t('dock.changes'), hint: t('palette.changes'), run: () => window.dispatchEvent(new CustomEvent('pi-gui:open-changes')) },
      { label: t('palette.context'), hint: '', run: () => window.dispatchEvent(new CustomEvent('pi-gui:open-context')) },
      { label: t('palette.export'), hint: '.md', run: () => void exportMd() },
      { label: t('palette.exportHtml'), hint: '.html', run: () => void exportHtml() },
      { label: t('common.copy'), hint: t('settings.conversation'), run: () => void copyConversation() },
      { label: t('sidebar.toggle'), hint: '', run: () => window.dispatchEvent(new CustomEvent('pi-gui:toggle-sidebar')) },
      { label: t('settings.title'), hint: '', run: () => window.dispatchEvent(new CustomEvent('pi-gui:open-settings')) },
      { label: t('palette.diagnostics'), hint: '', run: () => void openDiagnostics() },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, lang, newSession, restart, abort, setLang, items, info, sessionName, currentModel, command, onResponse, toast],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    const scored = actions
      .map((a) => {
        const hay = `${a.label} ${a.hint}`.toLowerCase()
        let score = -1
        if (hay.startsWith(q)) score = 3
        else if (hay.includes(q)) score = 2
        else if (fuzzy(q, hay)) score = 1
        return { a, score }
      })
      .filter((x) => x.score >= 0)
      .sort((x, y) => y.score - x.score)
    return scored.map((x) => x.a)
  }, [query, actions])

  // Keep the selection in range as the filter changes.
  useEffect(() => {
    setSelected(0)
  }, [query])

  const runAt = (i: number) => {
    const a = filtered[i]
    if (!a) return
    onClose()
    setTimeout(() => a.run(), 0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => (filtered.length ? (s + 1) % filtered.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => (filtered.length ? (s - 1 + filtered.length) % filtered.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runAt(selected)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 bg-black/40"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose()
              }}
            >
              <div className="mx-auto mt-[12vh] w-full max-w-xl px-4">
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label={t('palette.placeholder')}
                  className="animate-fade-in overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-xl"
                >
                  <div className="flex items-center gap-2 border-b border-border px-3">
                    <Search className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      ref={inputRef}
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={onKeyDown}
                      placeholder={t('palette.placeholder')}
                      aria-label={t('palette.placeholder')}
                      className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <div role="listbox" className="max-h-80 overflow-y-auto py-1.5">
                    {filtered.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        {t('palette.noMatch')}
                      </div>
                    ) : (
                      filtered.map((a, i) => (
                        <button
                          key={`${a.label}-${a.hint}`}
                          role="option"
                          aria-selected={i === selected}
                          onMouseMove={() => setSelected(i)}
                          onClick={() => runAt(i)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm',
                            i === selected ? 'bg-teal/15 text-teal' : 'text-foreground',
                          )}
                        >
                          <span className="truncate">{a.label}</span>
                          {a.hint ? (
                            <span className="shrink-0 text-xs text-muted-foreground">{a.hint}</span>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {diag ? (
        <InfoModal open title={t('diag.title')} onClose={() => setDiag(null)}>
          <Diagnostics diag={diag.diag} info={diag.info} />
        </InfoModal>
      ) : null}
    </>
  )
}

function fuzzy(q: string, hay: string): boolean {
  let qi = 0
  for (let si = 0; si < hay.length && qi < q.length; si += 1) {
    if (hay[si] === q[qi]) qi += 1
  }
  return qi === q.length
}

function Diagnostics({ diag, info }: { diag: Record<string, any>; info: Record<string, any> }) {
  const { t, lang, items } = usePi()
  const when = (o: Record<string, any> | undefined) =>
    o && o.at ? `${o.type} @ ${new Date(o.at).toLocaleTimeString()}` : t('diag.none')

  const rows: Array<[string, string, string?]> = [
    [t('diag.pi'), diag.alive ? t('diag.running', { pid: diag.pid }) : t('diag.stopped'), diag.alive ? 'ok' : 'bad'],
    [t('diag.server'), typeof location !== 'undefined' ? location.origin : '—'],
    [t('diag.cwd'), info.cwd || '—'],
    [t('diag.clients'), diag.sseClients ?? '—'],
    [t('diag.lastCommand'), when(diag.lastCommand)],
    [t('diag.lastEvent'), when(diag.lastEvent)],
    [t('diag.uptime'), fmtDur(diag.uptimeMs || 0)],
    [t('diag.trace'), diag.traceFile ? String(diag.traceFile).split('/').pop() || '—' : '—'],
    [t('diag.chat'), String(items.length)],
    [t('diag.theme'), `${getTheme()} / ${lang}`],
  ]

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v, cls]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={cls === 'ok' ? 'text-teal' : cls === 'bad' ? 'text-destructive' : 'break-all'}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  )
}
