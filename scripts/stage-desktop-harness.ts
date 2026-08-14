/**
 * Stage the harness deployment the desktop installer ships.
 *
 * The desktop app carries a complete, self-contained install of
 * `@deepseek-ai/dsh` under `resources/harness` and spawns its launcher over
 * loopback HTTP. That closure is defined by `apps/desktop/runtime/package.json`
 * — a dependency-only deploy root, the same shape the single-file executable
 * build uses — so what the installer ships is a manifest decision the
 * `verify-runtime-closure` gate checks, not whatever the packager happened to
 * find on disk.
 *
 * Two staging facts are load-bearing. The tree is materialized symlink-free
 * because pnpm resolves the vendored `link:` overrides to paths in this
 * checkout, which do not exist on a user's machine. And it is staged from
 * built artifacts, so `pnpm run build` must have run first: the launcher bin
 * and the frontend dist are inputs here, never built as a side effect.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, readdir, realpath, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** The closure manifest whose dependencies define what the installer ships. */
const DEPLOY_ROOT_PACKAGE = 'dsh-desktop-runtime-pkg'

/** Staging directory, referenced by `extraResources` in the electron-builder config. */
const STAGING_DIR = 'apps/desktop/build/harness'

/** The launcher the desktop shell spawns, inside the staged closure. */
const STAGED_LAUNCHER = 'node_modules/@deepseek-ai/dsh/lib/bin.js'

/** The built browser bundle the harness serves, inside the staged closure. */
const STAGED_FRONTEND_INDEX = 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html'

/** Build outputs that must exist before staging, with the command that produces them. */
const REQUIRED_BUILD_OUTPUTS = [
  'apps/cli/lib/bin.js',
  'apps/web/dist/index.html',
] as const

/** pnpm's platform-specific executable name. */
function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Run a command to completion, streaming its output.
 * @param command - the executable.
 * @param args - its arguments.
 * @throws when the command cannot start or exits non-zero.
 */
async function run(command: string, args: readonly string[]): Promise<void> {
  console.log(`stage-desktop-harness: ${command} ${args.join(' ')}`)
  const code = await new Promise<number | null>((resolveExit, rejectExit) => {
    const child = spawn(command, [...args], { cwd: root, stdio: 'inherit' })
    child.once('error', rejectExit)
    child.once('close', resolveExit)
  })
  if (code !== 0) throw new Error(`stage-desktop-harness: ${command} exited with code ${String(code)}`)
}

/**
 * Find one symlink under `dir` whose target escapes `boundary`.
 *
 * Links that stay inside the staged tree (pnpm's `.bin` shims) are left alone:
 * they resolve wherever the tree is installed. A link out of the tree resolves
 * only on this checkout, so it must be replaced by its contents.
 * @param dir - directory to search.
 * @param boundary - the staged tree the links must stay within.
 * @returns the first escaping link found, or `undefined` when the tree is closed.
 */
async function findEscapingLink(dir: string, boundary: string): Promise<string | undefined> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      // A link to a deleted target cannot be staged either; treat it as escaping
      // so the copy below fails loudly instead of shipping a dangling link.
      const target = await realpath(path).catch(() => undefined)
      if (target === undefined || target === boundary || !target.startsWith(boundary + sep)) return path
      continue
    }
    if (!entry.isDirectory()) continue
    const found = await findEscapingLink(path, boundary)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Replace every out-of-tree symlink with a copy of its contents.
 *
 * Each package's own `node_modules` is excluded from the copy: the closure is
 * flat and hoisted, so a nested tree would introduce a second copy of Cordis,
 * and a second Cordis means services registered in one instance are invisible
 * to plugins resolving the other.
 * @param staging - the staged tree.
 */
async function materializeLinks(staging: string): Promise<void> {
  const nodeModules = join(staging, 'node_modules')
  for (
    let link = await findEscapingLink(nodeModules, staging);
    link !== undefined;
    link = await findEscapingLink(nodeModules, staging)
  ) {
    const source = await realpath(link)
    const nested = join(source, 'node_modules')
    console.log(`stage-desktop-harness: materializing ${relative(staging, link)}`)
    await rm(link, { recursive: true, force: true })
    await cp(source, link, {
      recursive: true,
      dereference: true,
      filter: path => path !== nested && !path.startsWith(nested + sep),
    })
  }
}

/**
 * Verify the staged tree carries what the desktop shell spawns and serves.
 * @param staging - the staged tree.
 * @throws when a required artifact is absent.
 */
async function verifyStaging(staging: string): Promise<void> {
  for (const required of [STAGED_LAUNCHER, STAGED_FRONTEND_INDEX]) {
    if (!existsSync(join(staging, required))) {
      throw new Error(`stage-desktop-harness: staged closure is missing ${required}`)
    }
  }
  const escaping = await findEscapingLink(join(staging, 'node_modules'), staging)
  if (escaping !== undefined) {
    throw new Error(`stage-desktop-harness: staged closure still links outside itself: ${relative(staging, escaping)}`)
  }
}

const staging = resolve(root, STAGING_DIR)
// The staging path is cleared wholesale; a misconfigured constant must not be
// able to take the checkout with it.
if (staging === root || root.startsWith(staging + sep)) {
  throw new Error(`stage-desktop-harness: refusing to clear ${staging}: it contains the repository root`)
}
const missing = REQUIRED_BUILD_OUTPUTS.filter(output => !existsSync(resolve(root, output)))
if (missing.length > 0) {
  throw new Error(
    `stage-desktop-harness: build outputs are missing (${missing.join(', ')}); run 'pnpm run build' first`,
  )
}

await run(pnpmBin(), ['run', 'verify-runtime-closure', '--', '--manifest', 'apps/desktop/runtime/package.json'])
await rm(staging, { recursive: true, force: true })
// The same deploy flags the single-file executable build uses: a hoisted, flat
// closure with peers supplied by the manifest rather than auto-installed.
await run(pnpmBin(), [
  '--filter', DEPLOY_ROOT_PACKAGE,
  'deploy',
  '--legacy',
  '--prod',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true',
  staging,
])
await materializeLinks(staging)
await verifyStaging(staging)
console.log(`stage-desktop-harness: staged ${relative(root, staging)}`)
