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
import { cp, readFile, readdir, realpath, rm } from 'node:fs/promises'
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

/** Where pnpm's legacy deploy leaves direct packages it hoists out of the target. */
const DEPLOY_SOURCE_NODE_MODULES = 'apps/desktop/runtime/node_modules'

/** Build outputs that must exist before staging, with the command that produces them. */
const REQUIRED_BUILD_OUTPUTS = [
  'apps/cli/lib/bin.js',
  'apps/web/dist/index.html',
] as const

/** pnpm's platform-specific executable name. */
function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/** The workspace's own tsx runner, invoked without a package-manager wrapper. */
function tsxBin(): string {
  return join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
}

/**
 * Windows batch wrappers (`pnpm.cmd`, `tsx.cmd`) are the only form these tools
 * take there, and Node refuses to spawn a `.cmd` without a shell. Under a shell
 * the command line is re-parsed, so anything containing whitespace or a shell
 * metacharacter — a checkout path with a space, most often — has to be quoted.
 */
const SPAWN_THROUGH_SHELL = process.platform === 'win32'

/** Quote one command-line word when a shell will re-parse it. */
function shellArgument(value: string): string {
  return SPAWN_THROUGH_SHELL && /[\s&|<>^()"]/.test(value) ? `"${value}"` : value
}

/**
 * Run a command to completion, streaming its output.
 * @param command - the executable.
 * @param args - its arguments.
 * @param env - environment additions layered over this process's own.
 * @throws when the command cannot start or exits non-zero.
 */
async function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  console.log(`stage-desktop-harness: ${command} ${args.join(' ')}`)
  const code = await new Promise<number | null>((resolveExit, rejectExit) => {
    const child = spawn(shellArgument(command), args.map(shellArgument), {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: SPAWN_THROUGH_SHELL,
    })
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
 * Copy back the direct dependencies pnpm's legacy deploy hoists beside the
 * deploy source instead of into the target.
 *
 * Each package is copied without its own `node_modules`: the closure is flat,
 * and a nested tree would introduce a second copy of Cordis, whose services
 * would then be invisible to plugins resolving the other instance.
 * @param staging - the staged tree.
 * @throws when a declared dependency is in neither location.
 */
async function restoreHoistedDependencies(staging: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const source = resolve(root, DEPLOY_SOURCE_NODE_MODULES)
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const hoisted = join(source, dependency)
    if (!existsSync(hoisted)) {
      throw new Error(`stage-desktop-harness: deployed dependency ${dependency} is in neither ${destination} nor ${hoisted}`)
    }
    console.log(`stage-desktop-harness: restoring ${dependency}`)
    const nested = join(hoisted, 'node_modules')
    await cp(hoisted, destination, {
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

// The local runner, not `pnpm run` (which forwards its own `--` separator into
// the script and trips its positional-free parsing) and not `pnpm exec` (whose
// dependency-status check wants to purge a modules directory that a previous
// production deploy left looking stale, which cannot be confirmed without a TTY).
await run(tsxBin(), ['scripts/verify-runtime-closure.ts', '--manifest', 'apps/desktop/runtime/package.json'])
await rm(staging, { recursive: true, force: true })
try {
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
  // A deploy is a batch step with no one to answer a prompt; this is pnpm's own
  // documented switch for that, and it keeps the run reproducible besides.
  ], { CI: 'true' })
  await restoreHoistedDependencies(staging)
  await materializeLinks(staging)
  await verifyStaging(staging)
} finally {
  // `pnpm deploy --prod` runs a production install rooted at this workspace,
  // which prunes every devDependency from the checkout it was run in — the
  // packager, the compilers, and the test runner among them. Restoring is not
  // cleanup but part of the step: without it the next command in the same
  // session, in CI or on a developer's machine, runs against a gutted
  // workspace. It runs on failure too, so a broken staging run does not also
  // leave the checkout unusable.
  //
  // The deploy source's own tree is removed first: the legacy deploy leaves
  // production-only dependencies there, which every later pnpm command would
  // otherwise read as a stale workspace member.
  await rm(resolve(root, DEPLOY_SOURCE_NODE_MODULES), { recursive: true, force: true })
  // Same non-interactive switch as the deploy: the restore must not stop on a
  // confirmation prompt in CI or in any other run without a terminal.
  await run(pnpmBin(), ['install', '--frozen-lockfile'], { CI: 'true' })
}
console.log(`stage-desktop-harness: staged ${relative(root, staging)}`)
