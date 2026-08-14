/**
 * Fetch the Electron runtime binary this app runs in and packages.
 *
 * Electron 43 ships no install script of its own, so the download is this
 * package's own postinstall step. It must be a no-op rather than a failure when
 * Electron is not resolvable: a production install of this package resolves no
 * devDependencies at all, and electron-builder performs exactly such an install
 * while computing the app's production dependencies. Failing there would fail
 * the packaging run over a runtime that install had no reason to fetch.
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
let installer
try {
  installer = require.resolve('electron/install.js')
} catch {
  // Electron is absent (a production or partial install); nothing to fetch.
  installer = undefined
}
if (installer === undefined) {
  console.log('ensure-electron: electron is not installed here; skipping the runtime download.')
} else {
  await import(pathToFileURL(installer).href)
}
