import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  BarChart3,
  Bot,
  Languages,
  Moon,
  PanelRight,
  Plus,
  Settings as SettingsIcon,
  Square,
  Sun,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { Composer } from '@/components/chat/Composer'
import { StatusBar } from '@/components/chat/StatusBar'
import { ModelPicker } from '@/components/ModelPicker'
import { ToolsBadge } from '@/components/ToolsBadge'
import ExtensionsModal from '@/components/ExtensionsModal'
import { Sidebar } from '@/components/Sidebar'
import Dock from '@/components/dock/Dock'
import SessionsModal from '@/components/panels/SessionsModal'
import CommandPalette from '@/components/palette/CommandPalette'
import SettingsModal from '@/components/SettingsModal'
import TasksModal from '@/components/tasks/TasksModal'
import UsageModal from '@/components/UsageModal'
import ExtensionDialogs from '@/components/dialogs/ExtensionDialogs'
import Toasts from '@/components/Toasts'
import { usePi } from '@/store/pi'
import { apiUrl } from '@/lib/pi'
import { applyTheme, getLayout, getTheme, type LayoutMode } from '@/components/palette/prefs'
import { buildHtmlBundle, downloadText, fetchRawMessages } from '@/lib/export'
import { cn } from '@/lib/utils'

type DockTab = 'trace' | 'changes' | 'context'
const PAGE_SIZE = 60

export default function App() {
  const {
    t,
    lang,
    setLang,
    connected,
    info,
    proc,
    streaming,
    items,
    widgets,
    changesTick,
    abort,
    command,
    newSession,
    onResponse,
    toast,
  } = usePi()

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [dockOpen, setDockOpen] = useState(false)
  const [dockTab, setDockTab] = useState<DockTab>('trace')
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [changesCount, setChangesCount] = useState(0)
  const [themeMode, setThemeMode] = useState(getTheme)
  const [, forceTheme] = useState(0)
  const [layout, setLayout] = useState<LayoutMode>(getLayout)
  const [windowSize, setWindowSize] = useState(PAGE_SIZE)
  const [atBottom, setAtBottom] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const disabled = proc.state === 'exited' || proc.state === 'error'

  /* --------------------------------------------------------------- effects */

  useEffect(() => {
    applyTheme(themeMode)
  }, [themeMode])

  // keep the toggle icon honest when following the OS theme
  useEffect(() => {
    if (themeMode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => forceTheme((x) => x + 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [themeMode])

  useEffect(() => {
    const onTheme = (e: Event) => setThemeMode((e as CustomEvent).detail?.mode || getTheme())
    const onLayout = (e: Event) => {
      const next = ((e as CustomEvent).detail?.layout as LayoutMode) || getLayout()
      try {
        localStorage.setItem('pi-gui-layout', next)
      } catch {}
      if (typeof document !== 'undefined') document.documentElement.dataset.layout = next
      setLayout(next)
    }
    const onSessions = () => setSessionsOpen(true)
    const onSettings = () => setSettingsOpen(true)
    const onDock = (tab: DockTab) => {
      setDockTab(tab)
      setDockOpen(true)
    }
    const handlers: Record<string, (e: Event) => void> = {
      'pi-gui:set-theme': onTheme,
      'pi-gui:set-layout': onLayout,
      'pi-gui:open-sessions': onSessions,
      'pi-gui:open-settings': onSettings,
      'pi-gui:open-tasks': () => setTasksOpen(true),
      'pi-gui:open-usage': () => setUsageOpen(true),
      'pi-gui:open-extensions': () => setExtensionsOpen(true),
      'pi-gui:open-trace': () => onDock('trace'),
      'pi-gui:open-changes': () => onDock('changes'),
      'pi-gui:open-context': () => onDock('context'),
      'pi-gui:toggle-sidebar': () => setSidebarOpen((v) => !v),
      'pi-gui:clear-conversation': () => newSession(),
      'pi-gui:focus-composer': () =>
        document.querySelector<HTMLTextAreaElement>('textarea')?.focus(),
      'pi-gui:trace-jump': () => onDock('trace'),
    }
    for (const [k, fn] of Object.entries(handlers)) window.addEventListener(k, fn)
    return () => {
      for (const [k, fn] of Object.entries(handlers)) window.removeEventListener(k, fn)
    }
  }, [newSession])

  const exportHtml = useCallback(async () => {
    const messages = await fetchRawMessages(command, onResponse)
    if (!messages.length) {
      toast(t('sessions.emptySession'), 'warning')
      return
    }
    const html = await buildHtmlBundle(messages, {
      sessionId: info.session || undefined,
      cwd: info.cwd,
      sessionName: info.session || undefined,
    })
    if (html) downloadText(`pi-gui-${Date.now()}.html`, html, 'text/html')
  }, [command, onResponse, info.session, info.cwd, toast, t])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey
      if (mod && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'k') {
        ev.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (mod && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'e') {
        ev.preventDefault()
        void exportHtml()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [exportHtml])

  const refreshChanges = useCallback(async () => {
    try {
      const r = await fetch(apiUrl('/api/changes'))
      const d = await r.json()
      setChangesCount(Array.isArray(d.files) ? d.files.length : 0)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refreshChanges()
  }, [refreshChanges, changesTick, info.session])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stickRef.current || streaming) el.scrollTop = el.scrollHeight
  }, [items, streaming])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickRef.current = near
    setAtBottom(near)
  }

  const toLatest = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    stickRef.current = true
    setAtBottom(true)
  }

  /* ----------------------------------------------------------------- render */

  const resolvedTheme: 'light' | 'dark' =
    themeMode === 'light' || themeMode === 'dark'
      ? themeMode
      : typeof window !== 'undefined' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'

  const start = Math.max(0, items.length - windowSize)
  const shown = useMemo(() => items.slice(start), [items, start])
  const userPositions = useMemo(
    () => items.map((it, i) => (it.kind === 'user' ? i : -1)).filter((i) => i >= 0),
    [items],
  )
  const ordinalByIndex = useMemo(() => {
    const m = new Map<number, number>()
    userPositions.forEach((idx, o) => m.set(idx, o + 1))
    return m
  }, [userPositions])
  const lastUserIndex = userPositions.length ? userPositions[userPositions.length - 1] : -1

  const widgetsAbove = widgets.filter((w) => w.placement !== 'belowEditor')
  const widgetsBelow = widgets.filter((w) => w.placement === 'belowEditor')

  const gapClass = layout === 'comfortable' ? 'gap-5' : 'gap-2'

  return (
    <div
      className={cn(
        'pi-root flex h-full',
        !sidebarOpen && 'pi-sidebar-collapsed',
        layout === 'comfortable' ? 'layout-comfortable' : 'layout-compact',
      )}
    >
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="pi-main flex min-w-0 flex-1 flex-col">
        {/* toolbar */}
        <header className="pi-toolbar flex items-center gap-2 border-b border-border px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setSidebarOpen((v) => !v)}
            title={t('sidebar.toggle')}
          >
            ☰
          </Button>
          <span
            className="min-w-0 max-w-[280px] truncate font-mono text-[11px] text-muted-foreground"
            title={info.cwd}
          >
            {info.cwd || '—'}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <ModelPicker />
            <ToolsBadge />

            <Button
              variant="ghost"
              size="icon"
              className="relative size-8"
              onClick={() => {
                setDockTab('changes')
                setDockOpen(true)
              }}
              title={t('changes.title')}
            >
              <span className="text-xs">Δ</span>
              {changesCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-teal px-1 text-[9px] font-semibold text-primary-foreground">
                  {changesCount}
                </span>
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setTasksOpen(true)}
              title={t('tasks.title')}
            >
              <Bot className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setUsageOpen(true)}
              title={t('usage.title')}
            >
              <BarChart3 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setSessionsOpen(true)}
              title={t('common.sessions')}
            >
              <PanelRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setSettingsOpen(true)}
              title={t('settings.title')}
            >
              <SettingsIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => newSession()}
              title={t('common.new')}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 px-2"
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
            >
              <Languages className="size-4" />
              {lang === 'zh' ? 'EN' : '中'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark')}
              title={t('toolbar.theme')}
              aria-label={t('toolbar.theme')}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
            <Button
              variant={streaming ? 'destructive' : 'ghost'}
              size="icon"
              className="size-8"
              disabled={!streaming}
              onClick={abort}
              title={t('common.stop')}
            >
              <Square className="size-3.5" />
            </Button>
          </div>
        </header>

        {/* body */}
        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              <div className={cn('mx-auto flex max-w-3xl flex-col', gapClass)}>
                {items.length === 0 && (
                  <div className="mt-20 flex flex-col items-center gap-3 text-center text-muted-foreground">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-teal/15 text-2xl text-teal">
                      π
                    </div>
                    <div className="text-sm font-medium text-foreground">{t('firstRun.title')}</div>
                    <ul className="space-y-1 text-xs">
                      {['firstRun.keyboard', 'firstRun.files', 'firstRun.panels', 'firstRun.input'].map(
                        (k) => (
                          <li key={k}>{t(k).replace(/<[^>]+>/g, '')}</li>
                        ),
                      )}
                    </ul>
                    <div className="text-xs">
                      {info.cwd ? <span className="font-mono">{info.cwd}</span> : t('sidebar.loading')}
                    </div>
                  </div>
                )}
                {start > 0 && (
                  <button
                    type="button"
                    onClick={() => setWindowSize((n) => n + PAGE_SIZE)}
                    className="mx-auto rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    {t('chat.loadEarlier', { n: Math.min(PAGE_SIZE, start) })}
                  </button>
                )}
                {shown.map((it, idx) => {
                  const gi = start + idx
                  return (
                    <MessageBubble
                      key={it.id}
                      item={it}
                      userOrdinal={it.kind === 'user' ? ordinalByIndex.get(gi) : undefined}
                      isLastUser={gi === lastUserIndex}
                    />
                  )
                })}
              </div>
            </div>

            {!atBottom && items.length > 0 && (
              <button
                type="button"
                onClick={toLatest}
                className="absolute bottom-4 right-6 flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm hover:bg-muted"
              >
                <ArrowDown className="size-3.5" />
                {t('chat.toLatest')}
              </button>
            )}

            {widgetsAbove.length > 0 && (
              <div className="border-t border-border px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
                {widgetsAbove.map((w) => (
                  <div key={w.key} className="whitespace-pre-wrap">
                    {w.lines.join('\n')}
                  </div>
                ))}
              </div>
            )}

            <Composer streaming={streaming} disabled={disabled} />

            {widgetsBelow.length > 0 && (
              <div className="border-t border-border px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
                {widgetsBelow.map((w) => (
                  <div key={w.key} className="whitespace-pre-wrap">
                    {w.lines.join('\n')}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Dock
            open={dockOpen}
            tab={dockTab}
            onTab={setDockTab}
            onClose={() => setDockOpen(false)}
          />
        </div>

        <StatusBar />
      </div>

      {/* overlays */}
      <SessionsModal open={sessionsOpen} onClose={() => setSessionsOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <TasksModal open={tasksOpen} onClose={() => setTasksOpen(false)} />
      <UsageModal open={usageOpen} onClose={() => setUsageOpen(false)} />
      <ExtensionsModal open={extensionsOpen} onClose={() => setExtensionsOpen(false)} />
      <ExtensionDialogs />
      <Toasts />

      {!connected && (
        <Badge variant="destructive" className="fixed bottom-3 left-3 z-50">
          offline
        </Badge>
      )}
      <RefreshSync />
    </div>
  )
}

/** Pokes the sidebar to refresh when the session list changes. */
function RefreshSync() {
  const { info, stats } = usePi()
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('pi-gui:refresh-sessions'))
  }, [info.session, stats?.sessionFile])
  return null
}
