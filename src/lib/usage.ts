/**
 * Usage / spend API — the client side of the server's usage index.
 *
 * The server (implemented in server.js/db.js by another agent) exposes:
 *   GET /api/index/status -> IndexStatus
 *   GET /api/usage?days=7|30|90 -> UsageResponse
 *   GET /api/runs?limit=20 -> { runs: RunRecord[] }
 *
 * Both endpoints are read-only and are fetched through `apiUrl()` so the
 * per-tab session id (and any auth token) are appended automatically.
 */
import { apiUrl } from '@/lib/pi'

export interface IndexStatus {
  available: boolean
  db: string
  sessions: number
  runs: number
  tasks: number
  updatedAt: number
}

export interface UsageTotals {
  cost: number
  tokensIn: number
  tokensOut: number
  tokens: number
  turns: number
  sessions: number
  tasks: number
}

export interface UsageSeriesPoint {
  key: string
  cost: number
  tokens: number
  turns: number
}

export interface UsageBucket {
  key: string
  cost: number
  tokens: number
  turns: number
  count: number
}

export interface UsageWorkspaceBucket {
  key: string
  label: string
  cost: number
  tokens: number
  turns: number
  count: number
}

export interface UsageResponse {
  available: boolean
  days: number
  totals: UsageTotals
  /** Totals for the previous window of equal length (e.g. the prior 7 days). */
  prev: UsageTotals
  series: UsageSeriesPoint[]
  byModel: UsageBucket[]
  byWorkspace: UsageWorkspaceBucket[]
}

export interface RunRecord {
  runFile: string
  startedAt: number
  endedAt: number | null
  cost: number
  tokens: number
  turns: number
  status: string
  model: string | null
}

export interface BudgetLimit {
  cost: number
  tokens: number
}

export interface BudgetConfig {
  daily: BudgetLimit
  monthly: BudgetLimit
}

export interface BudgetStatus {
  available: boolean
  config: BudgetConfig
  today: BudgetLimit
  month: BudgetLimit
  exceeded: { daily: boolean; monthly: boolean }
}

export type BudgetPatch = {
  daily?: { cost?: number; tokens?: number }
  monthly?: { cost?: number; tokens?: number }
}

export type UsageRange = 7 | 30 | 90

async function jget<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(apiUrl(path))
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

async function jpost<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

export function getUsage(days: UsageRange): Promise<UsageResponse | null> {
  return jget<UsageResponse>(`/api/usage?days=${days}`)
}

export async function getRuns(limit = 20): Promise<RunRecord[]> {
  const d = await jget<{ runs: RunRecord[] }>(`/api/runs?limit=${limit}`)
  return d?.runs || []
}

export function getIndexStatus(): Promise<IndexStatus | null> {
  return jget<IndexStatus>('/api/index/status')
}

export function getBudgets(): Promise<BudgetStatus | null> {
  return jget<BudgetStatus>('/api/budgets')
}

export function setBudgets(patch: BudgetPatch): Promise<BudgetStatus | null> {
  return jpost<BudgetStatus>('/api/budgets', patch)
}
