/// <reference types="vite/client" />

interface Window {
  /** Exposed by electron/preload.js in the desktop shell. */
  piDesktop?: { setTheme(mode: 'light' | 'dark' | 'system'): void }
}
