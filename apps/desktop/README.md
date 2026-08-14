# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

The desktop application: an Electron shell that starts the harness on loopback HTTP and shows its browser UI in a window. It is distributed as one-click installers, so a user installs and runs DeepSeek Harness without Node, pnpm, or a terminal.

The shell contains no harness code and no product state. It spawns `dsh --profile web --host 127.0.0.1 --port 0`, waits for the URL line that bundle prints once its Loader tree has settled, and points a `BrowserWindow` at that address. Everything the window shows is served over HTTP exactly as it is to a browser, so the desktop app and `dsh --profile web` run the same server, the same routes, and the same client bundles, and cannot drift apart. The window has no renderer privileges and no bridge into the host: the UI reaches the harness the way a browser tab does.

The harness child runs on Electron's own binary through `ELECTRON_RUN_AS_NODE`, so the app ships one runtime rather than two. That binary needs `--expose-internals`, which the shell always passes: the Cordis Loader reaches Node's internal ESM loader through the `node-addon-require-builtin` addon, and that addon refuses to load under Electron, leaving plugin package names to resolve against the Loader's own module and the HMR row to fail the boot. The flag restores the same internals through the route `requireInternal` already prefers.

## Layout

| Path | Role |
|---|---|
| `src/main.ts` | Electron lifecycle: window, single-instance lock, external links, quit |
| `src/harness.ts` | Spawns and supervises the harness child; parses its readiness line |
| `src/environment.ts` | The child's environment, including the login-shell `PATH` a GUI launch lacks |
| `src/paths.ts` | Where the launcher lives in the workspace and in a packaged app |
| `runtime/package.json` | Dependency-only deploy root defining what the installer ships |
| `electron-builder.yml` | Installer targets: dmg, one-click NSIS, AppImage, deb |

## Building installers

```sh
pnpm run build                    # the launcher bin and the frontend dist are inputs
pnpm --filter @deepseek-ai/dsh-desktop run stage    # deploy the harness closure
pnpm --filter @deepseek-ai/dsh-desktop run dist     # build installers into release/
```

Staging materializes a symlink-free copy of the closure into `build/harness`, which the installer carries as `resources/harness`; the vendored `link:` overrides otherwise resolve to paths that exist only in this checkout. The closure itself is the `runtime/package.json` dependency list, checked by `verify-runtime-closure`, so what ships is a manifest decision rather than whatever the packager found on disk.

## Running from the workspace

```sh
pnpm --filter @deepseek-ai/dsh-desktop run start
```

This runs the built shell against the sibling `apps/cli` launcher, so no staging is needed. Set `DSH_DESKTOP_HARNESS_ENTRY` to run it against another checkout's launcher instead.

## Limitations

The app shares `$DSH_HOME` with the `dsh` CLI, so sessions, settings, and agent presets are the same on both surfaces. A second launch focuses the running window rather than starting a second harness, because two harness processes would serve two ports over the same session directory.

The installers are unsigned unless signing credentials are supplied to electron-builder; macOS and Windows will warn on first launch until they are. The harness process holds unflushed session state, so quitting waits for its bounded shutdown instead of killing the process group.
