/**
 * Usage / spend API — the client side of the server's usage index.
 *
 * The server (implemented in server.js/db.js by another agent) exposes:
 *   GET /api/index/status -> IndexStatus
 *   GET /api/usage?days=7|30|90 -> UsageResponse
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
  series: UsageSeriesPoint[]
  byModel: UsageBucket[]
  byWorkspace: UsageWorkspaceBucket[]
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

export function getUsage(days: UsageRange): Promise<UsageResponse | null> {
  return jget<UsageResponse>(`/api/usage?days=${days}`)
}

export function getIndexStatus(): Promise<IndexStatus | null> {
  return jget<IndexStatus>('/api/index/status')
}
