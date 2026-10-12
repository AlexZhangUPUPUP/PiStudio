import { useSyncExternalStore } from 'react'
import DATA from './i18n-data.js'

export type Lang = string
export type TFunc = (key: string, vars?: Record<string, unknown>) => string

const I18N = DATA as unknown as Record<string, Record<string, string>>
const LANG_KEY = 'pi-gui-lang'
const LANGS = Object.keys(I18N)

function detectLang(): Lang {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(LANG_KEY)
  } catch {}
  if (stored && I18N[stored]) return stored
  const nav = String(navigator.language || 'en').toLowerCase()
  for (const code of LANGS) if (nav.startsWith(code)) return code
  return 'en'
}

let lang: Lang = detectLang()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

// Keep <html lang> in sync from the very first render (index.html hardcodes en).
if (typeof document !== 'undefined') {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
}

export function getLang(): Lang {
  return lang
}

export function setLang(next: Lang) {
  if (next === lang) return
  lang = I18N[next] ? next : 'en'
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {}
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
  emit()
}

export function t(key: string, vars?: Record<string, unknown>): string {
  const dict = I18N[lang] || {}
  let s = dict[key]
  if (s == null) s = (I18N.en || {})[key]
  if (s == null) return key
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])))
  return s
}

/** plural helper */
export function tp(oneKey: string, otherKey: string, n: number, vars?: Record<string, unknown>): string {
  return t(n === 1 ? oneKey : otherKey, { n, ...(vars || {}) })
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useI18n() {
  const current = useSyncExternalStore(subscribe, getLang, getLang)
  return { t, tp, lang: current, setLang }
}
