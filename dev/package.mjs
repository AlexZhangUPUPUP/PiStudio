#!/usr/bin/env node
/**
 * Package the desktop shell into a double-clickable macOS app and a .dmg.
 *
 *   npm run package        # build + package .app (+ .dmg on macOS)
 *   npm run package:app    # .app only
 *
 * The packaged bundle contains only what the Electron main process and the
 * Node server need at runtime: electron/, server.js, extensions/, dist/ and
 * package.json. The frontend sources, legacy UI, dev tooling and node_modules
 * are excluded (server.js is zero-dependency; main.js only uses Electron).
 *
 * Runs unsigned (no Developer ID here); Gatekeeper will warn on first open:
 *   xattr -dr com.apple.quarantine "release/pi-gui-darwin-<arch>/pi GUI.app"
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'release')
const APP_NAME = 'pi GUI'

const IGNORE = [
  /^\/src($|\/)/,
  /^\/legacy($|\/)/,
  /^\/dev($|\/)/,
  /^\/release($|\/)/,
  /^\/traces($|\/)/,
  /^\/node_modules($|\/)/,
  /^\/模板($|\/)/,
  /^\/neobrutalist-ui-design($|\/)/,
  /^\/neobrutalist-ui-design\.zip$/,
  /^\/index\.html$/,
  /^\/vite\.config\.mts$/,
  /^\/tailwind\.config\.ts$/,
  /^\/postcss\.config\.mjs$/,
  /^\/tsconfig\.json$/,
  /^\/start\.sh$/,
  /^\/start-desktop\.sh$/,
  /^\/demo\.html$/,
  /^\/package-lock\.json$/,
  /^\/CHANGELOG\.md$/,
  /^\/README\.md$/,
  /^\/\.gitignore$/,
  /\/\.DS_Store$/,
  /\/\.npmrc$/,
]

async function main() {
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('✗ dist/index.html missing — run `npm run build` first.')
    process.exit(1)
  }

  console.log('• packaging (this can take a minute)…')
  const [appPath] = await packager({
    dir: ROOT,
    out: OUT,
    name: APP_NAME,
    appBundleId: 'dev.pi.gui',
    platform: 'darwin',
    arch: process.arch,
    asar: false, // server.js is spawned as a child; asar breaks that
    prune: true,
    overwrite: true,
    osxSign: false, // unsigned build
    ignore: IGNORE,
  })
  if (!appPath) throw new Error('packager returned no app path')
  console.log('✓ app  :', appPath)

  if (process.argv.includes('--app-only') || process.platform !== 'darwin') {
    console.log('\nDone. (skipping .dmg)')
    return
  }

  const dmg = path.join(OUT, `pi-gui-${process.arch}.dmg`)
  console.log('• building dmg…')
  const res = spawnSync(
    'hdiutil',
    ['create', '-volname', APP_NAME, '-srcfolder', appPath, '-ov', '-format', 'UDZO', dmg],
    { stdio: 'inherit' },
  )
  if (res.status !== 0) throw new Error('hdiutil failed')
  console.log('✓ dmg  :', dmg)
  console.log('\nUnsigned build — to open without the Gatekeeper prompt:')
  console.log(`  xattr -dr com.apple.quarantine "${appPath}"`)
}

main().catch((err) => {
  console.error('✗', err && err.message ? err.message : err)
  process.exit(1)
})
