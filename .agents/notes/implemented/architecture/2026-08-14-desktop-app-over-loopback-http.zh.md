# Agent Note：桌面应用是回环 HTTP 之上的外壳，而非第二个客户端

Status: implemented

[English](2026-08-14-desktop-app-over-loopback-http.md) | 中文

## 问题

DeepSeek Harness 此前只以 npm 包触达用户：先装 Node 工具链，再装 `@deepseek-ai/dsh`，运行 `dsh --profile web`，然后在浏览器里打开打印出的 URL。那是一种面向开发者的分发方式，把所有本就不维护 Node 工具链的人排除在外。产品需要一个一键安装、直接进入窗口的形态。

本仓库既有的分层记录（[GUI 分层](2026-07-19-gui-layering-and-rpc-protocol.md)）设想的是相反的构造：Electron 经 `file://` 加载已构建前端，并通过 IPC 桥承载 `fetch`，复用客户端包但不使用 `dsh-host-webserver`。多处包与文档注释把该计划当作既成事实来陈述。

## 决策

**桌面应用在回环上运行既有的 web 服务器，并在窗口中加载它。** Electron 外壳启动 `dsh --profile web --host 127.0.0.1 --port 0`，等待 `@deepseek-ai/dsh-web-app` 在 Loader 树稳定后打印的 URL 行，再让 `BrowserWindow` 加载该 origin。外壳不含 harness 代码、不持有产品状态、也没有通往宿主的桥。

这正是要点本身，而非实现细节：桌面应用与 `dsh --profile web` 运行同一个服务器、同一套 route、同一批客户端 bundle，因此一个特性不可能在一个界面上可用而在另一个界面上损坏。被否决的 `file://` + IPC 构造会造出第二条传输链路，带着自己的信任栅栏、自己的请求生命周期、自己的失效模式——一份需要长期保持同步的第二套集成，换来的只是省掉一次本就不出回环接口的 HTTP 跳转。

**窗口没有特权。** `contextIsolation` 开、`nodeIntegration` 关、`sandbox` 开、无 preload。UI 访问 harness 的方式与浏览器标签页完全一致。渲染进程特权只会为应用并不需要的能力，额外开出一条未经评审的通往宿主的路径，而 harness 恰是一个会执行模型 shell 命令的界面。

**就绪信号沿用既有的 URL 行，并校验地址。** 该行本就是面向监督进程的既定就绪信号，因此外壳无需新增协议。它同时是外壳唯一从子进程取得、又交给浏览器窗口的值，所以解析出的地址若不是回环地址，就让启动失败，而不是加载它。

**harness 子进程在 `ELECTRON_RUN_AS_NODE` 下跑在 Electron 的二进制上，并带 `--expose-internals`。** 只携带一份运行时而非两份，值得为此传一个标志。该标志并非可选：Cordis Loader 经 `node-addon-require-builtin` 访问 Node 内部 ESM loader，而该插件在 Electron 下拒绝加载（"no compatible `GetAlignedPointerFromEmbedderData` symbol"）；缺少这些内部能力时，bare 插件包名会相对 Loader 自身模块解析，而 `cordis-plugin-hmr` 会直接让启动失败。`requireInternal` 本就把 `--expose-internals` 作为通往同一内部能力的首选路径，因此这里用的是既有的受支持路径，而非新增一条。

该失效中的解析那一半在已打包应用里是不可见的，因为暂存闭包是扁平且 hoisted 的：从 Loader 自身模块向上走即可找到每个插件。它在工作区里则会显式爆出来，因为 pnpm 布局是隔离式的。传入该标志同时修好两者；依赖扁平布局则会为第一个嵌套副本留下一个潜伏的陷阱。

**发布内容是一项清单决策。** `apps/desktop/runtime/package.json` 是纯依赖的部署根——与 `python/sdk-runtime` 用于单文件可执行体的形态相同——并由 `verify-runtime-closure` 校验其依赖清单供齐了闭包中的每一个 workspace peer。暂存会把部署树落成无符号链接的形态，因为 vendored `link:` 覆盖解析到的路径只存在于某个 checkout 中。

## 影响

`apps/desktop` 是一个 app 而非 package：它不向 harness 组合任何东西，也不向其导出任何东西，因此没有新增能力 seam、插件或 bundle。web profile 被原样复用，这意味着桌面应用与 CLI 共用 `$DSH_HOME`——两个界面共享同一份会话、设置与 agent preset；也因此需要单实例锁，否则两个 harness 进程会在同一会话目录上提供两个端口。

`verify-runtime-closure` 现在同时索引 `apps/*`，因为部署根可能以某个 app 作为入口包；`python/sdk-runtime` 不受影响，其闭包中没有任何东西依赖 app。

桌面应用继承了 web 界面面向模型的定位文本，那段文本把 GUI 描述为经某个 URL 访问。这依然为真——它确实经该 URL 访问，只是在一个窗口里——但对安装了桌面应用的用户来说，它说的是"Web GUI"。纠正它需要按界面区分的 prompt section，那属于 bundle 层变更，此处刻意不做。

安装包体积由暂存闭包（约 330 MB）与 Electron 主导；这里没有尝试裁剪闭包，因为砍掉什么是逐插件的判断，而清单让每一项判断在有人想做时都是显式可见的。

## 已考虑的替代方案

- **`file://` + IPC fetch 载体**，即分层记录所提议的方案——为一次从不离开回环接口的跳转，换来一条需要与 HTTP 那条长期保持同步的第二传输链路。相关文档已被更正，而不是继续描述一个未落地的计划。
- **在 Electron 主进程内启动 harness**——启动器会安装进程级信号处理、fail-loud 与有界关停，并会派生子进程与 worker 线程。共用一个进程会让外壳与 harness 争夺进程生命周期，且 harness 崩溃会连窗口一起带走。
- **为子进程随包携带独立的 Node 二进制**——在 Electron 内部能力失效暴露后，这是显而易见的修法，也是 `--expose-internals` 将来若被移除时的退路。它的代价是每个安装包里多一份运行时；在确认存在通往同一内部能力的受支持路径后，它就没有必要了。
- **单独的 `desktop` profile 或 bundle 层**——今天其组合与 `web` 并无任何差异。为了容纳"没有差异"而加一层，只会造出第二份需要保持同步的组合；等第一处真实差异（上文的界面 prompt）出现时，再由它带着理由引入即可。
