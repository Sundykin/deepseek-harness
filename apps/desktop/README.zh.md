# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

桌面应用：一层 Electron 外壳，在回环 HTTP 上启动 harness，并把它的浏览器 UI 显示在窗口里。它以一键安装包分发，用户无需 Node、pnpm 或终端即可安装并运行 DeepSeek Harness。

外壳不包含任何 harness 代码，也不持有任何产品状态。它启动 `dsh --profile web --host 127.0.0.1 --port 0`，等待该 bundle 在 Loader 树稳定后打印的 URL 行，再让 `BrowserWindow` 加载该地址。窗口中的一切都经 HTTP 提供，与浏览器所得完全一致，因此桌面应用与 `dsh --profile web` 运行同一个服务器、同一套 route、同一批客户端 bundle，不会各自漂移。窗口没有渲染进程特权，也没有通往宿主的桥：UI 访问 harness 的方式与浏览器标签页相同。

harness 子进程通过 `ELECTRON_RUN_AS_NODE` 跑在 Electron 自带的二进制上，因此应用只需携带一份运行时而非两份。该二进制需要 `--expose-internals`，外壳始终传入：Cordis Loader 经 `node-addon-require-builtin` 插件访问 Node 内部 ESM loader，而该插件在 Electron 下拒绝加载，导致插件包名相对 Loader 自身模块解析、HMR 行直接让启动失败。这个标志经由 `requireInternal` 本就优先采用的路径恢复了同样的内部能力。

## 结构

| 路径 | 职责 |
|---|---|
| `src/main.ts` | Electron 生命周期：窗口、单实例锁、外部链接、退出 |
| `src/harness.ts` | 启动并监督 harness 子进程；解析其就绪行 |
| `src/environment.ts` | 子进程环境，含 GUI 启动所缺的登录 shell `PATH` |
| `src/paths.ts` | 启动器在工作区与已打包应用中的位置 |
| `runtime/package.json` | 纯依赖的部署根，定义安装包所携带的内容 |
| `electron-builder.yml` | 安装包目标：dmg、一键 NSIS、AppImage、deb |

## 构建安装包

```sh
pnpm run build                    # the launcher bin and the frontend dist are inputs
pnpm --filter @deepseek-ai/dsh-desktop run stage    # deploy the harness closure
pnpm --filter @deepseek-ai/dsh-desktop run dist     # build installers into release/
```

暂存步骤会把闭包的无符号链接副本落到 `build/harness`，安装包以 `resources/harness` 携带它；否则 vendored `link:` 覆盖会解析到只存在于本 checkout 的路径。闭包本身就是 `runtime/package.json` 的依赖清单，由 `verify-runtime-closure` 校验，因此发布内容是一项清单决策，而不是打包器在磁盘上碰巧找到的东西。

## 从工作区运行

```sh
pnpm --filter @deepseek-ai/dsh-desktop run start
```

它让已构建的外壳对接同级的 `apps/cli` 启动器，无需暂存。设置 `DSH_DESKTOP_HARNESS_ENTRY` 可改为对接另一个 checkout 的启动器。

## 诊断故障

打包后的应用没有控制台，因此外壳会把 harness 及其子进程打印的一切写入日志文件，每次启动清空：

| 平台 | 日志 |
|---|---|
| macOS | `~/Library/Logs/DeepSeek Harness/desktop.log` |
| Windows | `%APPDATA%\DeepSeek Harness\logs\desktop.log` |
| Linux | `~/.config/DeepSeek Harness/logs/desktop.log` |

外壳报告的任何故障都会附上该路径。界面报告的故障——会话中途某个工具或选择器失败——其诊断信息同样写入这个文件，反馈问题时应以它为准：对话框能容纳的只是摘要，文件里才有调用栈。

## 限制

应用与 `dsh` CLI 共用 `$DSH_HOME`，因此会话、设置与 agent preset 在两个界面上是同一份。再次启动会聚焦已运行的窗口，而不是启动第二个 harness：两个 harness 进程会在同一会话目录上提供两个端口。

除非向 electron-builder 提供签名凭据，否则安装包未签名，macOS 与 Windows 在首次启动时会给出警告，直到补上签名为止。harness 进程持有尚未落盘的会话状态，因此退出会等待其有界关停，而不是杀死整个进程组。
