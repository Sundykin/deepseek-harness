/**
 * Verify a packaged desktop app carries a runnable harness.
 *
 * Packaging is where a staged tree quietly becomes an empty one: electron-builder
 * filters what it copies, and a resource tree that lost `node_modules` still
 * produces an installer that installs and launches — and then fails at the first
 * thing the user does. This checks the packaged layout for the launcher the
 * shell spawns, the frontend the harness serves, and the native addon that
 * proves binary payloads survived the copy.
 *
 * Run with the packaged app directory, e.g.
 * `tsx scripts/verify-desktop-package.ts "apps/desktop/release/mac-arm64/DeepSeek Harness.app"`.
 */

import { existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

/** Where the resource tree sits inside each platform's packaged layout. */
const RESOURCE_ROOTS = [
  join('Contents', 'Resources'), // macOS .app bundle
  'resources', // Windows and Linux unpacked directories
] as const

/** Paths inside `resources/harness` that a runnable deployment must have. */
const REQUIRED_HARNESS_PATHS = [
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
  'node_modules/@deepseek-ai/dsh-base/cordis.patch.yml',
] as const

/** A staged closure this small lost its dependency tree during the copy. */
const MINIMUM_PACKAGE_COUNT = 100

const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true })
const appDir = positionals[0]
if (appDir === undefined) {
  throw new Error('verify-desktop-package: pass the packaged app directory')
}
const root = resolve(appDir)

const resourceRoot = RESOURCE_ROOTS
  .map(candidate => join(root, candidate))
  .find(candidate => existsSync(join(candidate, 'harness')))
if (resourceRoot === undefined) {
  throw new Error(`verify-desktop-package: no resources/harness tree under ${root}`)
}
const harness = join(resourceRoot, 'harness')

const missing = REQUIRED_HARNESS_PATHS.filter(required => !existsSync(join(harness, required)))
if (missing.length > 0) {
  throw new Error(
    `verify-desktop-package: the packaged harness is missing ${missing.join(', ')}; `
    + 'the resource copy dropped part of the staged deployment',
  )
}

const scoped = join(harness, 'node_modules', '@deepseek-ai')
const packageCount = (await readdir(scoped)).length
if (packageCount < MINIMUM_PACKAGE_COUNT) {
  throw new Error(
    `verify-desktop-package: the packaged harness holds only ${String(packageCount)} @deepseek-ai packages, `
    + `fewer than the ${String(MINIMUM_PACKAGE_COUNT)} a complete closure carries`,
  )
}

// Native addons are the payload a file filter is most likely to drop silently,
// and the harness cannot run a terminal without this one.
const ptyDir = join(harness, 'node_modules', 'node-pty')
if (!existsSync(ptyDir)) {
  throw new Error('verify-desktop-package: the packaged harness has no node-pty; native dependencies were dropped')
}

const asar = join(resourceRoot, 'app.asar')
if (!existsSync(asar) || statSync(asar).size === 0) {
  throw new Error(`verify-desktop-package: ${asar} is absent or empty`)
}

console.log(`verify-desktop-package: ${root} carries a complete harness (${String(packageCount)} @deepseek-ai packages).`)
