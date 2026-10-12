import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { usePi } from '@/store/pi'
import { cn } from '@/lib/utils'
import { entryLabel, type TreeNode } from './sessions-utils'

const ROLES = ['user', 'assistant', 'tool', 'meta', 'custom'] as const

interface VisibleNode {
  id: string
  entry: Record<string, any>
  label?: string
  depth: number
  icon: string
  role: string
  text: string
  active: boolean
  dimmed: boolean
  isLeaf: boolean
}

interface SessionTreeProps {
  tree: TreeNode[]
  leafId: string | null
  selectedId: string | null
  onSelect: (entry: Record<string, any>) => void
}

function roleColor(role: string): string {
  switch (role) {
    case 'user':
      return 'text-purple-400'
    case 'assistant':
      return 'text-emerald-500'
    case 'tool':
      return 'text-amber-500'
    case 'meta':
      return 'text-muted-foreground'
    case 'custom':
      return 'text-pink-400'
    default:
      return 'text-muted-foreground'
  }
}

export function SessionTree({ tree, leafId, selectedId, onSelect }: SessionTreeProps) {
  const { t } = usePi()
  const [q, setQ] = useState('')
  const [roles, setRoles] = useState<Set<string>>(() => new Set(ROLES))
  const [activeOnly, setActiveOnly] = useState(false)
  const nodeRefs = useRef<(HTMLButtonElement | null)[]>([])

  const toggleRole = (r: string) => {
    setRoles((prev) => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r)
      else next.add(r)
      return next
    })
  }

  const { visible, countText } = useMemo(() => {
    const byId = new Map<string, TreeNode>()
    const parent = new Map<string, string | null>()
    let total = 0
    const index = (nodes: TreeNode[], parentId: string | null) => {
      for (const n of nodes) {
        if (!n || !n.entry) continue
        total += 1
        byId.set(n.entry.id, n)
        parent.set(n.entry.id, parentId)
        index(n.children || [], n.entry.id)
      }
    }
    index(tree, null)

    const active = new Set<string>()
    let cur: string | null = leafId
    let guard = 0
    while (cur && guard++ < 10000) {
      active.add(cur)
      cur = parent.get(cur) ?? null
    }

    const ql = q.trim().toLowerCase()
    const enabled = !!ql || roles.size < ROLES.length || activeOnly
    let keep: Set<string> | null = null
    let selfMatch: Set<string> | null = null

    if (enabled) {
      keep = new Set()
      selfMatch = new Set()
      const test = (n: TreeNode) => {
        const lbl = entryLabel(n.entry, t)
        if (roles.size < ROLES.length && !roles.has(lbl.role)) return false
        if (activeOnly && !active.has(n.entry.id)) return false
        if (ql) {
          const hay = `${lbl.text} ${lbl.role} ${n.label || ''} ${n.entry.id}`.toLowerCase()
          if (!hay.includes(ql)) return false
        }
        return true
      }
      const visit = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          if (!n || !n.entry) continue
          if (test(n)) {
            selfMatch!.add(n.entry.id)
            let id: string | null = n.entry.id
            let g = 0
            while (id && g++ < 10000) {
              keep!.add(id)
              id = parent.get(id) ?? null
            }
          }
          visit(n.children || [])
        }
      }
      visit(tree)
    }

    const visible: VisibleNode[] = []
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        if (!n || !n.entry) continue
        if (keep && !keep.has(n.entry.id)) continue
        const lbl = entryLabel(n.entry, t)
        visible.push({
          id: n.entry.id,
          entry: n.entry,
          label: n.label,
          depth,
          icon: lbl.icon,
          role: lbl.role,
          text: lbl.text,
          active: active.has(n.entry.id),
          dimmed: !!(selfMatch && !selfMatch.has(n.entry.id)),
          isLeaf: n.entry.id === leafId,
        })
        walk(n.children || [], depth + 1)
      }
    }
    walk(tree, 0)

    const countText = selfMatch
      ? t('trace.match', { n: selfMatch.size, shown: visible.length, total })
      : t('trace.nodes', { total })

    return { visible, countText }
  }, [tree, leafId, q, roles, activeOnly, t])

  const onKeyDown = (ev: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const nodes = nodeRefs.current.filter(Boolean) as HTMLButtonElement[]
    const i = nodes.indexOf(ev.currentTarget)
    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      nodes[Math.min(nodes.length - 1, i + 1)]?.focus()
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      nodes[Math.max(0, i - 1)]?.focus()
    } else if (ev.key === 'Home') {
      ev.preventDefault()
      nodes[0]?.focus()
    } else if (ev.key === 'End') {
      ev.preventDefault()
      nodes[nodes.length - 1]?.focus()
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      onSelect(visible[idx].entry)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('sessions.tree.search')}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-1">
          {ROLES.map((r) => (
            <button
              key={r}
              onClick={() => toggleRole(r)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                roles.has(r)
                  ? 'border-teal/60 bg-teal/15 text-teal'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t('role.' + r)}
            </button>
          ))}
        </div>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
          title={t('sessions.tree.activeOnly')}
        >
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="size-3.5 accent-teal"
          />
          {t('sessions.tree.activeOnly')}
        </label>
        <span className="ml-auto text-[11px] text-muted-foreground">{countText}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1 scrollbar-thin" role="tree">
        {visible.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {tree.length ? t('sessions.list.noMatch') : ''}
          </div>
        )}
        {visible.map((v, idx) => (
          <button
            key={v.id}
            ref={(el) => {
              nodeRefs.current[idx] = el
            }}
            role="treeitem"
            aria-selected={selectedId === v.id}
            tabIndex={selectedId === v.id || (!selectedId && idx === 0) ? 0 : -1}
            onClick={() => onSelect(v.entry)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            style={{ paddingLeft: 14 + v.depth * 16 }}
            className={cn(
              'flex w-full items-center gap-2 px-2 py-1 text-left text-[13px] focus:outline-none',
              selectedId === v.id
                ? 'bg-accent/20 text-accent-foreground ring-1 ring-inset ring-teal/50'
                : 'hover:bg-muted',
              v.active ? 'text-foreground' : 'text-muted-foreground',
              v.dimmed && 'opacity-50',
            )}
          >
            <span className="shrink-0 text-xs">{v.icon}</span>
            <span className={cn('w-14 shrink-0 text-[10px] uppercase tracking-wide', roleColor(v.role))}>
              {v.role}
            </span>
            <span className="min-w-0 flex-1 truncate">{v.text}</span>
            {v.label && (
              <span className="shrink-0 rounded bg-teal/15 px-1.5 py-0.5 text-[10px] text-teal">
                {v.label}
              </span>
            )}
            {v.isLeaf && (
              <span className="shrink-0 text-[10px] text-muted-foreground">← leaf</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
