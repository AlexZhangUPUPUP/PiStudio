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
  agents: AgentSpec[]
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

export async function stopTask(id: string): Promise<void> {
  try {
    await fetch(apiUrl(`/api/tasks/${encodeURIComponent(id)}/stop`), { method: 'POST' })
  } catch {
    /* ignore */
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
