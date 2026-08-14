/**
 * Filesystem anchors of the desktop shell: where the harness launcher lives in
 * each of the two layouts this app runs in.
 *
 * Development runs from the workspace, where `apps/desktop` sits beside
 * `apps/cli` and the launcher is that package's built bin. A packaged app
 * carries a self-contained deployment of the same package under
 * `resources/harness` (staged by `scripts/stage-desktop-harness.ts`), so the
 * launcher is reached from `process.resourcesPath` instead. Both layouts run
 * the identical `lib/bin.js`; only its location differs.
 * @module @deepseek-ai/dsh-desktop/paths
 */

import { join } from 'node:path'

/** Directory under `resources/` holding the staged harness deployment in a packaged app. */
export const STAGED_HARNESS_DIR = 'harness'

/** Path of the launcher inside a harness package root, in both layouts. */
const LAUNCHER_RELATIVE_PATH = join('lib', 'bin.js')

/** Environment variable pinning the launcher explicitly, for running the shell against another checkout. */
export const HARNESS_ENTRY_ENV = 'DSH_DESKTOP_HARNESS_ENTRY'

/** The layout facts {@link resolveHarnessEntry} decides from. */
export interface HarnessEntryFacts {
  /** Whether Electron is running from a packaged app (`app.isPackaged`). */
  packaged: boolean
  /** Electron's `process.resourcesPath`; only read when packaged. */
  resourcesPath: string
  /** Electron's `app.getAppPath()`: this package's root in development, the asar root when packaged. */
  appPath: string
  /** The launcher override from {@link HARNESS_ENTRY_ENV}, absent when unset. */
  entryOverride?: string
}

/**
 * Resolve the absolute path of the harness launcher this shell spawns.
 * @param facts - the layout this Electron process is running in.
 * @returns the absolute path of the `dsh` launcher entry.
 */
export function resolveHarnessEntry(facts: HarnessEntryFacts): string {
  if (facts.entryOverride !== undefined && facts.entryOverride !== '') return facts.entryOverride
  if (facts.packaged) return join(facts.resourcesPath, STAGED_HARNESS_DIR, LAUNCHER_RELATIVE_PATH)
  // Development: apps/desktop and apps/cli are siblings in the workspace.
  return join(facts.appPath, '..', 'cli', LAUNCHER_RELATIVE_PATH)
}

/**
 * Resolve the splash document shown while the harness is still binding. It
 * ships beside the bundled main entry in both layouts, so one appPath-relative
 * hop reaches it inside the asar archive as well.
 * @param appPath - Electron's `app.getAppPath()`.
 * @returns the absolute path of the splash document.
 */
export function resolveSplashDocument(appPath: string): string {
  return join(appPath, 'static', 'splash.html')
}
