import { extractText } from './pi'

export function fmtTokens(n?: number | null): string {
  if (n == null) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k'
  return (n / 1_000_000).toFixed(2) + 'M'
}

export function fmtCost(c?: number | null): string {
  const n = Number(c) || 0
  if (n <= 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export function fmtDur(ms?: number | null): string {
  if (ms == null) return ''
  if (ms < 1000) return ms + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(ms < 10_000 ? 2 : 1) + 's'
  const m = Math.floor(ms / 60000)
  return m + 'm' + Math.round((ms % 60000) / 1000) + 's'
}

export function cacheHitRate(u?: {
  input?: number
  cacheRead?: number
  cacheWrite?: number
} | null): number | null {
  const input = u?.input ?? 0
  const cacheRead = u?.cacheRead ?? 0
  const cacheWrite = u?.cacheWrite ?? 0
  const prompt = input + cacheRead + cacheWrite
  if (prompt <= 0 || cacheRead + cacheWrite <= 0) return null
  return (cacheRead / prompt) * 100
}

export function fmtChars(n?: number | null): string {
  const v = Number(n) || 0
  if (v < 1000) return String(v)
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0) + 'k'
  return (v / 1_000_000).toFixed(1) + 'M'
}

export function shortJson(v: unknown, max = 90): string {
  if (v == null) return ''
  let s: string
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    s = String(v)
  }
  s = s.replace(/\s+/g, ' ')
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function previewContent(content: unknown, max = 110): string {
  const text = extractText(content).replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
