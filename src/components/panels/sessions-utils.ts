import { previewContent } from '@/lib/format'
import type { TFunc } from '@/lib/i18n'

/* Mirrors the legacy `entryLabel` / `previewText` helpers in public/app.js. */

export interface TreeEntry {
  id: string
  type: string
  message?: any
  provider?: string
  modelId?: string
  thinkingLevel?: string
  tokensBefore?: number
  customType?: string
  label?: string
  name?: string
  content?: unknown
  command?: string
  [key: string]: any
}

export interface TreeNode {
  entry: TreeEntry
  children?: TreeNode[]
  label?: string
}

export interface EntryLabel {
  icon: string
  role: string
  text: string
}

export function previewText(content: unknown, max = 110): string {
  return previewContent(content, max)
}

export function entryLabel(entry: TreeEntry, t: TFunc): EntryLabel {
  const m = entry.message
  switch (entry.type) {
    case 'message': {
      if (!m) return { icon: '•', role: 'message', text: '' }
      if (m.role === 'user')
        return { icon: '👤', role: 'user', text: previewText(m.content) || t('entry.empty') }
      if (m.role === 'assistant') {
        const content = Array.isArray(m.content) ? m.content : []
        const texts = content
          .filter((c: any) => c && c.type === 'text')
          .map((c: any) => c.text)
          .join(' ')
          .trim()
        const tools = content.filter((c: any) => c && c.type === 'toolCall').map((c: any) => c.name)
        const text =
          previewText(texts) ||
          (tools.length
            ? t('entry.toolCalls', { list: tools.join(', ') })
            : t('entry.assistant', { reason: m.stopReason || 'stop' }))
        return { icon: '🤖', role: 'assistant', text }
      }
      if (m.role === 'toolResult')
        return {
          icon: '🔧',
          role: 'tool',
          text: `${m.toolName || t('label.tool')}${m.isError ? t('entry.toolResultError') : ''} · ${previewText(m.content, 80)}`,
        }
      if (m.role === 'custom')
        return {
          icon: '✦',
          role: 'custom',
          text: `[${m.customType || t('role.custom')}] ${previewText(m.content, 100)}`,
        }
      if (m.role === 'bashExecution') return { icon: '⌨', role: 'tool', text: previewText(m.command, 100) }
      return { icon: '•', role: 'message', text: m.role }
    }
    case 'model_change':
      return { icon: '◇', role: 'meta', text: t('entry.model', { value: `${entry.provider}/${entry.modelId}` }) }
    case 'thinking_level_change':
      return { icon: '🧠', role: 'meta', text: t('entry.thinking', { value: entry.thinkingLevel }) }
    case 'compaction':
      return { icon: '⛶', role: 'meta', text: t('entry.compaction', { tokens: entry.tokensBefore ?? '?' }) }
    case 'branch_summary':
      return { icon: '⑂', role: 'meta', text: t('entry.branchSummary') }
    case 'custom':
      return { icon: '⚙', role: 'meta', text: t('entry.custom', { type: entry.customType }) }
    case 'custom_message':
      return { icon: '✦', role: 'custom', text: `[${entry.customType}] ${previewText(entry.content, 100)}` }
    case 'label':
      return {
        icon: '🏷',
        role: 'meta',
        text: entry.label ? t('entry.label', { value: entry.label }) : t('entry.labelCleared'),
      }
    case 'session_info':
      return {
        icon: 'ℹ',
        role: 'meta',
        text: t('entry.name', { value: entry.name || t('entry.nameCleared') }),
      }
    default:
      return { icon: '•', role: 'meta', text: entry.type }
  }
}

export function collectIds(nodes: TreeNode[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (!n || !n.entry) continue
      ids.add(n.entry.id)
      walk(n.children || [])
    }
  }
  walk(nodes)
  return ids
}

export function findNode(nodes: TreeNode[], id: string | null): TreeNode | null {
  if (!id) return null
  for (const n of nodes) {
    if (!n || !n.entry) continue
    if (n.entry.id === id) return n
    const found = findNode(n.children || [], id)
    if (found) return found
  }
  return null
}
