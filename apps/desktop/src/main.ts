/**
 * The desktop shell's Electron main process: it starts one harness child,
 * shows one window on the loopback address that child bound, and ties the two
 * lifetimes together.
 *
 * The shell deliberately holds no harness code and no product state. Every
 * feature the window shows is served by the harness over HTTP exactly as it is
 * to a browser, so the desktop app and `dsh --profile web` cannot drift: this
 * file only supervises a process and points a window at it.
 * @module @deepseek-ai/dsh-desktop/main
 */

/* v8 ignore file -- Electron lifecycle glue; the modules it composes are covered directly. */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { startHarness, DESKTOP_PROFILE, type RunningHarness } from './harness.ts'
import { harnessEnvironment, loginShellPath } from './environment.ts'
import { harnessLogLine, openSessionLog, type SessionLog } from './log.ts'
import { HARNESS_ENTRY_ENV, resolveHarnessEntry, resolveSplashDocument } from './paths.ts'

/** Initial window size; the window is resizable and the UI is responsive below it. */
const WINDOW_SIZE = { width: 1280, height: 860 }

/** Smallest window the conversation and sidebar layout stays usable in. */
const MINIMUM_WINDOW_SIZE = { width: 720, height: 520 }

/** The single harness child, once started. */
let harness: RunningHarness | undefined

/** The single window, so `activate` reuses it instead of opening another. */
let mainWindow: BrowserWindow | undefined

/** This launch's log file, opened before the harness starts. */
let sessionLog: SessionLog | undefined

/**
 * Create the window and show the splash document while the harness binds.
 * @returns the created window.
 */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW_SIZE,
    minWidth: MINIMUM_WINDOW_SIZE.width,
    minHeight: MINIMUM_WINDOW_SIZE.height,
    show: true,
    backgroundColor: '#1b1b1f',
    title: app.getName(),
    webPreferences: {
      // The window loads only the loopback origin this shell started, and the
      // shell exposes no bridge into it: the UI reaches the harness the same
      // way a browser tab does. Renderer privileges would add a second,
      // unreviewed path into the host for no capability the app needs.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // Anything that is not this app's own origin belongs in the user's browser;
  // a harness window is a privileged surface and must not become a web browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    if (harness !== undefined && target.origin === new URL(harness.url).origin) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  window.once('closed', () => { mainWindow = undefined })
  void window.loadFile(resolveSplashDocument(app.getAppPath()))
  return window
}

/**
 * Report a failure that leaves the app with nothing to show, then quit.
 *
 * The log path is part of the message: the text a dialog can hold is a summary,
 * and the file is where the actual failure — including output from whatever the
 * harness itself spawned — was written.
 * @param summary - the one-line failure description.
 * @param detail - launcher output or error text explaining it.
 */
function failFatally(summary: string, detail: string): void {
  sessionLog?.write(`${summary}\n${detail}`)
  const logNote = sessionLog === undefined ? '' : `\n\nFull log: ${sessionLog.path}`
  dialog.showErrorBox(summary, `${detail}${logNote}`)
  app.exit(1)
}

/**
 * Start the harness and point the window at it.
 * @returns nothing; a failed launch reports and quits.
 */
async function launch(): Promise<void> {
  sessionLog = openSessionLog(app.getPath('logs'))
  const entry = resolveHarnessEntry({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    ...process.env[HARNESS_ENTRY_ENV] !== undefined && { entryOverride: process.env[HARNESS_ENTRY_ENV] },
  })
  const shellPath = await loginShellPath({ platform: process.platform, shell: process.env['SHELL'] })
  try {
    harness = await startHarness({
      // Electron's own binary doubles as the Node runtime for the child, so
      // the app ships one runtime; `harnessEnvironment` sets the variable that
      // makes that process start Node instead of a second Chromium.
      execPath: process.execPath,
      entry,
      profile: DESKTOP_PROFILE,
      // The agent's own working directory is chosen per session in the UI's
      // workspace picker; the process only needs a stable, always-readable
      // directory to start in, which a GUI launch does not otherwise have.
      cwd: app.getPath('home'),
      env: harnessEnvironment(process.env, shellPath),
      onOutput: (line) => {
        console.log(line)
        sessionLog?.write(harnessLogLine(line, new Date().toISOString()))
      },
    })
  } catch (error) {
    failFatally('DeepSeek Harness could not start', error instanceof Error ? error.message : String(error))
    return
  }
  harness.onUnexpectedExit((diagnostics) => {
    failFatally('The DeepSeek Harness process stopped', diagnostics)
  })
  mainWindow ??= createWindow()
  await mainWindow.loadURL(harness.url)
}

// A second launch must reach the running app: two harness processes would
// serve two ports over the same session directory on disk.
if (!app.requestSingleInstanceLock()) app.exit(0)

app.on('second-instance', () => {
  if (mainWindow === undefined) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

// macOS keeps an app running with no windows; every other platform treats the
// last closed window as the quit request.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow !== undefined) return
  mainWindow = createWindow()
  if (harness !== undefined) void mainWindow.loadURL(harness.url)
})

let quitting = false
app.on('before-quit', (event) => {
  if (harness === undefined || quitting) return
  // The harness owns unflushed session state, so the quit waits for its
  // bounded shutdown instead of letting Electron kill the process group.
  quitting = true
  event.preventDefault()
  void harness.stop()
    .then(async () => { await sessionLog?.close() })
    .then(() => { app.exit(0) })
})

void app.whenReady().then(launch)
