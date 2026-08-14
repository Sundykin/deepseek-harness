import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { harnessLogLine, openSessionLog } from '../src/log.ts'

/** Close the log and read what it flushed. */
async function closeAndRead(log: ReturnType<typeof openSessionLog>): Promise<string> {
  await log.close()
  return readFileSync(log.path, 'utf8')
}

describe('openSessionLog', () => {
  it('writes harness output where a bug report can reach it', async () => {
    const log = openSessionLog(mkdtempSync(join(tmpdir(), 'dsh-log-')))
    log.write('dsh web: http://127.0.0.1:3080')
    log.write('directory picker failed: worker exited')
    expect(await closeAndRead(log)).toBe('dsh web: http://127.0.0.1:3080\ndirectory picker failed: worker exited\n')
  })

  it('creates the log directory when the app has never run before', async () => {
    const log = openSessionLog(join(mkdtempSync(join(tmpdir(), 'dsh-log-')), 'logs'))
    log.write('first launch')
    expect(await closeAndRead(log)).toBe('first launch\n')
  })

  it('starts each launch from an empty file, so a report covers one session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-log-'))
    const first = openSessionLog(directory)
    first.write('previous session')
    await closeAndRead(first)
    const second = openSessionLog(directory)
    second.write('current session')
    expect(await closeAndRead(second)).toBe('current session\n')
  })

  it('keeps the app running when the log cannot be opened', async () => {
    // A path whose parent is a file cannot become a directory; the shell must
    // still start the harness, which is the app's actual job.
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-log-')), 'occupied')
    openSessionLog(file).write('ignored')
    const log = openSessionLog(join(file, 'nested'))
    expect(() => { log.write('ignored') }).not.toThrow()
    await expect(log.close()).resolves.toBeUndefined()
  })
})

describe('harnessLogLine', () => {
  it('timestamps each line so a failure can be placed in the startup sequence', () => {
    expect(harnessLogLine('dsh web: http://127.0.0.1:3080', '2026-08-14T10:00:00.000Z'))
      .toBe('[2026-08-14T10:00:00.000Z] dsh web: http://127.0.0.1:3080')
  })
})
