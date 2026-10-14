/**
 * Agent-task API — the client side of the server's task runtime (`/api/tasks`).
 * A task owns several `pi` processes the server spawns itself, so one prompt can
 * fan out to multiple agents at once (parallel agents, model races).
 */
import { apiUrl } from '@/lib/pi'

export type AgentStatus =
  | 'starting'
  | 'running'
  | 'idle'
  | 'stopped'
  | 'done'
  | 'failed'
  | 'error'

export interface AgentUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: number | { total?: number }
  contextTokens?: number
  turns?: number
}

export interface TaskAgent {
  id: string
  name: string
  model: string | null
  role: string | null
  status: AgentStatus
  pid: number | null
  alive: boolean
  exitCode: number | null
  startedAt: number
  endedAt: number | null
  lastAt: number
  text: string
  thinking: string
  usage: AgentUsage | null
  tools: Record<string, number>
  turns: number
  eventCount: number
  worktree: string | null
  branch: string | null
}

export interface TaskInfo {
  id: string
  label: string | null
  cwd: string
  status: string
  createdAt: number
  endedAt: number | null
  clientCount: number
  seq: number
  budget: { cost: number; tokens: number } | null
  spend: { cost: number; tokens: number }
  budgetExceeded: boolean
  agents: TaskAgent[]
}

export interface AgentSpec {
  name?: string
  model?: string
  systemPrompt?: string
  tools?: string | string[]
  thinking?: string
  prompt?: string
}

export interface CreateTaskBody {
  label?: string
  cwd?: string
  budget?: { cost?: number; tokens?: number }
  agents: AgentSpec[]
}

export interface AgentDiffFile {
  path: string
  add: number
  del: number
  status?: string
}

export interface AgentDiff {
  ok: boolean
  error?: string
  worktree?: string | null
  branch?: string | null
  base?: string | null
  files?: AgentDiffFile[]
  diff?: string
}

export interface PromoteResult {
  ok: boolean
  applied: string[]
  conflicts: string[]
  error?: string
}

export type MergeBlock =
  | { type: 'text'; text: string }
  | { type: 'conflict'; ours: string; base: string; theirs: string }

export interface MergeFile {
  path: string
  status?: string
  conflict: boolean
  blocks?: MergeBlock[]
  content?: string
  binary?: boolean
  skipped?: boolean
}

export interface MergePreview {
  ok: boolean
  error?: string
  branch?: string | null
  base?: string | null
  files?: MergeFile[]
}

async function jget<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(apiUrl(path))
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

export async function listTasks(): Promise<TaskInfo[]> {
  const d = await jget<{ tasks: TaskInfo[] }>('/api/tasks')
  return d?.tasks || []
}

export async function getTask(id: string): Promise<TaskInfo | null> {
  const d = await jget<{ task: TaskInfo }>(`/api/tasks/${encodeURIComponent(id)}`)
  return d?.task || null
}

export async function createTask(body: CreateTaskBody): Promise<TaskInfo | { error: string }> {
  try {
    const r = await fetch(apiUrl('/api/tasks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await r.json()
    if (!r.ok) return { error: String(d?.error || r.status) }
    return d.task as TaskInfo
  } catch (err) {
    return { error: String((err as Error)?.message || err) }
  }
}

/** Send a prompt (or any RPC command) to one agent of a running task. */
export async function sendAgentCommand(
  taskId: string,
  agentId: string,
  message: string,
): Promise<boolean> {
  try {
    const r = await fetch(
      apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/agents/${encodeURIComponent(agentId)}/command`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      },
    )
    const d = await r.json()
    return !!d?.ok
  } catch {
    return false
  }
}

async function agentAction(
  taskId: string,
  agentId: string,
  action: 'stop' | 'restart',
): Promise<TaskInfo | null> {
  try {
    const r = await fetch(
      apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/agents/${encodeURIComponent(agentId)}/${action}`),
      { method: 'POST' },
    )
    if (!r.ok) return null
    const d = await r.json()
    return (d?.task as TaskInfo) || null
  } catch {
    return null
  }
}

/** Stop one agent of a task. Resolves to the refreshed task, or null on error. */
export async function stopAgent(taskId: string, agentId: string): Promise<TaskInfo | null> {
  return agentAction(taskId, agentId, 'stop')
}

/** Respawn one agent with its original spec/prompt (stream reset). */
export async function restartAgent(taskId: string, agentId: string): Promise<TaskInfo | null> {
  return agentAction(taskId, agentId, 'restart')
}

export async function stopTask(id: string): Promise<void> {
  try {
    await fetch(apiUrl(`/api/tasks/${encodeURIComponent(id)}/stop`), { method: 'POST' })
  } catch {
    /* ignore */
  }
}

/** Fetch the working-tree diff of one agent's isolated worktree. */
export async function agentDiff(taskId: string, agentId: string): Promise<AgentDiff | null> {
  try {
    const r = await fetch(
      apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/agents/${encodeURIComponent(agentId)}/diff`),
    )
    if (!r.ok) return null
    return (await r.json()) as AgentDiff
  } catch {
    return null
  }
}

/** Promote (merge back) all agents' isolated worktrees in one pass. */
export async function promoteAll(
  taskId: string,
): Promise<{ ok: boolean; applied: string[]; conflicts: string[] } | null> {
  try {
    const r = await fetch(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/promote-all`), { method: 'POST' })
    if (!r.ok) return null
    const d = (await r.json().catch(() => null)) as
      | { ok?: boolean; applied?: string[]; conflicts?: string[] }
      | null
    if (!d) return null
    return { ok: !!d.ok, applied: d.applied || [], conflicts: d.conflicts || [] }
  } catch {
    return null
  }
}

/** Promote (merge back) the changes of one agent's isolated worktree. */
export async function promoteAgent(taskId: string, agentId: string): Promise<PromoteResult | null> {
  try {
    const r = await fetch(
      apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/agents/${encodeURIComponent(agentId)}/promote`),
      { method: 'POST' },
    )
    const d = await r.json().catch(() => null)
    if (!r.ok) {
      return {
        ok: false,
        applied: [],
        conflicts: [],
        error: String((d as { error?: string } | null)?.error || r.status),
      }
    }
    const dd = d as { ok?: boolean; applied?: string[]; conflicts?: string[]; error?: string } | null
    return {
      ok: !!dd?.ok,
      applied: dd?.applied || [],
      conflicts: dd?.conflicts || [],
      error: dd?.error,
    }
  } catch (err) {
    return { ok: false, applied: [], conflicts: [], error: String((err as Error)?.message || err) }
  }
}

/** Fetch the merge preview (conflict-resolution plan) for one agent's worktree. */
export async function mergePreview(taskId: string, agentId: string): Promise<MergePreview | null> {
  try {
    const r = await fetch(
      apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/agents/${encodeURIComponent(agentId)}/merge`),
    )
    if (!r.ok) return null
    return (await r.json()) as MergePreview
  } catch {
    return null
  }
}

/** Apply resolved merge contents for one agent's worktree. */
export async function mergeApply(
  taskId: string,
  agentId: string,
  files: { path: string; content: string }[],
): Promise<{ ok: boolean; applied: string[]; error?: string } | null> {
  try {
    const r = await fetch(
      apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/agents/${encodeURIComponent(agentId)}/merge`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      },
    )
    const d = await r.json().catch(() => null)
    if (!r.ok) {
      return {
        ok: false,
        applied: [],
        error: String((d as { error?: string } | null)?.error || r.status),
      }
    }
    const dd = d as { ok?: boolean; applied?: string[]; error?: string } | null
    return { ok: !!dd?.ok, applied: dd?.applied || [], error: dd?.error }
  } catch {
    return null
  }
}

/** Clean up a task's isolated worktrees / temp resources. */
export async function cleanupTask(taskId: string): Promise<boolean> {
  try {
    const r = await fetch(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/cleanup`), { method: 'POST' })
    return r.ok
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ format */

export function usageCost(u: AgentUsage | null | undefined): number {
  if (!u || !u.cost) return 0
  return typeof u.cost === 'number' ? u.cost : Number(u.cost.total || 0)
}

export function usageTokens(u: AgentUsage | null | undefined): number {
  if (!u) return 0
  return (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0)
}

export function fmtCost(n: number): string {
  if (!n) return '$0'
  if (n < 0.01) return '$' + n.toFixed(4)
  return '$' + n.toFixed(3)
}

export function fmtTokens(n: number): string {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 10_000) return (n / 1000).toFixed(1) + 'k'
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(1) + 'M'
}

export function fmtElapsed(agent: TaskAgent): string {
  const end = agent.endedAt || (agent.alive ? Date.now() : agent.startedAt)
  const ms = Math.max(0, end - agent.startedAt)
  if (ms < 1000) return ms + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's'
  return Math.floor(ms / 60_000) + 'm' + Math.round((ms % 60_000) / 1000) + 's'
}
