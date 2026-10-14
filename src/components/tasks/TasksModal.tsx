import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crown, Plus, Play, RotateCcw, Send, Square, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { usePi } from '@/store/pi'
import { cn } from '@/lib/utils'
import {
  createTask,
  fmtCost,
  fmtElapsed,
  fmtTokens,
  getTask,
  listTasks,
  restartAgent,
  sendAgentCommand,
  stopAgent,
  stopTask,
  usageCost,
  usageTokens,
  type TaskAgent,
  type TaskInfo,
} from '@/lib/tasks'

export interface TasksModalProps {
  open: boolean
  onClose: () => void
}

interface Row {
  key: number
  name: string
  model: string
}

const STATUS_CLASS: Record<string, string> = {
  starting: 'text-muted-foreground border-border',
  running: 'text-blue-400 border-blue-500/40',
  idle: 'text-muted-foreground border-border',
  stopped: 'text-muted-foreground border-border',
  done: 'text-teal border-teal/40',
  failed: 'text-destructive border-destructive/40',
  error: 'text-destructive border-destructive/40',
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 py-px text-[10px] font-medium',
        STATUS_CLASS[status] || STATUS_CLASS.idle,
      )}
    >
      {status}
    </span>
  )
}

interface DiffLine {
  type: 'add' | 'del' | 'same'
  text: string
}

/** Classic LCS line diff (no deps), with common prefix/suffix trimming. */
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

function diffLines(a: string[], b: string[]): DiffLine[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const out: DiffLine[] = []
  for (let i = 0; i < start; i++) out.push({ type: 'same', text: a[i] })

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  if (midA.length * midB.length > 2_000_000) {
    // Fall back to a naive removed-then-added diff for very large inputs.
    for (const l of midA) out.push({ type: 'del', text: l })
    for (const l of midB) out.push({ type: 'add', text: l })
  } else {
    out.push(...lcsDiff(midA, midB))
  }

  for (let i = endA; i < a.length; i++) out.push({ type: 'same', text: a[i] })
  return out
}

/**
 * Agent tasks — Mission Control / model race.
 *
 * Drives the server's task runtime (`/api/tasks`): spawns a group of `pi`
 * processes the server owns (not this tab), streams each one, and shows a
 * leaderboard so the same prompt can be raced across models.
 */
export default function TasksModal({ open, onClose }: TasksModalProps) {
  const { t } = usePi()
  const [rows, setRows] = useState<Row[]>([
    { key: 1, name: 'agent 1', model: '' },
    { key: 2, name: 'agent 2', model: '' },
  ])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [task, setTask] = useState<TaskInfo | null>(null)
  const [recent, setRecent] = useState<TaskInfo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [compareAgents, setCompareAgents] = useState<[TaskAgent, TaskAgent] | null>(null)
  const nextKey = useRef(3)

  const refreshRecent = useCallback(async () => {
    setRecent(await listTasks())
  }, [])

  useEffect(() => {
    if (open) refreshRecent()
  }, [open, refreshRecent])

  // Poll the selected task while the modal is open — the server keeps each
  // agent's streamed text, so this is what makes the columns look live.
  useEffect(() => {
    if (!open || !task?.id) return
    const id = task.id
    let alive = true
    const tick = async () => {
      const next = await getTask(id)
      if (alive && next) setTask(next)
    }
    const iv = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [open, task?.id])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (compareAgents) setCompareAgents(null)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, compareAgents])

  // Reset compare selection/overlay whenever the viewed task changes.
  useEffect(() => {
    setSelected([])
    setCompareAgents(null)
  }, [task?.id])

  const addRow = () => {
    const k = nextKey.current++
    setRows((r) => [...r, { key: k, name: 'agent ' + k, model: '' }])
  }

  const launch = async () => {
    const text = prompt.trim()
    if (!text) {
      setError(t('tasks.needPrompt'))
      return
    }
    setBusy(true)
    setError('')
    const agents = rows
      .filter((r) => r.name.trim() || r.model.trim())
      .map((r) => ({ name: r.name.trim() || undefined, model: r.model.trim() || undefined, prompt: text }))
    if (!agents.length) {
      setBusy(false)
      setError(t('tasks.needAgent'))
      return
    }
    const res = await createTask({ agents })
    setBusy(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setTask(res)
    refreshRecent()
  }

  const select = async (id: string) => {
    const next = await getTask(id)
    if (next) setTask(next)
  }

  const toggleSelect = (id: string) => {
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]))
  }

  const stopAgentNow = async (aid: string) => {
    if (!task) return
    await stopAgent(task.id, aid)
    const next = await getTask(task.id)
    if (next) setTask(next)
  }

  const restartAgentNow = async (aid: string) => {
    if (!task) return
    await restartAgent(task.id, aid)
    const next = await getTask(task.id)
    if (next) setTask(next)
  }

  const openCompare = () => {
    if (!task || selected.length !== 2) return
    const a = task.agents.find((x) => x.id === selected[0])
    const b = task.agents.find((x) => x.id === selected[1])
    if (a && b) setCompareAgents([a, b])
  }

  if (!open) return null

  const agents = task?.agents || []
  const finished = agents.filter((a) => !a.alive && a.usage)
  const bestCost = finished.length > 1 ? Math.min(...finished.map(usageCost)) : null
  const bestTime = finished.length > 1 ? Math.min(...finished.map((a) => (a.endedAt || 0) - a.startedAt)) : null
  const totalCost = agents.reduce((s, a) => s + usageCost(a.usage), 0)
  const totalTokens = agents.reduce((s, a) => s + usageTokens(a.usage), 0)

  return (
    <>
      {createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('tasks.title')}
        className="flex max-h-[88vh] w-[min(1180px,96vw)] animate-fade-in flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{t('tasks.title')}</h2>
            <p className="text-[11px] text-muted-foreground">{t('tasks.subtitle')}</p>
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label={t('common.close')}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* launcher */}
          <div className="border-b border-border px-4 py-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('tasks.promptPlaceholder')}
              rows={2}
              className="mb-2 w-full resize-y text-[13px]"
            />
            <div className="flex flex-col gap-1.5">
              {rows.map((r, i) => (
                <div key={r.key} className="flex items-center gap-2">
                  <Input
                    value={r.name}
                    onChange={(e) =>
                      setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))
                    }
                    placeholder={t('tasks.namePlaceholder')}
                    className="h-8 w-40 text-[12px]"
                  />
                  <Input
                    value={r.model}
                    onChange={(e) =>
                      setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, model: e.target.value } : x)))
                    }
                    placeholder={t('tasks.modelPlaceholder')}
                    className="h-8 flex-1 font-mono text-[12px]"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    title={t('tasks.remove')}
                    disabled={rows.length <= 1}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  {i === 0 && <span className="w-9" />}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1" onClick={addRow}>
                <Plus className="size-3.5" /> {t('tasks.addAgent')}
              </Button>
              <Button size="sm" className="h-8 gap-1" onClick={launch} disabled={busy}>
                <Play className="size-3.5" /> {busy ? t('tasks.launching') : t('tasks.launch')}
              </Button>
              {error && <span className="text-[12px] text-destructive">{error}</span>}
            </div>
          </div>

          {/* recent */}
          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <span className="text-[11px] text-muted-foreground">{t('tasks.recent')}</span>
              {recent.slice(0, 8).map((tk) => (
                <button
                  key={tk.id}
                  type="button"
                  onClick={() => select(tk.id)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px]',
                    task?.id === tk.id ? 'border-foreground/40 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tk.label || tk.id.replace(/^task-/, '')} · {tk.status} · {tk.agents.length}
                </button>
              ))}
            </div>
          )}

          {!task && (
            <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">{t('tasks.empty')}</div>
          )}

          {task && (
            <div className="px-4 py-3">
              <div className="mb-2 flex items-center gap-3">
                <StatusPill status={task.status} />
                <span className="font-mono text-[11px] text-muted-foreground">{task.id}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground" title={task.cwd}>
                  {task.cwd}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {selected.length > 2 ? t('tasks.selectOnly2') : selected.length < 2 ? t('tasks.compareHint') : ''}
                  </span>
                  {task.agents.some((a) => a.alive) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1"
                      onClick={() => stopTask(task.id)}
                    >
                      <Square className="size-3" /> {t('tasks.stop')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1"
                    disabled={selected.length !== 2}
                    onClick={openCompare}
                  >
                    {t('tasks.compare')}
                  </Button>
                </div>
              </div>

              {/* leaderboard */}
              {agents.length > 1 && (
                <div className="mb-3 overflow-hidden rounded-md border border-border">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">{t('tasks.agent')}</th>
                        <th className="px-2 py-1 text-left font-medium">{t('tasks.status')}</th>
                        <th className="px-2 py-1 text-right font-medium">{t('tasks.turns')}</th>
                        <th className="px-2 py-1 text-right font-medium">{t('tasks.tokens')}</th>
                        <th className="px-2 py-1 text-right font-medium">{t('tasks.cost')}</th>
                        <th className="px-2 py-1 text-right font-medium">{t('tasks.time')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((a) => {
                        const cost = usageCost(a.usage)
                        const dur = (a.endedAt || (a.alive ? Date.now() : a.startedAt)) - a.startedAt
                        return (
                          <tr key={a.id} className="border-t border-border/60">
                            <td className="px-2 py-1">
                              <span className="font-medium">{a.name}</span>
                              <span className="ml-2 font-mono text-muted-foreground">{a.model || t('tasks.defaultModel')}</span>
                            </td>
                            <td className="px-2 py-1"><StatusPill status={a.status} /></td>
                            <td className="px-2 py-1 text-right">{a.turns}</td>
                            <td className="px-2 py-1 text-right">{fmtTokens(usageTokens(a.usage))}</td>
                            <td className={cn('px-2 py-1 text-right', bestCost != null && cost === bestCost && 'font-semibold text-teal')}>
                              {bestCost != null && cost === bestCost && <Crown className="mr-1 inline size-3" />}
                              {fmtCost(cost)}
                            </td>
                            <td className={cn('px-2 py-1 text-right', bestTime != null && dur === bestTime && 'font-semibold text-teal')}>
                              {fmtElapsed(a)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t border-border bg-muted/20 text-muted-foreground">
                      <tr>
                        <td className="px-2 py-1" colSpan={3}>
                          {agents.length} {t('tasks.agent')}
                        </td>
                        <td className="px-2 py-1 text-right">{fmtTokens(totalTokens)}</td>
                        <td className="px-2 py-1 text-right">{fmtCost(totalCost)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* columns */}
              <div className="flex gap-3 overflow-x-auto pb-2">
                {agents.map((a) => (
                  <AgentColumn
                    key={a.id}
                    agent={a}
                    followUp={(msg) => sendAgentCommand(task.id, a.id, msg)}
                    t={t}
                    selected={selected.includes(a.id)}
                    selectDisabled={!selected.includes(a.id) && selected.length >= 2}
                    onToggleSelect={() => toggleSelect(a.id)}
                    onStop={() => stopAgentNow(a.id)}
                    onRetry={() => restartAgentNow(a.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
      )}
      {compareAgents && (
        <CompareOverlay
          a={compareAgents[0]}
          b={compareAgents[1]}
          t={t}
          onClose={() => setCompareAgents(null)}
        />
      )}
    </>
  )
}

function AgentColumn({
  agent,
  followUp,
  t,
  selected,
  selectDisabled,
  onToggleSelect,
  onStop,
  onRetry,
}: {
  agent: TaskAgent
  followUp: (msg: string) => Promise<boolean>
  t: (k: string, vars?: Record<string, unknown>) => string
  selected: boolean
  selectDisabled: boolean
  onToggleSelect: () => void
  onStop: () => Promise<void>
  onRetry: () => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  useEffect(() => {
    const el = bodyRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [agent.text, agent.thinking])

  const run = async (fn: () => Promise<void>) => {
    setPending(true)
    try {
      await fn()
    } finally {
      setPending(false)
    }
  }

  const toolChips = Object.entries(agent.tools || {})

  return (
    <div className="flex max-h-[52vh] w-[360px] shrink-0 flex-col rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            disabled={selectDisabled}
            aria-label={t('tasks.compare')}
            className="size-3.5 shrink-0 cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span className="truncate text-[12px] font-semibold">{agent.name}</span>
          <StatusPill status={agent.status} />
          <div className="ml-auto flex items-center gap-0.5">
            {agent.alive ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title={t('tasks.stop')}
                disabled={pending}
                onClick={() => run(onStop)}
              >
                <Square className="size-3" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title={t('tasks.retry')}
                disabled={pending}
                onClick={() => run(onRetry)}
              >
                <RotateCcw className="size-3" />
              </Button>
            )}
          </div>
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {[agent.model || t('tasks.defaultModel'), agent.pid ? 'pid ' + agent.pid : '', fmtElapsed(agent)]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {toolChips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {toolChips.map(([name, n]) => (
              <span key={name} className="rounded border border-border px-1 text-[10px] text-muted-foreground">
                {name}×{n}
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
        }}
        className="min-h-[80px] flex-1 overflow-y-auto px-3 py-2 text-[12px] leading-relaxed"
      >
        {agent.thinking && (
          <div className="mb-1 whitespace-pre-wrap italic text-muted-foreground">{agent.thinking}</div>
        )}
        {agent.text ? (
          <div className="whitespace-pre-wrap break-words">{agent.text}</div>
        ) : (
          <div className="text-muted-foreground">
            {agent.status === 'running' ? '…' : agent.status === 'error' ? t('tasks.failed') : ''}
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-1.5 border-t border-border p-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const msg = draft.trim()
          if (!msg) return
          setDraft('')
          await followUp(msg)
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('tasks.followUp')}
          disabled={!agent.alive}
          className="h-7 flex-1 text-[12px]"
        />
        <Button type="submit" variant="ghost" size="icon" className="size-7" disabled={!agent.alive || !draft.trim()}>
          <Send className="size-3.5" />
        </Button>
      </form>
    </div>
  )
}

function CompareOverlay({
  a,
  b,
  t,
  onClose,
}: {
  a: TaskAgent
  b: TaskAgent
  t: (k: string, vars?: Record<string, unknown>) => string
  onClose: () => void
}) {
  const diff = useMemo(() => diffLines(a.text.split('\n'), b.text.split('\n')), [a.text, b.text])

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
        aria-label={t('tasks.compareTitle')}
        className="flex max-h-[88vh] w-[min(1100px,96vw)] animate-fade-in flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t('tasks.compareTitle')}</h2>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-2">
            <div className="sticky top-0 border-b border-border bg-popover px-3 py-2 text-[12px] font-semibold">
              {a.name}
            </div>
            <div className="sticky top-0 border-b border-border bg-popover px-3 py-2 text-[12px] font-semibold">
              {b.name}
            </div>
            {diff.map((d, i) => (
              <Fragment key={i}>
                <div
                  className={cn(
                    'min-h-[1.2em] whitespace-pre-wrap break-words border-b border-border/30 px-3 py-0.5 font-mono text-[11px] leading-relaxed',
                    d.type === 'del' ? 'bg-destructive/10 text-destructive' : d.type === 'same' ? 'text-muted-foreground' : '',
                  )}
                >
                  {d.type === 'add' ? '' : d.text}
                </div>
                <div
                  className={cn(
                    'min-h-[1.2em] whitespace-pre-wrap break-words border-b border-border/30 border-l px-3 py-0.5 font-mono text-[11px] leading-relaxed',
                    d.type === 'add' ? 'bg-teal/10 text-teal' : d.type === 'same' ? 'text-muted-foreground' : '',
                  )}
                >
                  {d.type === 'del' ? '' : d.text}
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
