/**
 * The desktop app's log file.
 *
 * A packaged app has nowhere to print. The harness and everything it spawns
 * write diagnostics to stdio the shell captures, and in a terminal launch that
 * reaches the developer's console — but the user who installed an app has no
 * console, so a failure inside the harness reaches them only as whatever text
 * the interface happens to show. This writes that stream to a file instead, and
 * the shell names the file in every error it reports, so a bug report can carry
 * the actual failure rather than a summary of it.
 *
 * The file is truncated per launch: a bug report is about the session that just
 * failed, and an unbounded log in a user's profile is a liability rather than a
 * record.
 * @module @deepseek-ai/dsh-desktop/log
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

/** Log filename inside Electron's per-app log directory. */
const LOG_FILENAME = 'desktop.log'

/** One open log file, with the path to name in user-facing errors. */
export interface SessionLog {
  /** Absolute path of the log file, shown to the user when something fails. */
  path: string
  /** Append one line. */
  write: (line: string) => void
  /**
   * Flush and close, resolving once the file is written; further writes are
   * ignored. Awaitable because the shell closes the log immediately before
   * exiting, and an unflushed stream would drop exactly the lines a failure
   * wrote last.
   */
  close: () => Promise<void>
}

/**
 * Open this launch's log file.
 * @param directory - Electron's log directory (`app.getPath('logs')`).
 * @returns the open log.
 */
export function openSessionLog(directory: string): SessionLog {
  const path = join(directory, LOG_FILENAME)
  let stream: WriteStream | undefined
  try {
    mkdirSync(directory, { recursive: true })
    stream = createWriteStream(path, { flags: 'w' })
    // An unwritable log must never take the app down with it: the app's job is
    // to run the harness, and losing the diagnostic stream does not stop that.
    stream.on('error', () => { stream = undefined })
  } catch {
    // Same reason: a log directory that cannot be created is not fatal.
    stream = undefined
  }
  return {
    path,
    write: (line) => { void stream?.write(`${line}\n`) },
    close: async () => {
      const closing = stream
      stream = undefined
      if (closing === undefined) return
      await new Promise<void>((resolve) => {
        // 'error' already cleared the stream above in the ordinary path; this
        // resolve keeps a stream failing during end() from hanging the exit.
        closing.once('error', () => { resolve() })
        closing.end(resolve)
      })
    },
  }
}

/**
 * Compose the line appended for one unit of harness output.
 * @param line - the raw output line.
 * @param timestamp - ISO timestamp for the line.
 * @returns the log line.
 */
export function harnessLogLine(line: string, timestamp: string): string {
  return `[${timestamp}] ${line}`
}
