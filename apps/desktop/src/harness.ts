/**
 * The harness child process: how the desktop shell starts the same server the
 * `dsh --profile web` command starts, and how it learns the address to load.
 *
 * The shell owns no harness code. It spawns the launcher, which binds a
 * loopback HTTP server on an OS-assigned port and prints its URL line — the
 * readiness signal `@deepseek-ai/dsh-web-app` publishes after the Loader tree
 * settles, so a URL here means every route owner has mounted. The window then
 * loads that URL exactly as a browser would. Nothing about the transport is
 * desktop-specific, which is the point: the packaged app and `dsh --profile
 * web` run the same server, the same routes, and the same client bundles.
 * @module @deepseek-ai/dsh-desktop/harness
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

/** Bind host of the harness server; the shell never loads a non-loopback origin. */
export const LOOPBACK_HOST = '127.0.0.1'

/** Port argument requesting an OS-assigned free port, so concurrent launches never collide. */
const OS_ASSIGNED_PORT = '0'

/** Profile the desktop shell boots; the browser surface bundle composes this tree. */
export const DESKTOP_PROFILE = 'web'

/** How long the launcher may take to print its URL line before the launch is declared failed. */
const STARTUP_TIMEOUT_MS = 120_000

/** How long a stopping child may take to exit on its own before it is killed. */
const SHUTDOWN_GRACE_MS = 10_000

/** Number of trailing output lines retained to explain a failed launch. */
const DIAGNOSTIC_LINES = 40

/**
 * The URL line `@deepseek-ai/dsh-web-app` prints once its tree has settled:
 * `dsh web: http://127.0.0.1:<port>` with an optional LAN suffix this shell
 * never produces, because it always binds loopback.
 */
const URL_LINE = /^dsh web: (http:\/\/\S+)/

/**
 * Recognize the launcher's readiness line and accept only a loopback address.
 *
 * The address check is a real gate, not a formality: it is the one value the
 * shell takes from a subprocess and hands to a browser window, so a launcher
 * that somehow bound elsewhere must fail the launch rather than have the
 * window load a remote origin.
 * @param line - one line of launcher stdout.
 * @returns the loopback URL, or `undefined` when the line is not a usable readiness signal.
 */
export function parseReadyUrl(line: string): string | undefined {
  const matched = URL_LINE.exec(line)
  if (matched?.[1] === undefined) return undefined
  let parsed: URL
  try {
    parsed = new URL(matched[1])
  } catch {
    // A malformed URL is not a readiness signal; the launch keeps waiting.
    return undefined
  }
  return parsed.hostname === LOOPBACK_HOST ? parsed.origin : undefined
}

/**
 * Node runtime flag the harness needs when its runtime is Electron's.
 *
 * The Cordis Loader resolves plugin package names and drives HMR through
 * Node's internal ESM loader, which it normally reaches through the
 * `node-addon-require-builtin` addon. That addon refuses to load under
 * Electron — Electron's V8 embedder data layout has no compatible symbol — so
 * without this flag the Loader resolves bare plugin names relative to its own
 * module instead of the profile, and the HMR row fails the boot outright.
 * `requireInternal` accepts this flag as its first-choice route to the same
 * internals, so it restores exactly the capability the addon would have
 * provided. A plain Node runtime needs no flag; passing it there is still
 * correct, which keeps one argument list for both.
 */
const EXPOSE_INTERNALS = '--expose-internals'

/**
 * Build the launcher argument list for one desktop launch.
 * @param entry - absolute path of the `dsh` launcher entry.
 * @param profile - the profile to boot.
 * @returns the arguments passed to the Node runtime, runtime flags first.
 */
export function harnessArguments(entry: string, profile: string): string[] {
  return [EXPOSE_INTERNALS, entry, '--profile', profile, '--host', LOOPBACK_HOST, '--port', OS_ASSIGNED_PORT]
}

/** A running harness child and the address its window should load. */
export interface RunningHarness {
  /** The loopback origin the harness server bound. */
  url: string
  /**
   * Stop the harness and resolve once it has exited. `SIGTERM` is the
   * launcher's ordinary stop request and runs its bounded shutdown; a child
   * that has not exited within the grace window is killed, because a desktop
   * quit must complete.
   */
  stop: () => Promise<void>
  /** Registers the handler invoked when the child exits on its own. */
  onUnexpectedExit: (handler: (diagnostics: string) => void) => void
}

/** What {@link startHarness} needs to launch and supervise one child. */
export interface StartHarnessOptions {
  /** Node-capable runtime to run the launcher with (Electron's own binary). */
  execPath: string
  /** Absolute path of the `dsh` launcher entry. */
  entry: string
  /** Profile to boot. */
  profile: string
  /** Working directory of the harness process. */
  cwd: string
  /** Environment for the child, already carrying `ELECTRON_RUN_AS_NODE`. */
  env: NodeJS.ProcessEnv
  /** Receives every launcher output line, for the app's own log. */
  onOutput?: (line: string) => void
}

/**
 * Retains the last {@link DIAGNOSTIC_LINES} output lines, which are all a
 * failed launch has to explain itself with.
 */
class DiagnosticBuffer {
  private readonly lines: string[] = []

  /** Record one output line, dropping the oldest once the window is full. */
  push(line: string): void {
    this.lines.push(line)
    if (this.lines.length > DIAGNOSTIC_LINES) this.lines.shift()
  }

  /** The retained output as one block of text. */
  text(): string {
    return this.lines.join('\n')
  }
}

/**
 * Start the harness and wait until it is serving.
 * @param options - the runtime, launcher, and environment for this launch.
 * @returns the bound loopback URL and the handles to supervise the child.
 * @throws when the launcher exits, fails to spawn, or prints no URL line
 * within the startup window; the message carries its retained output.
 */
export async function startHarness(options: StartHarnessOptions): Promise<RunningHarness> {
  const child = spawn(options.execPath, harnessArguments(options.entry, options.profile), {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const diagnostics = new DiagnosticBuffer()
  const record = (line: string): void => {
    diagnostics.push(line)
    options.onOutput?.(line)
  }
  createInterface({ input: child.stderr }).on('line', record)

  const exit = new Promise<never>((_resolve, reject) => {
    child.once('error', (error) => {
      reject(new Error(`failed to start the harness process: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      const cause = signal === null ? `exit code ${String(code)}` : `signal ${signal}`
      reject(new Error(`the harness process stopped (${cause})\n\n${diagnostics.text()}`))
    })
  })
  const ready = new Promise<string>((resolve) => {
    createInterface({ input: child.stdout }).on('line', (line: string) => {
      record(line)
      const url = parseReadyUrl(line)
      if (url !== undefined) resolve(url)
    })
  })
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`the harness process did not start serving within ${String(STARTUP_TIMEOUT_MS / 1000)}s\n\n${diagnostics.text()}`))
    }, STARTUP_TIMEOUT_MS)
  })

  let url: string
  try {
    url = await Promise.race([ready, exit, timeout])
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  } finally {
    clearTimeout(timer)
  }

  const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
  let stopping = false
  return {
    url,
    stop: async () => {
      stopping = true
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGTERM')
      const grace = new Promise<void>((resolve) => { setTimeout(resolve, SHUTDOWN_GRACE_MS) })
      await Promise.race([exited, grace])
      child.kill('SIGKILL')
    },
    onUnexpectedExit: (handler) => {
      child.once('exit', () => {
        if (!stopping) handler(diagnostics.text())
      })
    },
  }
}

/** Re-exported for the supervising shell to reuse the same child type. */
export type { ChildProcess }
