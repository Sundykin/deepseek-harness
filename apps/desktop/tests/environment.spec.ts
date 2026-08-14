import { describe, expect, it } from 'vitest'
import { harnessEnvironment, loginShellPath, type ExecFileFn } from '../src/environment.ts'

/** A probe runner that answers with `stdout`, or fails when `error` is given. */
function stubExec(result: { stdout?: string; error?: Error }): ExecFileFn & { calls: { file: string; args: readonly string[] }[] } {
  const calls: { file: string; args: readonly string[] }[] = []
  const run: ExecFileFn = (file, args, _options, callback) => {
    calls.push({ file, args })
    callback(result.error ?? null, result.stdout ?? '')
  }
  return Object.assign(run, { calls })
}

describe('loginShellPath', () => {
  it('samples PATH from the login shell a GUI launch never ran', async () => {
    const exec = stubExec({ stdout: '/opt/homebrew/bin:/usr/bin\n' })
    expect(await loginShellPath({ platform: 'darwin', shell: '/bin/zsh', execFileFn: exec }))
      .toBe('/opt/homebrew/bin:/usr/bin')
    expect(exec.calls[0]).toEqual({ file: '/bin/zsh', args: ['-lc', 'printf %s "$PATH"'] })
  })

  it('falls back to a POSIX shell when the platform reports none', async () => {
    const exec = stubExec({ stdout: '/usr/bin' })
    await loginShellPath({ platform: 'linux', shell: undefined, execFileFn: exec })
    expect(exec.calls[0]?.file).toBe('/bin/sh')
  })

  it('skips the probe on Windows, where every process already gets the user PATH', async () => {
    const exec = stubExec({ stdout: 'C:\\ignored' })
    expect(await loginShellPath({ platform: 'win32', shell: 'pwsh', execFileFn: exec })).toBeUndefined()
    expect(exec.calls).toHaveLength(0)
  })

  it('reports nothing when the probe fails, so the launch proceeds on the inherited PATH', async () => {
    const exec = stubExec({ error: new Error('timed out') })
    expect(await loginShellPath({ platform: 'darwin', shell: '/bin/zsh', execFileFn: exec })).toBeUndefined()
  })

  it('treats blank output as no sample rather than an empty PATH', async () => {
    const exec = stubExec({ stdout: '  \n' })
    expect(await loginShellPath({ platform: 'darwin', shell: '/bin/zsh', execFileFn: exec })).toBeUndefined()
  })
})

describe('harnessEnvironment', () => {
  it('makes the child a Node process rather than a second Chromium', () => {
    expect(harnessEnvironment({ HOME: '/home/dev' }, undefined))
      .toEqual({ HOME: '/home/dev', ELECTRON_RUN_AS_NODE: '1' })
  })

  it('replaces the truncated GUI PATH with the sampled one', () => {
    expect(harnessEnvironment({ PATH: '/usr/bin:/bin' }, '/opt/homebrew/bin:/usr/bin:/bin'))
      .toEqual({ PATH: '/opt/homebrew/bin:/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1' })
  })

  it('keeps the inherited PATH when no sample was taken', () => {
    expect(harnessEnvironment({ PATH: '/usr/bin:/bin' }, undefined).PATH).toBe('/usr/bin:/bin')
  })
})
