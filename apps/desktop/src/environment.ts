/**
 * The environment the harness child inherits from a desktop launch.
 *
 * A GUI launch is not a shell launch: Finder, the Dock, and Linux desktop
 * entries start the app from the session's bare environment, so `PATH` lacks
 * everything a login shell would have added (Homebrew, nvm, pyenv, per-user
 * `~/.local/bin`). The harness runs the model's shell commands, so that
 * truncated `PATH` is the difference between `git`/`node` resolving and every
 * tool call failing. This module samples the login shell's `PATH` once and
 * hands it to the child.
 * @module @deepseek-ai/dsh-desktop/environment
 */

import { execFile } from 'node:child_process'

/** How long the login-shell probe may take before the launch proceeds without it. */
const PROBE_TIMEOUT_MS = 5_000

/** Login shell used when the platform reports none. */
const FALLBACK_SHELL = '/bin/sh'

/** Runs the probe command; injected so tests need no real shell. */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { timeout: number; encoding: 'utf8' },
  callback: (error: Error | null, stdout: string) => void,
) => void

/**
 * Sample `PATH` from a login shell.
 *
 * `-lc` (login, non-interactive) is what sources the profile files that own
 * `PATH` on a desktop — `.zprofile`, `.bash_profile`, `.profile` — while
 * staying clear of the interactive startup files that print banners, wait on
 * prompts, or run job-control setup that never terminates under a pipe.
 * @param options - the shell to probe, the runner, and the platform.
 * @returns the sampled `PATH`, or `undefined` when the platform needs no
 * probe, the shell is unknown, or the probe fails or times out.
 */
export async function loginShellPath(options: {
  platform: NodeJS.Platform
  shell: string | undefined
  execFileFn?: ExecFileFn
}): Promise<string | undefined> {
  // Windows resolves the user PATH from the registry for every process,
  // including GUI launches, so there is nothing a shell probe could add.
  if (options.platform === 'win32') return undefined
  const shell = options.shell ?? FALLBACK_SHELL
  const run = options.execFileFn ?? execFile
  const sampled = await new Promise<string | undefined>((resolve) => {
    run(shell, ['-lc', 'printf %s "$PATH"'], { timeout: PROBE_TIMEOUT_MS, encoding: 'utf8' }, (error, stdout) => {
      resolve(error === null ? stdout : undefined)
    })
  })
  const trimmed = sampled?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Compose the harness child's environment.
 *
 * `ELECTRON_RUN_AS_NODE` is what makes the child a plain Node process: the
 * shell spawns the harness with its own Electron binary, so the app ships one
 * runtime instead of two, and this variable is what keeps that process from
 * starting a second Chromium. It must not survive into the model's own shell
 * commands, which the harness spawns from this environment — a build tool
 * inheriting it would silently mis-launch — so the harness's subprocess seam
 * is the layer that drops it again.
 * @param base - the shell process's own environment.
 * @param shellPath - the login-shell `PATH` from {@link loginShellPath}, when sampled.
 * @returns the environment for the harness child.
 */
export function harnessEnvironment(
  base: NodeJS.ProcessEnv, shellPath: string | undefined,
): NodeJS.ProcessEnv {
  return {
    ...base,
    ...shellPath !== undefined && { PATH: shellPath },
    ELECTRON_RUN_AS_NODE: '1',
  }
}
