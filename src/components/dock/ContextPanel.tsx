import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { usePi } from '@/store/pi'
import { apiUrl } from '@/lib/pi'
import { fmtChars, shortJson } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type InspTab = 'prompt' | 'context' | 'requests' | 'session' | 'agents' | 'caps'

interface InspectRecord {
  at: number
  kind: string
  data: Record<string, any> | null
  agent: string
}

interface Agent {
  key: string
  pid?: number
  parentKey?: string
  child?: boolean
  task?: string | null
  model?: string | null
  startedAt?: number
  lastAt?: number
  count?: number
}

interface SessionEntry {
  id?: string
  type?: string
  message?: Record<string, any>
  parentId?: string
  tokensBefore?: number
  name?: string
}

const INSPECT_MAX_BYTES = 4 * 1024 * 1024
const EST_CHARS_PER_TOKEN = 4

const estTokens = (chars: unknown) => Math.round((Number(chars) || 0) / EST_CHARS_PER_TOKEN)

const ROLE_BG: Record<string, string> = {
  system: 'bg-muted-foreground',
  user: 'bg-coral',
  assistant: 'bg-teal',
  toolResult: 'bg-gold',
  custom: 'bg-coral',
}

const TAB_LABEL: Record<InspTab, string> = {
  prompt: 'inspect.tab.prompt',
  context: 'inspect.tab.context',
  requests: 'inspect.tab.requests',
  session: 'inspect.tab.session',
  agents: 'inspect.tab.agents',
  caps: 'inspect.tab.caps',
}

function fileLabel(f: any): string {
  if (typeof f === 'string') return f
  return (f && (f.path || f.name)) || ''
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-border/50 px-2.5 py-2">
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  )
}

function KvRow({ k, v, right }: { k: string; v?: ReactNode; right?: ReactNode }) {
  const text = v == null || v === '' ? '—' : v
  return (
    <div className="flex items-baseline gap-2 border-t border-border/40 py-0.5 text-[11px] first:border-t-0">
      <span className="shrink-0 font-mono text-muted-foreground">{k}</span>
      <span className="min-w-0 flex-1 truncate" title={typeof text === 'string' ? text : undefined}>
        {text}
      </span>
      {right != null && <span className="shrink-0 text-muted-foreground">{right}</span>}
    </div>
  )
}

function LazyPre({ summary, text }: { summary: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="mt-1"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none text-[11px] text-muted-foreground">
        {summary}
      </summary>
      {open && (
        <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
          {text}
        </pre>
      )}
    </details>
  )
}

function HeadRow({ cols }: { cols: ReactNode[] }) {
  return (
    <div className="flex items-center gap-2 border-t border-border/40 py-0.5 text-[11px] font-medium text-muted-foreground">
      {cols.map((c, i) => (
        <span key={i} className={cn(i === 0 && 'font-mono')}>
          {c}
        </span>
      ))}
    </div>
  )
}

export function ContextPanel() {
  const { t, onAnyEvent, onResponse, command, models, commands } = usePi()
  const [tab, setTab] = useState<InspTab>('prompt')
  const [records, setRecords] = useState<InspectRecord[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [entries, setEntries] = useState<SessionEntry[]>([])
  const [leafId, setLeafId] = useState<string | null>(null)
  const [inspectAgent, setInspectAgent] = useState('main')

  const recordsRef = useRef<InspectRecord[]>([])
  const sizesRef = useRef<number[]>([])
  const bytesRef = useRef(0)

  const pushInspect = useCallback((rec: InspectRecord) => {
    let next = recordsRef.current.concat(rec)
    const size = JSON.stringify(rec).length
    sizesRef.current.push(size)
    bytesRef.current += size
    while (next.length > 50 && (next.length > 400 || bytesRef.current > INSPECT_MAX_BYTES)) {
      next = next.slice(1)
      bytesRef.current -= sizesRef.current.shift() || 0
    }
    recordsRef.current = next
    setRecords(next)
  }, [])

  const upsertAgent = useCallback((agent: Agent) => {
    if (!agent || !agent.key) return
    setAgents((prev) => {
      const i = prev.findIndex((a) => a.key === agent.key)
      if (i === -1) return prev.concat(agent)
      const next = prev.slice()
      next[i] = { ...next[i], ...agent }
      return next
    })
  }, [])

  // live inspector records + agent registry
  useEffect(() => {
    return onAnyEvent((e: Record<string, any>) => {
      if (e.type === '__inspect') {
        pushInspect({ at: Number(e.at) || Date.now(), kind: String(e.kind), data: e.data ?? null, agent: e.agent || 'main' })
      } else if (e.type === '__agent' && e.agent) {
        upsertAgent(e.agent as Agent)
      }
    })
  }, [onAnyEvent, pushInspect, upsertAgent])

  // session entries come back through the response bus
  useEffect(() => {
    return onResponse('get_entries', (e: Record<string, any>) => {
      if (e.success) {
        setEntries(Array.isArray(e.data?.entries) ? e.data.entries : [])
        setLeafId(e.data?.leafId ?? null)
      }
    })
  }, [onResponse])

  const loadInspect = useCallback(async () => {
    try {
      const d = await fetch(apiUrl('/api/inspect')).then((r) => r.json())
      if (Array.isArray(d.agents)) {
        setAgents(d.agents)
        setInspectAgent((prev) => (d.agents.some((a: Agent) => a.key === prev) ? prev : 'main'))
      }
      if (Array.isArray(d.records) && d.records.length > recordsRef.current.length) {
        recordsRef.current = []
        sizesRef.current = []
        bytesRef.current = 0
        for (const rec of d.records) pushInspect(rec)
      }
    } catch {
      /* ignore */
    }
  }, [pushInspect])

  useEffect(() => {
    loadInspect()
    command({ type: 'get_entries' })
  }, [loadInspect, command])

  useEffect(() => {
    if (tab === 'session') command({ type: 'get_entries' })
  }, [tab, command])

  const currentRecords = useMemo(
    () => records.filter((r) => (r.agent || 'main') === inspectAgent),
    [records, inspectAgent],
  )
  const inspAll = useCallback(
    (kind: string) => currentRecords.filter((r) => r.kind === kind),
    [currentRecords],
  )
  const inspLatest = useCallback(
    (kind: string) => {
      const a = inspAll(kind)
      return a.length ? a[a.length - 1] : null
    },
    [inspAll],
  )

  const agentOptions = agents.length ? agents : [{ key: 'main', child: false, task: null } as Agent]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
        <span className="text-[11px] text-muted-foreground" title={t('dock.contextHint')}>
          {t('dock.contextHint')}
        </span>
        <span className="flex-1" />
        {agentOptions.length > 1 && (
          <select
            value={inspectAgent}
            onChange={(e) => setInspectAgent(e.target.value)}
            className="h-6 max-w-40 rounded border border-input bg-background font-mono text-[11px] text-foreground"
          >
            {agentOptions.map((a) => {
              const label = a.child ? `└ ${a.model || a.key}` : `★ ${t('inspect.agents.main')}`
              const text = a.task ? `${label} — ${String(a.task).slice(0, 30)}` : label
              return (
                <option key={a.key} value={a.key}>
                  {text}
                </option>
              )
            })}
          </select>
        )}
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={loadInspect}>
          <RefreshCw className="size-3" />
          {t('common.refresh')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-0.5 border-b border-border px-1.5 py-1">
        {(Object.keys(TAB_LABEL) as InspTab[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              'rounded px-2 py-0.5 text-[11px] transition-colors',
              tab === k ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/40',
            )}
          >
            {t(TAB_LABEL[k])}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pb-6">
        {tab === 'prompt' && <PromptTab inspLatest={inspLatest} t={t} />}
        {tab === 'context' && <ContextTab inspLatest={inspLatest} t={t} />}
        {tab === 'requests' && <RequestsTab inspAll={inspAll} t={t} />}
        {tab === 'session' && <SessionTab entries={entries} leafId={leafId} t={t} />}
        {tab === 'agents' && (
          <AgentsTab
            agents={agentOptions}
            records={records}
            inspectAgent={inspectAgent}
            onPick={setInspectAgent}
            t={t}
          />
        )}
        {tab === 'caps' && (
          <CapsTab inspLatest={inspLatest} inspAll={inspAll} models={models} commands={commands} t={t} />
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- prompt */

function PromptTab({
  inspLatest,
  t,
}: {
  inspLatest: (kind: string) => InspectRecord | null
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  const rec = inspLatest('system_prompt')
  if (!rec)
    return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('inspect.noPrompt')}</div>
  const d = rec.data || {}
  const files = d.contextFiles || []
  const skills = d.skills || []
  const snippets = Object.entries(d.toolSnippets || {})
  const guidelines = d.promptGuidelines || []

  return (
    <>
      <Section title={t('inspect.prompt.size')}>
        <KvRow k="chars" v={d.chars} right={d.chars} />
        <KvRow k="~tokens" v={estTokens(d.chars)} right={estTokens(d.chars)} />
        <KvRow k="images" v={d.images ?? 0} right={d.images ?? 0} />
      </Section>
      <Section title={t('inspect.prompt.composition')}>
        <KvRow k="cwd" v={d.cwd} />
        <KvRow k="selectedTools" v={(d.selectedTools || []).join(', ')} right={(d.selectedTools || []).length} />
        <KvRow
          k="toolSnippets"
          v={snippets.map(([k, v]) => `${k}: ${v}`).join('  ·  ')}
          right={snippets.length}
        />
        <KvRow k="guidelines" v={guidelines.join('  ·  ')} right={guidelines.length} />
        <KvRow
          k="contextFiles"
          v={files.map((f: any) => `${fileLabel(f)} (${fmtChars(f.chars)})`).join('  ·  ')}
          right={files.length}
        />
        <KvRow k="skills" v={skills.map((s: any) => s.name).join(', ')} right={skills.length} />
        <KvRow k="customPrompt" v={d.customPrompt ? t('inspect.yes') : t('inspect.no')} />
        <KvRow k="appendPrompt" v={d.appendSystemPrompt ? t('inspect.yes') : t('inspect.no')} />
      </Section>
      <Section title={t('inspect.prompt.full')}>
        <LazyPre summary={t('inspect.showFull')} text={d.systemPrompt || ''} />
      </Section>
    </>
  )
}

/* -------------------------------------------------------------- context */

function ContextTab({
  inspLatest,
  t,
}: {
  inspLatest: (kind: string) => InspectRecord | null
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  const rec = inspLatest('context')
  if (!rec)
    return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('inspect.noContext')}</div>
  const d = rec.data || {}
  const msgs: any[] = d.messages || []
  const total = Math.max(1, d.chars || 1)

  return (
    <>
      <Section title={t('inspect.context.size')}>
        <KvRow k="messages" v={d.count ?? msgs.length} right={d.count ?? msgs.length} />
        <KvRow k="chars" v={fmtChars(d.chars)} right={fmtChars(d.chars)} />
        <KvRow k="~tokens" v={estTokens(d.chars)} right={estTokens(d.chars)} />
        <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-sm">
          {msgs.map((m, i) => (
            <i
              key={i}
              className={ROLE_BG[m.role] || 'bg-border'}
              style={{ width: `${(((m.chars || 0) / total) * 100).toFixed(2)}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {Object.entries(ROLE_BG)
            .filter(([role]) => msgs.some((m) => m.role === role))
            .map(([role, c]) => (
              <span key={role} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <b className={cn('size-2 rounded-sm', c)} />
                {role}
              </span>
            ))}
        </div>
      </Section>
      <Section title={t('inspect.context.messages')}>
        <HeadRow cols={['#', t('inspect.col.role'), t('inspect.col.preview'), t('inspect.col.chars')]} />
        {msgs.map((m, i) => (
          <div key={i} className="flex items-center gap-2 border-t border-border/40 py-0.5 text-[11px]">
            <span className="font-mono text-muted-foreground">#{i}</span>
            <span className="text-muted-foreground">
              {m.role}
              {m.types && m.types.length ? ` [${m.types.join(',')}]` : ''}
            </span>
            <span className="min-w-0 flex-1 truncate" title={m.preview || ''}>
              {m.preview || ''}
            </span>
            <span className="shrink-0 text-muted-foreground">{fmtChars(m.chars)}</span>
          </div>
        ))}
      </Section>
    </>
  )
}

/* ------------------------------------------------------------- requests */

function RequestsTab({
  inspAll,
  t,
}: {
  inspAll: (kind: string) => InspectRecord[]
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  const reqs = inspAll('request')
  if (!reqs.length)
    return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('inspect.noRequests')}</div>
  const responses = inspAll('response')

  return (
    <>
      {reqs
        .map((r, i) => ({ r, i }))
        .reverse()
        .map(({ r, i }) => {
          const d = r.data || {}
          const res = responses.find((x) => x.at >= r.at && x.at - r.at < 1000 * 60 * 30)
          const rate =
            res && res.data && res.data.headers
              ? Object.entries(res.data.headers)
                  .filter(([k]) => /rate|limit|retry-after/i.test(k))
                  .map(([k, v]) => `${k}=${v}`)
                  .join('  ')
              : ''
          return (
            <Section key={i} title={`#${i + 1} · ${new Date(r.at).toLocaleTimeString()}`}>
              <KvRow k="model" v={d.params && d.params.model} />
              <KvRow k="status" v={res && res.data ? String(res.data.status) : '—'} />
              <KvRow k="messages" v={(d.messageRoles || []).join(', ')} right={d.messageCount} />
              <KvRow k="tools" v={(d.toolNames || []).join(', ')} right={d.toolCount} />
              <KvRow k="bytes" v={fmtChars(d.bytes)} right={fmtChars(d.bytes)} />
              <KvRow k="params" v={shortJson(d.params, 200)} />
              {rate && <KvRow k="rateLimit" v={rate} />}
              <LazyPre summary={t('inspect.showPayload')} text={d.raw || ''} />
            </Section>
          )
        })}
    </>
  )
}

/* -------------------------------------------------------------- session */

function SessionTab({
  entries,
  leafId,
  t,
}: {
  entries: SessionEntry[]
  leafId: string | null
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  if (!entries.length)
    return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('inspect.noEntries')}</div>
  const byType: Record<string, number> = {}
  for (const e of entries) byType[e.type || '?'] = (byType[e.type || '?'] || 0) + 1

  return (
    <>
      <Section title={t('inspect.session.stats')}>
        <KvRow k="entries" v={entries.length} right={entries.length} />
        <KvRow k="leafId" v={leafId || '—'} />
        {Object.entries(byType).map(([k, v]) => (
          <KvRow key={k} k={k} v={v} right={v} />
        ))}
      </Section>
      <Section title={t('inspect.session.entries')}>
        <HeadRow cols={['id', t('inspect.col.type'), t('inspect.col.detail'), 'parent']} />
        {entries.slice(-80).map((e, i) => {
          const m = e.message || {}
          const desc =
            e.type === 'message'
              ? `${m.role || '?'}${Array.isArray(m.content) ? ` [${m.content.map((c: any) => c.type).join(',')}]` : ''}`
              : e.type === 'compaction'
                ? `compaction · ${e.tokensBefore ?? '?'} tokens before`
                : e.type === 'session_info'
                  ? `name: ${e.name || ''}`
                  : e.type
          const isCompact = e.type === 'compaction'
          return (
            <div key={i} className="flex items-center gap-2 border-t border-border/40 py-0.5 text-[11px]">
              <span className="font-mono text-muted-foreground">{e.id || ''}</span>
              <span className="text-muted-foreground">
                {e.type}
                {isCompact && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px]">{t('inspect.compact')}</span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate" title={String(desc)}>
                {desc}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {String(e.parentId || '—').slice(0, 8)}
              </span>
            </div>
          )
        })}
      </Section>
    </>
  )
}

/* --------------------------------------------------------------- agents */

function AgentsTab({
  agents,
  records,
  inspectAgent,
  onPick,
  t,
}: {
  agents: Agent[]
  records: InspectRecord[]
  inspectAgent: string
  onPick: (key: string) => void
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  const counts = new Map<string, number>()
  for (const r of records) counts.set(r.agent || 'main', (counts.get(r.agent || 'main') || 0) + 1)

  const list = agents.length ? agents : ([{ key: 'main', child: false, task: null, lastAt: Date.now() }] as Agent[])
  if (list.length <= 1)
    return (
      <Section title={t('inspect.agents.list')}>
        <div className="text-[11px] text-muted-foreground">{t('inspect.agents.none')}</div>
      </Section>
    )

  return (
    <>
      <Section title={t('inspect.agents.list')}>
        <HeadRow cols={['', 'model', t('inspect.col.detail'), 'records']} />
        {list.map((a) => {
          const isMain = !a.child
          const active = a.key === inspectAgent
          const running = !isMain && Date.now() - (a.lastAt || 0) < 20000
          const status = isMain ? t('inspect.agents.main') : running ? t('inspect.agents.running') : t('inspect.agents.idle')
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => onPick(a.key)}
              title={a.task || ''}
              className={cn(
                'flex w-full items-center gap-2 border-t border-border/40 py-0.5 text-left text-[11px] hover:bg-muted/40',
                active && 'bg-muted/60',
              )}
            >
              <span className="font-mono text-muted-foreground">{isMain ? '★' : '└'}</span>
              <span className="text-foreground">{a.model || status}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.task || status}</span>
              <span className="shrink-0 text-muted-foreground">{counts.get(a.key) || 0}</span>
            </button>
          )
        })}
      </Section>
      <Section title={t('inspect.tab.agents')}>
        <div className="text-[11px] text-muted-foreground">{t('inspect.agents.hint')}</div>
      </Section>
    </>
  )
}

/* ----------------------------------------------------------------- caps */

function CapsTab({
  inspLatest,
  inspAll,
  models,
  commands,
  t,
}: {
  inspLatest: (kind: string) => InspectRecord | null
  inspAll: (kind: string) => InspectRecord[]
  models: any[]
  commands: any[]
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  const sp = inspLatest('system_prompt')
  const d = (sp && sp.data) || {}
  const inv = inspLatest('inventory')
  const invData = (inv && inv.data) || null

  return (
    <>
      {invData && (
        <Section title={t('inspect.caps.tools')}>
          {(invData.tools || []).length ? (
            (invData.tools || []).map((tool: any, i: number) => {
              const src = tool.source || {}
              const where =
                src.extensionPath || src.path || src.package || src.source || src.type || (typeof src === 'string' ? src : '')
              return (
                <div key={i} className="flex items-baseline gap-2 border-t border-border/40 py-0.5 text-[11px] first:border-t-0">
                  <span className="shrink-0 font-mono text-foreground">{tool.name || ''}</span>
                  <span className="text-muted-foreground">{shortJson(where, 60)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={tool.description || ''}>
                    {tool.description || ''}
                  </span>
                </div>
              )
            })
          ) : (
            <div className="text-[11px] text-muted-foreground">—</div>
          )}
        </Section>
      )}

      <Section title={t('inspect.caps.commands')}>
        {commands.length ? (
          commands.map((c, i) => (
            <div key={i} className="flex items-center gap-2 border-t border-border/40 py-0.5 text-[11px] first:border-t-0">
              <span className="font-mono text-foreground">/{c.name}</span>
              <span className="text-muted-foreground">{c.source || ''}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={c.description || ''}>
                {c.description || ''}
              </span>
            </div>
          ))
        ) : (
          <div className="text-[11px] text-muted-foreground">—</div>
        )}
      </Section>

      <Section title={t('inspect.caps.models')}>
        {models.length ? (
          models.map((m, i) => (
            <div key={i} className="flex items-center gap-2 border-t border-border/40 py-0.5 text-[11px] first:border-t-0">
              <span className="font-mono text-foreground">{m.provider}</span>
              <span className="text-muted-foreground">{m.id}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {m.name || ''}
                {m.reasoning && <span className="ml-1 rounded bg-muted px-1 text-[10px]">reasoning</span>}
              </span>
              <span className="shrink-0 text-muted-foreground">{fmtChars(m.contextWindow)}</span>
            </div>
          ))
        ) : (
          <div className="text-[11px] text-muted-foreground">—</div>
        )}
      </Section>

      <Section title={t('inspect.caps.skills')}>
        {(d.skills || []).length ? (
          (d.skills || []).map((s: any, i: number) => (
            <div key={i} className="flex items-baseline gap-2 border-t border-border/40 py-0.5 text-[11px] first:border-t-0">
              <span className="shrink-0 font-mono text-foreground">{s.name}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={s.description || ''}>
                {s.description || ''}
              </span>
            </div>
          ))
        ) : (
          <div className="text-[11px] text-muted-foreground">—</div>
        )}
      </Section>

      <Section title={t('inspect.caps.contextFiles')}>
        {(d.contextFiles || []).length ? (
          (d.contextFiles || []).map((f: any, i: number) => (
            <div key={i} className="flex items-baseline gap-2 border-t border-border/40 py-0.5 text-[11px] first:border-t-0">
              <span className="shrink-0 font-mono text-foreground">
                {String(fileLabel(f)).split('/').pop()}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={fileLabel(f)}>
                {fileLabel(f)}
              </span>
              <span className="shrink-0 text-muted-foreground">{fmtChars(f.chars)}</span>
            </div>
          ))
        ) : (
          <div className="text-[11px] text-muted-foreground">—</div>
        )}
      </Section>

      <Section title={t('inspect.caps.compaction')}>
        {inspAll('compact').length ? (
          inspAll('compact').map((c, i) => {
            const k = c.data || {}
            return (
              <div key={i} className="flex items-baseline gap-2 border-t border-border/40 py-0.5 text-[11px] first:border-t-0">
                <span className="shrink-0 font-mono text-foreground">{k.reason || ''}</span>
                <span className="text-muted-foreground">{new Date(c.at).toLocaleTimeString()}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {t('inspect.caps.compactDetail', { before: k.tokensBefore ?? '?', kept: k.retainedTail ?? '?' })}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {k.summaryChars ? fmtChars(k.summaryChars) : ''}
                </span>
              </div>
            )
          })
        ) : (
          <div className="text-[11px] text-muted-foreground">—</div>
        )}
      </Section>
    </>
  )
}
