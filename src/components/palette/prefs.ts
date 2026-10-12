/**
 * Shared UI preferences that are not owned by the React store.
 *
 * Theme (`pi-gui-theme`) mirrors `App.tsx`'s `useTheme` hook: both read and
 * write the same localStorage key and toggle the `.dark` class on <html>, so
 * they stay visually consistent even though App owns the toolbar button.
 * Settings/commmand-palette additionally emit an informational window event so
 * App can sync its own state if it chooses to listen:
 *
 *   - `pi-gui:set-theme`  detail: { mode: 'light' | 'dark' | 'system' }
 *   - `pi-gui:set-layout` detail: { layout: 'auto' | 'narrow' | 'wide' }
 */

export type ThemeMode = 'light' | 'dark' | 'system'
export type LayoutMode = 'compact' | 'comfortable'

const THEME_KEY = 'pi-gui-theme'
const LAYOUT_KEY = 'pi-gui-layout'

export function getTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_KEY, mode)
  } catch {}
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  // In Electron the native window background/vibrancy must follow the theme.
  try {
    window.piDesktop?.setTheme(mode)
  } catch {}
  window.dispatchEvent(new CustomEvent('pi-gui:set-theme', { detail: { mode } }))
}

export function cycleTheme(): ThemeMode {
  const mode = getTheme()
  const next: ThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light'
  applyTheme(next)
  return next
}

export function getLayout(): LayoutMode {
  try {
    const v = localStorage.getItem(LAYOUT_KEY)
    // tolerate the earlier auto/narrow/wide values
    if (v === 'comfortable' || v === 'wide') return 'comfortable'
    return 'compact'
  } catch {
    return 'compact'
  }
}

export function applyLayout(mode: LayoutMode) {
  try {
    localStorage.setItem(LAYOUT_KEY, mode)
  } catch {}
  if (typeof document !== 'undefined') document.documentElement.dataset.layout = mode
  window.dispatchEvent(new CustomEvent('pi-gui:set-layout', { detail: { layout: mode } }))
}
