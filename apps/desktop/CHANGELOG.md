# Changelog

Release notes for the DeepSeek Harness desktop app. The section matching the released version becomes the body of its GitHub Release, so each entry is written for the person downloading the installer rather than for the repository.

## 0.1.0-rc.5

First desktop release. DeepSeek Harness installs and runs as an ordinary desktop application — no Node toolchain, no package manager, no terminal.

### What it is

The app starts the harness on a loopback HTTP server and shows its interface in a window. It is the same server, the same routes, and the same interface that `dsh --profile web` serves to a browser, so nothing is desktop-only and nothing can drift between the two.

Sessions, settings, and agent presets live in `~/.dsh` (`%USERPROFILE%\.dsh` on Windows) and are shared with the `dsh` command-line tool, so both surfaces see the same history.

### Installing

- **macOS** — open the `.dmg` and drag the app to Applications.
- **Windows** — run the `.exe`. It installs per user, so no administrator prompt appears.

### Known limitations

- **The installers are unsigned.** macOS reports an unidentified developer and Windows SmartScreen warns on first run; both need to be dismissed manually. Signed builds require certificates this release does not have.
- **First launch takes a few seconds** while the harness starts. The window shows a loading indicator until the server is ready.
- **One window per machine.** Launching again focuses the running window rather than starting a second harness, because two would serve the same session directory.
- **A model provider must be configured before the app is useful.** Set an API key in Settings on first run.
