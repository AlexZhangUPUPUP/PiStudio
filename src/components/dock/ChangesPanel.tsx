import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, RotateCcw, Search } from 'lucide-react'
import { usePi } from '@/store/pi'
import { apiUrl } from '@/lib/pi'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ChangeFile {
  path: string
  code: string | null
  tool: string | null
  count: number
  missing: boolean
  revertable: boolean
  add: number | null
  del: number | null
  lastAt: number
}

interface DiffLine {
  t: string
  text: string
  a?: number | string
  b?: number | string
}

interface DiffResult {
  path?: string
  add?: number
  del?: number
  source?: string
  error?: string
  lines?: DiffLine[]
}

const DIFF_MAX = 3000

export function ChangesPanel() {
  const { t, toast, changesTick } = usePi()
  const [git, setGit] = useState(false)
  const [cwd, setCwd] = useState('')
  const [files, setFiles] = useState<ChangeFile[]>([])
  const [query, setQuery] = useState('')
  const [sessionOnly, setSessionOnly] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [armed, setArmed] = useState(0)
  const armedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadChanges = useCallback(
    async (keepSelection: boolean) => {
      try {
        const d = await fetch(apiUrl('/api/changes')).then((r) => r.json())
        setGit(!!d.git)
        setCwd(d.cwd || '')
        const next = Array.isArray(d.files) ? d.files : []
        setFiles(next)
        setSelected((prev) => {
          if (keepSelection && prev && next.some((f: ChangeFile) => f.path === prev)) return prev
          return null
        })
      } catch (err) {
        /* keep last known list */
      }
    },
    [],
  )

  const selectChange = useCallback(
    async (path: string) => {
      setSelected(path)
      setArmed(0)
      if (armedTimer.current) clearTimeout(armedTimer.current)
      armedTimer.current = null
      try {
        const d = await fetch(apiUrl('/api/changes/diff') + `&path=${encodeURIComponent(path)}`).then((r) =>
          r.json(),
        )
        setDiff((d && (d.error || d.lines || d.add != null)) ? d : { path, error: 'empty diff', lines: [] })
      } catch (err) {
        setDiff({ error: String(err instanceof Error ? err.message : err) })
      }
    },
    [],
  )

  // reload whenever the change ticker moves (a tool result touched files)
  useEffect(() => {
    loadChanges(true)
  }, [changesTick, loadChanges])

  useEffect(() => {
    loadChanges(true)
    return () => {
      if (armedTimer.current) clearTimeout(armedTimer.current)
    }
  }, [loadChanges])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter(
      (f) => (!sessionOnly || f.tool) && (!q || f.path.toLowerCase().includes(q)),
    )
  }, [files, query, sessionOnly])

  const totals = useMemo(() => {
    let add = 0
    let del = 0
    for (const f of filtered) {
      if (typeof f.add === 'number') add += f.add
      if (typeof f.del === 'number') del += f.del
    }
    return { add, del }
  }, [filtered])

  const selectedFile = files.find((f) => f.path === selected)

  const revert = async () => {
    if (!selected) return
    const now = Date.now()
    if (armed && now - armed < 5000) {
      setArmed(0)
      if (armedTimer.current) clearTimeout(armedTimer.current)
      armedTimer.current = null
      try {
        const d = await fetch(apiUrl('/api/changes/revert'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: selected }),
        }).then((r) => r.json())
        if (d.ok) {
          toast(t('toast.reverted', { path: selected, backup: d.backup ? t('changes.backupKept') : '' }))
          setSelected(null)
          setDiff(null)
          await loadChanges(false)
        } else {
          toast(t('toast.revertFailed', { msg: d.error || '?' }), 'error')
        }
      } catch (err) {
        toast(t('toast.revertFailed', { msg: String(err instanceof Error ? err.message : err) }), 'error')
      }
      return
    }
    setArmed(now)
    if (armedTimer.current) clearTimeout(armedTimer.current)
    armedTimer.current = setTimeout(() => setArmed(0), 5000)
  }

  const diffLines = diff?.lines || []

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('changes.filter')}
            className="h-6 pl-6 text-[11px]"
          />
        </div>
        <label
          className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-muted-foreground"
          title={t('changes.sessionOnlyTitle')}
        >
          <input
            type="checkbox"
            checked={sessionOnly}
            onChange={(e) => setSessionOnly(e.target.checked)}
            className="accent-teal"
          />
          {t('changes.sessionOnly')}
        </label>
        <span className="text-[11px] text-muted-foreground">{t('changes.count', { n: filtered.length })}</span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => loadChanges(true)}>
          <RefreshCw className="size-3" />
          {t('common.refresh')}
        </Button>
      </div>

      <div className="border-b border-border px-2 py-1 text-[11px] text-muted-foreground" title={t('changes.hint')}>
        {!filtered.length ? (
          files.length ? (
            t('changes.filtered')
          ) : (
            t('changes.clean')
          )
        ) : (
          <>
            <span className="font-mono">{cwd}</span>
            {' · '}
            <span className="text-teal">+{totals.add}</span>{' '}
            <span className="text-destructive">−{totals.del}</span>
            {' · '}
            {t('changes.filesTouched', { n: filtered.length })}
          </>
        )}
        <span className="ml-2 text-muted-foreground/70" title={git ? t('changes.gitTitle') : t('changes.noGitTitle')}>
          {git ? t('changes.git') : t('changes.noGit')}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!filtered.length ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            {files.length ? t('changes.filtered') : t('changes.cleanHint')}
          </div>
        ) : (
          filtered.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => selectChange(f.path)}
              className={cn(
                'flex w-full items-center gap-2 border-b border-border/40 px-2.5 py-1 text-left text-[11px] hover:bg-muted/40',
                f.path === selected && 'bg-muted/60',
              )}
            >
              <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>
                {f.path}
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {typeof f.add === 'number' && <span className="text-teal">+{f.add}</span>}
                {typeof f.del === 'number' && <span className="text-destructive"> −{f.del}</span>}
              </span>
              <span className="shrink-0 text-muted-foreground" title={f.tool ? '' : t('changes.gitOnly')}>
                {f.tool ? t('changes.byTool', { tool: f.tool, n: f.count }) : f.code || ''}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-2 py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={selected || ''}>
            {selected || ''}
          </span>
          {diff && !diff.error && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums">
              <span className="text-teal">+{diff.add || 0}</span>{' '}
              <span className="text-destructive">−{diff.del || 0}</span>
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-destructive hover:text-destructive"
            disabled={!selectedFile || !selectedFile.revertable}
            onClick={revert}
          >
            <RotateCcw className="size-3" />
            {armed ? t('changes.revertConfirm') : t('changes.revert')}
          </Button>
        </div>
        <pre className="flex-1 overflow-auto bg-muted/20 p-1 font-mono text-[11px] leading-[1.4]">
          {!diff ? (
            t('changes.pickFile')
          ) : diff.error ? (
            diff.error
          ) : (
            diffLines
              .slice(0, DIFF_MAX)
              .map((l, i) => {
                const cls = l.t === '+' ? 'text-teal' : l.t === '-' ? 'text-destructive' : 'text-foreground'
                const ln = l.t === '+' ? l.b || '' : l.a || ''
                return (
                  <div key={i} className={cn('flex gap-2 px-1', l.t === '+' && 'bg-teal/5', l.t === '-' && 'bg-destructive/5')}>
                    <span className="w-8 shrink-0 select-none text-right text-muted-foreground/60">{ln}</span>
                    <span className={cn('whitespace-pre-wrap break-words', cls)}>{l.text || '\u00a0'}</span>
                  </div>
                )
              })
          )}
          {diffLines.length > DIFF_MAX && (
            <div className="px-1 text-muted-foreground">… {diffLines.length - DIFF_MAX} {t('changes.moreLines')}</div>
          )}
        </pre>
      </div>
    </div>
  )
}
