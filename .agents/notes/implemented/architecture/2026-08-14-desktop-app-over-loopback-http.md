# Agent Note: The desktop app is a shell over loopback HTTP, not a second client

Status: implemented

English | [中文](2026-08-14-desktop-app-over-loopback-http.zh.md)

## Problem

DeepSeek Harness reached users as an npm package: install a Node toolchain, install `@deepseek-ai/dsh`, run `dsh --profile web`, then open a browser at the printed URL. That is a developer distribution, and it excludes everyone who does not already keep a Node toolchain. The product needed a one-click installer that launches into a window.

The layering note this repository already carries ([GUI layering](2026-07-19-gui-layering-and-rpc-protocol.md)) anticipated the opposite construction: Electron would load the built frontend over `file://` and carry `fetch` over an IPC bridge, reusing the client packages but not `dsh-host-webserver`. Several package and documentation comments stated that plan as fact.

## Decision

**The desktop app runs the existing web server over loopback and loads it in a window.** The Electron shell spawns `dsh --profile web --host 127.0.0.1 --port 0`, waits for the URL line `@deepseek-ai/dsh-web-app` prints after its Loader tree settles, and points a `BrowserWindow` at that origin. The shell holds no harness code, no product state, and no bridge into the host.

This is the whole point rather than an implementation detail: the desktop app and `dsh --profile web` run one server, one route set, and one client bundle set, so a feature cannot ship working on one surface and broken on the other. The rejected `file://` + IPC construction would have created a second transport with its own trust fence, its own request lifecycle, and its own failure modes — a permanent second integration to keep in step, in exchange for removing an HTTP hop that is already loopback-local.

**The window is unprivileged.** `contextIsolation` on, `nodeIntegration` off, `sandbox` on, no preload. The UI reaches the harness exactly as a browser tab does. Renderer privileges would add an unreviewed path into the host for no capability the app needs, and the harness is a surface that runs the model's shell commands.

**Readiness is the existing URL line, and the address is checked.** That line is already the documented readiness signal for supervisors, so the shell needs no new protocol. It is also the one value the shell takes from a subprocess and hands to a browser window, so a parsed address that is not loopback fails the launch rather than being loaded.

**The harness child runs on Electron's binary under `ELECTRON_RUN_AS_NODE`, with `--expose-internals`.** Shipping one runtime instead of two is worth a flag. The flag is not optional: the Cordis Loader reaches Node's internal ESM loader through `node-addon-require-builtin`, which refuses to load under Electron ("no compatible `GetAlignedPointerFromEmbedderData` symbol"), and without those internals bare plugin package names resolve against the Loader's own module instead of the profile, while `cordis-plugin-hmr` fails the boot outright. `requireInternal` already prefers `--expose-internals` as its route to the same internals, so this uses a supported path rather than adding one.

The resolution half of that failure is invisible in a packaged app, because the staged closure is flat and hoisted: a parent-walk from the Loader's own module finds every plugin. It is loud in the workspace, whose pnpm layout is isolated. Passing the flag fixes both; relying on the flat layout would have left a latent trap for the first nested duplicate.

**What ships is a manifest decision.** `apps/desktop/runtime/package.json` is a dependency-only deploy root — the same shape `python/sdk-runtime` uses for the single-file executable — and `verify-runtime-closure` checks that its dependency list supplies every workspace peer in the closure. Staging materializes the deployed tree symlink-free, because the vendored `link:` overrides resolve to paths that exist only in a checkout.

## Consequences

`apps/desktop` is an app, not a package: it composes nothing into the harness and exports nothing to it, so no capability seam, no plugin, and no bundle was added. The web profile is reused verbatim, which means the desktop app and the CLI share `$DSH_HOME` — one set of sessions, settings, and agent presets across both surfaces, and a single-instance lock because two harness processes would serve two ports over the same session directory.

`verify-runtime-closure` now also indexes `apps/*`, because a deploy root may name an app as its entry package; `python/sdk-runtime` is unaffected, as nothing in its closure depends on an app.

The desktop app inherits the web surface's model-visible orientation text, which describes the GUI as reached at a URL. That remains true — it is reached at that URL, in a window — but it says "Web GUI" to a user who installed a desktop app. Correcting it needs a per-surface prompt section, which is a bundle-layer change and is deliberately not part of this one.

Installer size is dominated by the staged closure (~330 MB) plus Electron; no attempt was made to prune the closure, because what to drop is a per-plugin decision and the manifest makes each one explicit when someone wants to make it.

## Alternatives considered

- **`file://` + an IPC fetch carrier**, as the layering note proposed — a second transport to keep in step with the HTTP one forever, for a hop that never leaves the loopback interface. The affected documentation was corrected rather than left describing an unbuilt plan.
- **Booting the harness inside Electron's main process** — the launcher installs process-level signal handlers, fail-loud, and a bounded shutdown, and it spawns subprocesses and worker threads. Sharing one process would put the shell and the harness in a fight over process lifetime, and a harness crash would take the window with it.
- **Shipping a separate Node binary for the child** — the obvious fix once the Electron internals failure appeared, and the fallback if `--expose-internals` is ever removed. It costs a second runtime in every installer, and was unnecessary once a supported route to the same internals was confirmed.
- **A `desktop` profile or bundle layer** — nothing in the composition actually differs from `web` today. Adding a layer to hold no differences would create a second composition to keep in step, and the first real difference (the surface prompt above) can introduce it with a reason.
