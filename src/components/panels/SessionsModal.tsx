import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { usePi } from '@/store/pi'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiUrl } from '@/lib/pi'
import { previewContent } from '@/lib/format'
import { SessionTree } from './SessionTree'
import { SessionList, type SessionSummary } from './SessionList'
import { collectIds, entryLabel, findNode, type TreeNode } from './sessions-utils'

interface SessionsModalProps {
  open: boolean
  onClose: () => void
}

export default function SessionsModal({ open, onClose }: SessionsModalProps) {
  const { t, command, onResponse, toast, sessionName, currentModel, stats, info } = usePi()

  const [tab, setTab] = useState<'tree' | 'list'>('tree')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [leafId, setLeafId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const nameFocused = useRef(false)
  const labelFocused = useRef(false)
  const openRef = useRef(open)
  openRef.current = open

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiUrl('/api/sessions'))
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch (err) {
      toast(t('toast.listFailed', { msg: (err as Error).message }), 'error')
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  // After a fork/clone/switch the pi process points at a new session — ask the
  // store to resync everything it renders (mirrors legacy reloadSession).
  const resync = useCallback(() => {
    command({ type: 'get_messages' })
    command({ type: 'get_state' })
    command({ type: 'get_session_stats' })
    command({ type: 'get_tree' })
    void loadSessions()
  }, [command, loadSessions])

  /* ------------------------------------------------------------ RPC wiring */
  useEffect(() => {
    const unsubs = [
      onResponse('get_tree', (e) => {
        const d = e.data || {}
        const nextTree: TreeNode[] = d.tree || []
        const nextLeaf: string | null = d.leafId || null
        setTree(nextTree)
        setLeafId(nextLeaf)
        const ids = collectIds(nextTree)
        setSelectedId((prev) => (prev && ids.has(prev) ? prev : null))
      }),
      onResponse('export_html', (e) => {
        const d = e.data || {}
        toast(t('toast.exported', { path: d.path || '?' }))
      }),
      onResponse('fork', (e) => {
        const d = e.data || {}
        if (d.cancelled) toast(t('toast.forkCancelled'), 'warning')
        else {
          toast(t('toast.forked', { text: previewContent(d.text, 60) }))
          resync()
          if (openRef.current) onClose()
        }
      }),
      onResponse('clone', (e) => {
        const d = e.data || {}
        if (d.cancelled) toast(t('toast.cloneCancelled'), 'warning')
        else {
          toast(t('toast.cloned'))
          resync()
          if (openRef.current) onClose()
        }
      }),
      onResponse('switch_session', (e) => {
        const d = e.data || {}
        if (d.cancelled) {
          toast(t('toast.switchCancelled'), 'warning')
        } else {
          toast(t('toast.switched'))
          resync()
          if (openRef.current) onClose()
        }
      }),
      onResponse('set_session_name', () => {
        toast(t('toast.renamed'))
        command({ type: 'get_state' })
        command({ type: 'get_session_stats' })
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [onResponse, t, toast, command, resync, onClose])

  /* ----------------------------------------------------- open + escape key */
  useEffect(() => {
    if (!open) return
    command({ type: 'get_tree' })
    command({ type: 'get_state' })
    command({ type: 'get_session_stats' })
    void loadSessions()
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, command, loadSessions, onClose])

  /* ------------------------------------------------- input sync (no clobber) */
  useEffect(() => {
    if (!nameFocused.current) setNameInput(sessionName || '')
  }, [sessionName])

  const selectedNode = useMemo(() => findNode(tree, selectedId), [tree, selectedId])
  useEffect(() => {
    if (!labelFocused.current) setLabelInput(selectedNode?.label || '')
  }, [selectedNode])

  if (!open) return null

  const sessionId = stats?.sessionId || (info.session as string | undefined)
  const sessionFile = stats?.sessionFile || null
  const isUser = !!(
    selectedNode?.entry &&
    selectedNode.entry.type === 'message' &&
    selectedNode.entry.message?.role === 'user'
  )
  const selEntryLabel = selectedNode ? entryLabel(selectedNode.entry, t) : null

  const refreshAll = () => {
    command({ type: 'get_tree' })
    command({ type: 'get_state' })
    command({ type: 'get_session_stats' })
    void loadSessions()
  }

  const rename = () => command({ type: 'set_session_name', name: nameInput.trim() })
  const clone = () => command({ type: 'clone' })
  const exportHtml = () => command({ type: 'export_html' })
  const forkSelected = () => {
    if (selectedId) command({ type: 'fork', entryId: selectedId })
  }
  const applyBookmark = (clear: boolean) => {
    if (!selectedId) return
    const label = clear ? '' : labelInput.trim()
    command({ type: 'prompt', message: `/gui-label ${selectedId}${label ? ' ' + label : ''}` })
    window.setTimeout(() => {
      if (openRef.current) command({ type: 'get_tree' })
    }, 600)
  }

  const infoRow = (k: string, v: string) => (
    <span key={k} className="inline-flex items-baseline gap-1.5 text-[11px]">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="max-w-[260px] truncate font-mono text-foreground">{v}</span>
    </span>
  )

  const selectionText = selectedNode
    ? isUser && selectedNode.entry.message
      ? t('sessions.selected', {
          id: selectedId!.slice(0, 8),
          text: previewContent(selectedNode.entry.message.content, 40),
        })
      : t('sessions.selectedType', {
          id: selectedId!.slice(0, 8),
          type: t('role.' + (selEntryLabel?.role || 'meta')),
        })
    : t('sessions.selectNode')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl animate-fade-in">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t('common.sessions')}</h2>
          <div className="flex rounded-lg bg-muted p-0.5">
            {(['tree', 'list'] as const).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs transition-colors',
                  tab === tb
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(tb === 'tree' ? 'sessions.tab.tree' : 'sessions.tab.list')}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={refreshAll}
            >
              <RefreshCw className="size-3.5" />
              {t('common.refresh')}
            </Button>
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
        </div>

        {/* session info */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2">
          {infoRow(t('sessions.info.name'), sessionName || t('sessions.info.none'))}
          {infoRow(t('sessions.info.id'), sessionId ? sessionId.slice(0, 8) : '-')}
          {currentModel &&
            infoRow(t('sessions.info.model'), `${currentModel.provider}/${currentModel.id}`)}
          {infoRow(
            t('sessions.info.file'),
            sessionFile ? sessionFile.split('/').pop() || '-' : '-',
          )}
          {infoRow(t('stats.messages'), stats?.messageCount != null ? String(stats.messageCount) : '-')}
        </div>

        {/* body */}
        <div className="min-h-0 flex-1">
          {tab === 'tree' ? (
            <SessionTree
              tree={tree}
              leafId={leafId}
              selectedId={selectedId}
              onSelect={(entry) => setSelectedId(entry.id)}
            />
          ) : (
            <SessionList
              sessions={sessions}
              loading={loading}
              currentFile={sessionFile}
              onSwitch={(s) => command({ type: 'switch_session', sessionPath: s.path })}
              onDeleted={() => void loadSessions()}
            />
          )}
        </div>

        {/* footer */}
        <div className="border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nameInput}
              onFocus={() => {
                nameFocused.current = true
              }}
              onBlur={() => {
                nameFocused.current = false
              }}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t('sessions.namePlaceholder')}
              className="h-8 w-48 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={rename}>
              {t('sessions.rename')}
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clone}>
                {t('sessions.clone')}
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={exportHtml}>
                {t('sessions.export')}
              </Button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {selectionText}
            </span>
            <input
              value={labelInput}
              onFocus={() => {
                labelFocused.current = true
              }}
              onBlur={() => {
                labelFocused.current = false
              }}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder={t('sessions.labelPlaceholder')}
              className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={!selectedId}
              onClick={() => applyBookmark(false)}
            >
              {t('sessions.bookmark')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={!selectedNode?.label}
              onClick={() => applyBookmark(true)}
            >
              {t('sessions.unbookmark')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={!isUser}
              onClick={forkSelected}
            >
              {t('sessions.fork')}
            </Button>
          </div>

          <div className="mt-2 text-[11px] text-muted-foreground">{t('sessions.hint')}</div>
        </div>
      </div>
    </div>
  )
}
