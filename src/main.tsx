import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { PiProvider } from '@/store/pi'
import '@/index.css'

// The desktop shell draws its own frame (hidden title bar + sidebar material),
// so the page drops its background and marks draggable chrome (see index.css).
if (/Electron/i.test(navigator.userAgent)) {
  document.documentElement.classList.add('is-electron')
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PiProvider>
      <App />
    </PiProvider>
  </React.StrictMode>,
)
