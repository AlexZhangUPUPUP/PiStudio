import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The pi-gui Node server owns the API (SSE + RPC). In dev Vite serves the React
// app and proxies /api to it; in production `vite build` emits dist/ which
// server.js serves directly (see PUBLIC_DIR in server.js).
const API_TARGET = process.env.PI_API || 'http://127.0.0.1:4173'

export default defineConfig({
  plugins: [react()],
  // `public/` holds the legacy vanilla UI that server.js falls back to; don't
  // let Vite copy it into the new build.
  publicDir: false,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.PI_WEB_PORT || 5173),
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
