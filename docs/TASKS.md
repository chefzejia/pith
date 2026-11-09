# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；**每完成一单必须在进入下一单前立即将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #26] 设置面板重构（Agent 右侧对齐与单键刷新、云端语音平铺显隐、本机语音单主按钮与安装修复）

- **Status**: verified
- **Scope**: `src/shells/obsidian/**`, `src/shells/web/**`, `src/shells/speech/**`, `src/workbench/**`, `scripts/**`, `tests/**`
- **Verified-Commit**: 1f6b821e4603539504dbac2af9b4dc4475c2776d
- **Updated**: 2026-11-08
- **验收摘要**：Worker 完成类型检查、全仓测试（223 通过、46 跳过）、构建与手动破壁，三个插件产物已同步至 `ganfan-media`。Tester 在 Web 与隔离 Obsidian 通过 Agent 对齐刷新、语音模式互斥、安装中重开与失败反馈、已安装操作验收（终验截图 `.tmp/evidence/task-26/final-1f6b821-*.png`）。

---

## [Task #27] 阅读舞台键盘翻页焦点自动接管 & EPUB 深色模式字色可读性修复（对齐 `ganfan-garden` 渲染演进）

- **Status**: verified
- **Scope**: `src/workbench/**`, `src/plugins/stage-reader/**`, `tests/**`
- **Verified-Commit**: 779c063ae931b5157db06a41b05b5e569b8d954d
- **Updated**: 2026-11-08
- **验收摘要**：Tester 在 Web 与隔离 Obsidian 实际导入《女人的性爱动机》沙盒副本，验证看板进书首次方向键直接翻页、输入焦点保护、原书浅黄底章节生效及明暗主题正文对比度（最低 4.54:1，截图 `.tmp/evidence/task-27/final-*.png`）。

---

## [Task #28] 本机语音引擎下载实时进度可视化、断点续传抗超时与取消控制

- **Status**: pending
- **Scope**: `src/shells/speech/**`, `src/workbench/**`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-09
- **授权范围**：允许修改 `src/shells/speech/speechRuntime.ts`、`src/workbench/speechRuntimeSettings.ts`、`src/shells/obsidian/index.ts`、`src/shells/web/client.ts`、`src/shells/web/server.ts` 及 `tests/**`。只读消费 `src/core/seams.ts` 已有的 `ManagedSpeechState.progressPercent`、`downloadSizeMb` 与 `ManagedSpeechRuntimePort.stop()`。
- **不在范围内**：严禁修改 `src/core/` 冻结契约（`ManagedSpeechState` 已定义 `progressPercent?: number` 与 `downloadSizeMb?: number`，`ManagedSpeechRuntimePort` 已定义 `stop?(): Promise<ManagedSpeechState>`，无需改动核心接口）；严禁修改 `model` / `effort` 既有行为。
- **背景与实证根因**：
  - 用户在真实 Obsidian（`ganfan-media`）中点击 `[安装引擎]` 后，界面长时间停留在静态文字 `安装中…：正在下载 Node 运行时` 且右侧按钮锁死为 `正在安装…`，看起来完全像黑盒卡死：
  - **根因 1（无实时字节进度与可视化进度条）**：`src/shells/speech/speechRuntime.ts:34, 108-129` 使用 `curl --silent` 且 `stdio: "ignore"`，在下载 Node（~45MB）、`sherpa-onnx`、Kokoro TTS（~140MB）与 SenseVoice ASR（~1000MB，合计约 1.2GB）的漫长过程中，从未填充 `ManagedSpeechState.progressPercent`，`src/workbench/speechRuntimeSettings.ts:23` 也未渲染 `<progress>` 进度条或 `已下载 X MB / Y MB (Z%)`；
  - **根因 2（慢网必死超时 + 失败重头下、无断点续传与低速卡死检测）**：`speechRuntime.ts:109` 硬编码 `--max-time 600`（实测用户本机拉取 `nodejs.org` 10 分钟仅下完 35MB/47MB 即触发 `exit 28` 失败！而 SenseVoice 高达 1GB，`--max-time 1200` 在慢网下必挂），且每次重试覆盖重下 `node.tar.gz`，没有断点续传或已校验归档复用，也没有 `--connect-timeout 15 --speed-limit 10240 --speed-time 30` 捕获真断流并自动断点重试；
  - **根因 3（Electron/Obsidian GUI 代理环境缺失 + 安装期间无法取消）**：macOS 从 Finder 启动的 Obsidian 进程 `process.env` 中通常不含终端的 `HTTPS_PROXY`，而 `speechRuntime.ts:33` 仅透传 `process.env`；同时安装期间右侧按钮完全禁用，未暴露已有的 `stop()` 取消能力。
- **接口与行为契约**：
  1. **流式下载实时字节统计、进度百分比与可视 `<progress>` 进度条（`speechRuntime.ts` & `speechRuntimeSettings.ts`）**：
     - 在 `NodeManagedSpeechRuntime` 下载阶段（可改用 Node 原生流式 HTTP/HTTPS 下载或监控目标归档文件实时字节增长 + `Content-Length` / 已知各阶段预期字节权重）实时更新当前步骤（如 `步骤 1/5 · 正在下载 Node 运行时`）、**当前文件已下载/总大小（如 `34.2 / 45.5 MB`）**以及整体或阶段 **`progressPercent`（`0 ~ 100`）**；解压与哈希校验阶段同样给出清晰阶段提示（如 `正在校验与解压 TTS 模型…`）；
     - 在 `src/workbench/speechRuntimeSettings.ts` 中，当 `status === "installing"` 时，除简洁阶段与 `MB / %` 文本外，渲染一个干净的原生 `<progress max="100" value="...">` 进度条（搭配书卷主题 `--pith-sage` 样式，Web 与 Obsidian 共享同一样式），每秒轮询平滑推进，彻底消灭黑盒卡死感。
  2. **断点续传（Range / `-C -`）、已下载归档复用与慢网抗超时重试（`speechRuntime.ts`）**：
     - **移除误杀慢速正常下载的固定短 `--max-time` 硬切**，改为连接超时与低速无响应检测（如连接超时 `20s`，连续 `30s` 传输速率低于 `1 KB/s` 才视为卡死中断，并自动带指数退避断点重试最多 3 次）；
     - **支持断点续传与已完整下载归档校验跳过**：若目标目录中已存在部分下载的 `.part` / 归档文件（如刚才已下载 35MB 的 `node.tar.gz`），重试或继续安装时使用 HTTP `Range` / `curl -C -` 从断点处续传（若已存在完整归档且 SHA-256/SHA-512 校验通过，直接跳过下载进入解压）；仅当校验明确不匹配已完结文件时才删除重下；
     - **macOS 系统代理自动感知（零额外依赖）**：当 `process.env.HTTPS_PROXY / https_proxy` 未设置且 `process.platform === "darwin"` 时，可通过 `scutil --proxy`（短超时安全读取，失败静默忽略）检测系统开启的 HTTP/HTTPS 本地代理端口并注入下载环境，大幅提升桌面 GUI 宿主在代理环境下的 GitHub Releases / Node 下载速度。
  3. **安装中支持一键 `[取消安装]`（`speechRuntimeSettings.ts` & `obsidian/index.ts` & `web/client.ts`）**：
     - 当 `status === "installing"` 时，右侧操作区不再把按钮死锁为不可点的 `正在安装…`，而是提供可点击的次级按钮 **`[取消安装]`**（调用已有的 `stop` 动作中止在途下载进程，保留已下好的 `.part` 分片供下次断点续传，状态干净回退至 `未安装`）。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿（自动同步至 `.dev-vault` 与 `ganfan-media`）；新增单测与浏览器回归测试覆盖：1) 本地受控慢速流式 HTTP 服务分块下发归档时，`getState()` 返回递增的字节/百分比且 UI `<progress>` 与 `MB` 文本实时推进；2) 中途断开连接或点击 `[取消安装]` 后再次点击 `[安装引擎]`，验证服务端收到 `Range: bytes=<offset>-` 实现断点续传并最终校验通过；完成手动破壁验证并截屏存入 `.tmp/evidence/task-28/` 自检。
- **Tester 模拟用户终验要求**：在 Web 与隔离 Obsidian 中验证点击 `[安装引擎]` 后进度条、`MB / %` 数值动态递增、`[取消安装]` 立即生效且再次点击可续传完成，终验截图归档至 `.tmp/evidence/task-28/`。
