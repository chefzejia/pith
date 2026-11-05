# Pith · 跨会话交接单（HANDOFF Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈协同契约（详见 [ROLES.md](ROLES.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/003-interaction.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（区块内标记 `- **Status**: pending`）写入本文件，并执行隔离提交 `git commit --only docs/HANDOFF.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒，在同一轮次内循环 `wait_agent` 按序调度常驻 Worker 与独立 Tester 完成实现与 `.dev-vault` 真机验收：每完成一单先重读确认未被标为 `superseded`，再仅将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附 `Verified-Commit`）并 `git commit`；**提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #13] 架构清创：铲除函数重赋值套娃、抠源码字符串假测试、沙盒快照反模式，并统一 1/2/3 栏用户偏好分页与 PluginRuntime 热重配

- **Status**: verified
- **Verified-Commit**: 9c3ce87
- **Updated**: 2026-11-04
- **验收**：Worker 完成 typecheck、205 项测试及 Obsidian 构建；Tester 在 Web 与 `.dev-vault` Obsidian 验证长中文连续缩放、分栏、字号、离线设置、真实书籍连续翻页及窗口边缘拖拽缩窄，截图位于 `.tmp/task13-visual/screenshots/round4-*` 至 `round6-*`。原生拖拽扩宽未验证；音频栏开合已验证，未验证音频播放。
- **上游 Brain 根因修复（解除 `blocked`）**：
  - 针对 Tester 第三轮视觉验收抓到的真实 Bug（跨页无空格长中文段落从 `1600×900` 缩放至 `1100×700` 时位置回退至上一屏）：
    1. **根因 1（多列跨页 Range 的 `getBoundingClientRect` 退化）**：当一个长中文文本块跨越多列（多页）且被匹配为一个整块 `\S+` 时，`range.getBoundingClientRect()` 返回的是跨越第 1 列与第 2 列的合并外包框（其 `rect.left` 永远等于第 1 列的左边界）；当某字符恰好处于跨列折行边界时，必须检查 `Array.from(range.getClientRects())` 中真正具有宽高且落入当前视口的单个字符片段矩形，并在 `restoreReaderPosition` 中优先使用折叠光标点（或末片段矩形）计算列偏移；
    2. **根因 2（连续缩放/重排覆盖锚点）**：`applyPageMode(position)` 在恢复位置后立即无条件用 `captureReaderPosition` 覆写了 `readerPosition`，导致连续 resize 事件中锚点逐级向页首漂移；现已修正为保留传入的 `position` 锚点，仅在用户主动翻页、滚动或点击目录/书内链接时才采样更新 `readerPosition`。
  - 以上两处已在 `src/plugins/stage-reader/pagination.ts`、`src/shells/obsidian/plugin.ts` 与 `src/shells/web/server.ts` 中修复并通过 `typecheck` 与 204 项测试，请直接复验该长中文段落缩放场景与 Obsidian 真机体验并完成收口。
- **执行环职责切分与专用沙盒直接读写指令（必读，详见 [ROLES.md](ROLES.md) & [AGENTS.md](../AGENTS.md)）**：
  1. **工程代码自检归 Worker**：编译、类型检查、单元测试、架构守卫单测与对应产物构建由 Worker 在交卷前跑通；
  2. **按交付形态模拟真实用户归 Tester**：Tester 不写单测脚本、不拿脚本 `ok: true` 充数，而是根据本任务涉及的目标宿主形态（如 Web 壳、Obsidian 壳或 DSH 工具包壳）完全模拟真实用户操作与审视产物；
  3. **专用测试沙盒直接读写、零防御内耗**：仓库内已列入 `.gitignore` 的专用测试沙盒（如 `.tmp`、`.dev-vault`）本来就是供 Agent 随意覆盖、改写和操作演练的游乐场！严禁 Router 或 Tester 以“不能覆盖沙盒内现有文件”为由阻塞验收，严禁要求 Worker 研究或编写快照备份、回滚或进程树扫描代码！

### 背景与目标（基于全仓「打补丁 vs 根因解决」专项审计，详见 [LESSONS.md](LESSONS.md)）
全仓审计发现多处典型的“表层补丁 / 凑测试 / 契约失真”反模式，必须在继续新增业务功能前一次性完成根因级清创。**本任务包中子模块 1（Core/PluginRT & Stage-Reader 分页）与子模块 2（Scripts & Tests 清创）可按 [ROLES.md](ROLES.md) 规则组织执行，Tester 首轮审查必须一次性穷尽全部静态与真机验证项。**

### 核心根因清创要求

1. **铲除 `src/shells/web/server.ts` 的 5 层函数重赋值套娃与死代码截胡**：
   - 将 `server.ts` 中被 5 层包装的 `renderTraining`（`renderTrainingBase` / `renderTrainingWithControls` / `renderTrainingWithChooser` / `trainingChromeBase` / `renderTrainingWithMediaControls`）以及多层包装的 `home`、`workspace`、`openTopic`、`startSpeech` 合并为**单一、清晰的函数定义**，直接将 DOM 渲染到正确的目标容器中（严禁先渲染在 `#training` 再用 `document.body.append` / `readerTools.append` 拔节点搬家）；
   - 删除 `server.ts` 中被 `stopImmediatePropagation()` 屏蔽的旧设置表单死代码（`L409-414`），保留唯一生效的简化设置入口；
   - 在 `tests/boundaries.test.ts` 中新增静态守卫：扫描 `src/**` 严禁出现 `const \w+Base\s*=` 同名函数重赋值套娃模式。

2. **废除 `readFile("src/...") + vm.runInContext` 抠源码字符串假测试**：
   - 清理或重写 `tests/wave8-asr-tester-regressions.test.ts`、`tests/core-epub-and-typography.test.ts`、`tests/obsidian-e2e-safety.test.ts` 等文件中通过 `readFile` 切取 `src/` 源码行塞入 `vm.runInContext` / `vm.runInNewContext` 的测试，改为直接 `import` 真实导出的模块函数或通过真实 HTTP / 渲染器验证；
   - 在 `tests/boundaries.test.ts` 中新增静态守卫：扫描 `tests/**` 严禁同时使用 `readFile` 读取 `src/` 源码并送入 `runInContext` / `runInNewContext`。

3. **清理 `scripts/` 下的沙盒快照回滚与全局 `assertNoObsidian` 封锁**：
   - 移除 `scripts/obsidian-safety.mjs`、`scripts/verify-obsidian.mjs`、`tests/obsidian-e2e-safety.test.ts` 中对 `.dev-vault` 的快照回滚恢复逻辑，以及 `scripts/verify-obsidian-e2e.ts` 中的 `assertNoObsidian()` 全局进程拦截（保留 `--user-data-dir`、动态 CDP 端口、`--use-mock-keychain --password-store=basic` 与仅关闭自身派生 `child` 进程的干净实现）；
   - `scripts/build-obsidian.mjs` 直接构建并覆盖同步 `.dev-vault/.obsidian/plugins/pith/`，不再向 `.tmp/` 写入 `pith-build-backup-*` 备份目录；
   - `package.json` 的 `verify:obsidian` 直接执行 `npm run build:obsidian && node --experimental-strip-types scripts/verify-obsidian-e2e.ts`。

4. **重构阅读器栏数模型（支持用户明确选择 `1 / 2 / 3` 栏 + 真实 `.pith-reader` 宽度自适应）**：
   - 更新 `src/core/seams.ts`、`src/plugins/stage-reader/pagination.ts`、`src/shells/obsidian/plugin.ts` 与 `src/shells/web/server.ts`：
     - 将用户栏数偏好扩展为 `"single" | "double" | "triple"`（UI `[Aa]` 面板提供 **`单栏` | `双栏` | `三栏`** 三个按钮，默认 `单栏`）；
     - **彻底移除以窗口宽高比（`aspectRatio >= 1.15`）或窗口高度（`height >= 520`）禁用多栏的死板规则**！仅根据**实际阅读容器（`.pith-reader` / `.reader`）的实时宽度 `W`** 与最小可读列宽（每栏至少 `320px` 净宽 + 栏间距）判定最大可容纳栏数 `maxColumns`（1、2 或 3），不满足宽度的栏数按钮置灰禁用，满足时严格尊重用户所选的 `1 / 2 / 3` 栏（哪怕在超宽屏上用户选了 `单栏`，也必须保持 1 栏！）；
     - 补齐消费 `--pith-page-scroll-extent` 的 CSS 规则（确保最后一屏对齐），将 `ResizeObserver` 绑定在実際の `.pith-reader` / `.reader` 上，且切换字号、开关侧栏、展开/收起音频条时统一触发重排并保持当前阅读位置（`IntrinsicLocator`）。

5. **内核 `PluginRuntime` 原生支持插件配置变更重挂 & 区分 Agent `"offline"` 与 `"unconfigured"`**：
   - 在 `src/core/pluginrt/runtime.ts` 中记录每个激活插件已应用的 `config` 快照；当 `reconcile()` 发现已激活插件的 `config` 发生变化时，自动停用并重新挂载该插件及其下游依赖，从而移除 `shells/obsidian/index.ts` 与 `shells/web/server.ts` 外层的手动关停重启补丁；
   - 区分 Agent 配置的“尚未初始化”与“用户主动选择离线模式”，确保用户选定“离线模式”后再次打开设置页不会被自动扫描篡改回 `dsh`。

### 授权修改范围
- `src/core/seams.ts` & `src/core/pluginrt/runtime.ts`
- `src/plugins/stage-reader/` & `src/plugins/speech-service/` & `src/plugins/guide-acp/`
- `src/shells/**`
- `scripts/**` & `package.json` & `.gitignore`
- `docs/003-interaction.md`
- `tests/**`

### Worker 工程自检门禁 vs. Tester 模拟真实用户验收标准（首轮穷尽）
- **Worker 工程自检门禁（交卷前置条件）**：
  - `npm run typecheck && npm test && npm run build:obsidian` 全部零报错通过（包括 `tests/boundaries.test.ts` 新增的「零函数重赋值套娃」与「零抠源码 `runInContext`」守卫单测全绿），确保最新构建产物已同步至 `.dev-vault`；
- **Tester 模拟真实用户验收（直接操作 `.dev-vault` 玩具沙盒与 Web 界面，严禁只跑脚本看 `ok: true`）**：
  - 像真实人类用户一样在 `.dev-vault` 的 Obsidian 窗口与 Web 壳中实际点击、切换 `单栏 / 双栏 / 三栏`、在超宽屏下选择 `单栏`、调整字号与拖拽缩放窗口、打开设置面板切换离线模式并重开，**每一步截屏用视觉（`view_image`）肉眼审视画面排版、分栏对齐、位置保持与文案体验**。

---

## [Task #14] 宿主壳接入 `dojo-interline`（行间双语伴读）一级工具、滑动窗口静默预热与朗读过滤

- **Status**: verified
- **Verified-Commit**: df97236
- **Updated**: 2026-11-05
- **验收**：Worker 完成 typecheck、222 项测试和 Obsidian 构建；Tester 在 Web 与 `.dev-vault` Obsidian 实际验证三种模式、分栏、邻章预热与缓存回放，以及受控 TTS 请求不包含译文。Guide、翻译及 TTS 使用替身，不证明真实模型理解、翻译或音质；未验证重启后的持久缓存。

### 背景与目标
独立 Worker 已完成 `src/plugins/dojo-interline/`（`index.ts`、`coordinator.ts`、`tests/dojo-interline.test.ts`）并在 `src/plugins/all.ts` 注册了 `dojo.interline` 服务。本任务将 `dojo-interline`（行间双语 · Read originals with subtitles）完整接入宿主壳与向导发现体系，让用户在阅读英文/外文材料且向导注入 `interline` 工具后，能够直接在阅读舞台开启行间双语字幕、静默预热邻域章节并保持原文 TTS 朗读纯净。

### 核心实现要求
1. **向导发现、`inUse` 保活与工具槽标签接入**：
   - 在 `src/shells/web/index.ts`、`src/shells/obsidian/index.ts`、`src/shells/web/server.ts`、`src/shells/dsh/index.ts` 与 `src/shells/toolkitSlot.ts` 中将 `"interline"` 纳入可用 Dojo 发现列表（与 `"shadowing"`, `"feynman"` 并列）及 `inUse` 保活统计，工具标签显示为 `"行间双语"`。
2. **阅读舞台「行间双语」内嵌渲染与模式切换（`original` | `bilingual` | `subtitle-primary`）**：
   - 当课题已挂载 `interline` 工具且用户点击顶栏 `[🛠 行间双语]` 时，提供简洁的近源模式切换（`原文` | `行间双语` | `译文主显`），调用 `InterlineService.renderInterlineHtml` 与 `InterlinePreparationCoordinator`（通过向导 Provider 或翻译回调按 `activeUnit -> neighborhood` 优先顺序生成并缓存 `_cache/interline/` 双语块）；
   - 为 `.pith-interline-subtitle` 编写温润克制的书卷双语排版样式：
     - `data-interline-mode="bilingual"`：原文保持清晰可读，行间译文以块级（`display: block`）柔和衬于段落下方；
     - `data-interline-mode="subtitle-primary"`：译文作为主视觉字号，原文以安静的小字号弱化呈现供随时核对。
3. **TTS 朗读严格排除行间译文（`data-prose="false"` 子树过滤）**：
   - 在 `src/shells/obsidian/plugin.ts` 与 `src/shells/web/server.ts` 提取 `[data-prose="true"]` 段落文本送入 TTS 分句器时，**必须排除内部带有 `[data-prose="false"]`（如 `.pith-interline-subtitle`）的子节点文本**，确保开启行间双语后点击 `🎧 听读本章` 仍然只朗读纯粹的原著外文，绝不把嵌入的中文译文混进去重读！

### 授权修改范围
- `src/plugins/dojo-interline/` & `src/plugins/all.ts` & `src/plugins/guide-acp/`
- `src/shells/**`
- `docs/003-interaction.md`
- `tests/**`

### Worker 工程自检门禁 vs. Tester 模拟真实用户验收标准
- **Worker 工程自检门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿（含 `tests/dojo-interline.test.ts` 与 `tests/boundaries.test.ts`）；
- **Tester 模拟真实用户验收**：在英文材料课题中注入 `interline`，按真实用户路径切换 `原文 / 行间双语 / 译文主显`、翻页观察邻域缓存回放、开启伴读核验仅读英文原文，并截屏用 `view_image` 审视行间双语排版呼吸感与多栏分页对齐。

---

## [Task #15] 动态拉取 ACP Agent 模型/推理强度下拉列表（`configOptions`）与本机轻量语音按需网关（Managed Local Speech Daemon）

- **Status**: pending
- **Verified-Commit**: none
- **Updated**: 2026-11-05
- **上游 Brain 紧急纠偏（必须 100% 严格执行，立刻改正当前工作区的两处错误实现）**：
  1. **严禁在 Pith 内部硬编码读取 `~/.dsh/` 配置文件！100% 纯走标准 ACP 协议**：
     - 宿主 `~/.dsh/profiles/acp/cordis.patch.yml` 的源头配置已修正（现在 `dsh --profile acp`、`claude-agent-acp`、`codex-acp` 的 `session/new` 均直接返回准确的 `currentValue` 与模型树）；
     - **立即删除** `src/plugins/guide-acp/acpSession.ts` 或 `discovery.ts` 中任何针对 `dsh` 去读取 `~/.dsh/` YAML/配置文件的硬编码代码！Pith 对所有 Agent 一视同仁，**只通过标准 ACP `session/new` 返回的 `configOptions` 获取模型/推理强度列表与 `currentValue`，并通过标准 `session/set_config_option` 切换**！
  2. **严禁在 `speechRuntime.ts` 中使用 `python3 -m venv` / `pip install` 从 PyPI 下载，严禁使用只支持英文的 `vits-piper-en_US` 和 `whisper-tiny.en`！**：
     - 当前工作区 `src/shells/speechRuntime.ts` 竟然在调 `python3 -m venv` + `pip install` 并且下载了根本不支持中文的 `vits-piper-en_US-lessac-medium` 与 `whisper-tiny.en`，**必须彻底重写**！
     - **正确的零 Python 依赖 + 正确的多语种轻量模型（我们之前明确调研选定的方案）**：
       - **运行时（零 Python / 零 pip）**：使用 Node 原生包 `sherpa-onnx-node`（或 `sherpa-onnx` 官方预编译原生二进制 `sherpa-onnx-v1.12.23-osx-universal2-shared.tar.bz2` / Node 子进程直接加载，**绝不调用 `python3` 或 `pip`**）；
       - **TTS 模型（必须是我们调研选定的中英双语 `Kokoro-82M v1.1-zh` int8 量化版）**：`https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2`（支持中英双语 103 音色，含 `model.int8.onnx`、`voices.bin`、`tokens.txt`、`espeak-ng-data`、`dict`、`lexicon-us-en.txt,lexicon-zh.txt` 及中文日期/数字 `.fst`）；
       - **ASR 模型（必须是我们调研选定的中英日韩粤多语种 `SenseVoice-Small` int8 量化版）**：`https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2`（使用 `model.int8.onnx` + `tokens.txt`）。

### 背景与目标
1. **ACP Agent 模型与推理强度动态发现和切换（纯协议化，零特定 Agent 硬编码）**：
   - `dsh --profile acp`、`claude-agent-acp`、`codex-acp` 在执行 `initialize` + `session/new` 时，均在 `result.configOptions` 中返回完整的模型树（`id: "model"`）与推理强度选项（`id: "reasoning_effort"` 或 `id: "effort"` / `category: "thought_level"`）。
   - ACP 标准协议规定切换会话配置项应调用 JSON-RPC 方法 `session/set_config_option`（参数 `{ sessionId, configId, value }`）。
   - 用户在设置面板选中任意本机 Agent 后，直接通过下拉框看到并选择对方 Agent 暴露的真实模型列表（含默认项“默认（跟随 Agent 当前默认）”）与推理强度，即选即存。
2. **本机轻量语音按需守护网关（`Kokoro-82M v1.1-zh int8` + `SenseVoice int8` · 零 Python 依赖 · 类 Magpie 按需网关）**：
   - 模型与运行时缓存统一存放在 Vault 外的系统应用数据目录（如 macOS `~/Library/Application Support/pith/speech/` 或由环境变量 `PITH_SPEECH_HOME` 指定）；
   - 宿主提供本机语音网关生命周期管理（`getState` / `install` / `ensureRunning` / `stop` / `remove`）：当处于 `local` 语音模式且用户点击 `🎧 听读` 或测试语音时，若本机语音网关已就绪但处于 `stopped` 状态，宿主自动按需拉起回环网关进程，并在空闲超时（默认 180 秒无合成/转写请求）或宿主卸载时自动退出进程释放内存。

### 核心实现要求

1. **纯标准 ACP `configOptions` 解析、探测与 `session/set_config_option` 协议对齐（`src/plugins/guide-acp/`）**：
   - 在 `src/plugins/guide-acp/acpSession.ts` 中实现 `parseAcpConfigOptions(raw)`：完整支持扁平选项与分组嵌套选项，归一化为 `AcpConfigOptionDescriptor[]`；**严禁读取任何 `~/.dsh/` 本地配置文件**；
   - 在 `probeAgentOptions(agentId, force)`（带缓存）中，对可用 Agent 通过轻量 `initialize` + `session/new` 探测并缓存其返回的 `configOptions`；
   - 在 `runLocalAcpPrompt` 中：`session/new` 拿到 `sessionId` 后，若用户配置了非空的 `options.model`（且不同于返回的 `currentValue`），调用 `callRpc("session/set_config_option", { sessionId, configId: "model", value: options.model })`；若配置了非空的 `options.effort`，同样调用 `session/set_config_option`（使用探测到的 `reasoning_effort` 或 `effort` 对应的 `configId`）。
2. **双壳设置面板模型与推理强度下拉框（`src/shells/obsidian/index.ts` & `src/shells/web/server.ts`）**：
   - 在设置面板「本机 Agent」下方展示 **「模型（Model）」** 与 **「推理强度（Effort）」** 两个 `<select>` 下拉框；
   - 第一项固定为 `""`（文案显示为 `默认（跟随 Agent 当前默认：${currentModelName}）`），随后按分组（`<optgroup>` 或前缀）渲染从该 Agent 探测到的全部可选模型与推理强度，选择变更后立即自动保存（Auto-save）。
3. **本机轻量语音按需网关管理器（`src/shells/speechRuntime.ts` · 严禁用 Python/pip，必须用 `Kokoro-82M v1.1-zh` + `SenseVoice`）**：
   - 管理 Vault 外目录（默认 `os.homedir() + "/Library/Application Support/pith/speech"`，支持 `PITH_SPEECH_HOME` 覆盖）；
   - 下载并校验 `kokoro-int8-multi-lang-v1_1.tar.bz2`（中英双语 TTS）与 `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2`（中英多语种 ASR）以及 `sherpa-onnx` 原生运行时（或 Node 绑定，**零 Python / 零 PyPI 依赖**），提供标准 OpenAI 兼容回环 HTTP 网关（`/health`、`POST /v1/audio/speech`、`POST /v1/audio/transcriptions` 及 `/transcribe`），支持**按需自动拉起（Auto-start on demand）**与**空闲自动退出（Idle auto-shutdown，默认 180s 无请求自动退出释放内存）**；
   - 在 `speech-service` 或宿主 `synthesizeSpeech` / `transcribeAudio` 调用前：若当前为 `local` 模式且 `host.speechRuntime` 已安装就绪，自动调用 `await host.speechRuntime.ensureRunning()` 按需唤醒网关；
   - 在 Web（`/api/speech/runtime`）与 Obsidian 设置面板中展示本机语音网关状态（明确显示模型名称 `Kokoro-82M v1.1 (中英) + SenseVoice (多语种)`）与一键安装/启动/停止/卸载操作。

### 授权修改范围
- `src/core/seams.ts` & `src/core/host.ts`（已由 Brain 冻结契约）
- `src/plugins/guide-acp/**`
- `src/plugins/speech-service/**`
- `src/shells/**`
- `tests/**`

### Worker 工程自检门禁 vs. Tester 模拟真实用户验收标准
- **Worker 工程自检门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全部零报错通过；
- **Tester 模拟真实用户验收**：
  1. 在 Web 与 `.dev-vault` 真实 Obsidian 中打开设置面板，验证连接本机 `dsh` Agent 时能真实拉取并展示 `dsh` 的模型分组下拉列表（DeepSeek / Magpie / Anthropic / Responses）与推理强度下拉列表，切换模型后自动保存并在真实会话中生效；
  2. 验证在设置面板中启用本机按需语音网关、在阅读页点击 `🎧 听读本章` 自动拉起网关完成播放，以及空闲/停止后进程干净回收，全程截屏通过 `view_image` 审视 UI 排版与交互体验。

---

## [Task #16] 修复分页阅读器横向滚动条泄露与超宽屏单栏行宽失控/大片留白

- **Status**: pending
- **Verified-Commit**: none
- **Updated**: 2026-11-05

### 背景与用户真机截图根因诊断（对标母本 `ganfan-garden/styles.css:1246-1256`）
用户在超宽屏下打开 `.dev-vault` Obsidian 阅读英文 EPUB 时截屏指出两处严重影响阅读质感的缺陷：
1. **底部出现一条恶心的原生横向滚动条（Horizontal Scrollbar）**：
   - **根因 1**：`src/plugins/stage-reader/pagination.ts:74` 写了 `viewport.style.overflowX = "auto"`（且 `plugin.ts:27` 与 `web/server.ts:348` 写了 `.pith-reader.pith-paged { overflow-x: auto }`），直接把浏览器原生的灰色横向滚动条暴露在了书页正下方（紧贴音频播放条上方）！而在母本 `ganfan-garden/styles.css:1246-1249` 中，分页容器 `.gg-material-paginated` 明确设置的是 **`position: relative; overflow: hidden;`（或配合 `scrollbar-width: none; ::-webkit-scrollbar { display: none; }`）**——因为按屏翻页完全由滚轮、键盘方向键与顶栏 `< 1/3 >` 按钮驱动 programmatic `scrollTo({ left })`，**绝不允许在书页底部露出丑陋的原生横向滚动条**！
   - **根因 2（`::after` 伪元素未绝对定位导致撑高）**：`ganfan-garden/styles.css:1250-1256` 中 `::after` 伪元素是 `position: absolute; left: var(--gg-page-scroll-extent, 0px); top: 0; width: 1px; height: 1px; pointer-events: none;`，而当前 `plugin.ts:54` 与 `server.ts:371` 写成了 `display: block; width: var(--pith-page-scroll-extent, 0px); height: 1px;`，放在正常文档流里占了高度！
2. **超宽屏下「单栏」模式一行拉到 2000px+ 宽、四周与下方出现失衡的大片空白**：
   - **根因**：`src/plugins/stage-reader/pagination.ts:30` 计算单栏边距时写了 `horizontalInsetPx = Math.min(48, Math.max(16, viewportWidth * 0.05), ...)`——把左右内边距上限死锁在了 `48px`！导致在 2200px 宽的屏幕上选「单栏」时，一行英文长达 2100px（远超人类眼球舒适扫视的 65~75 字符 / `720px~840px` 最佳行宽），不仅左对齐贴在最左边极难阅读，而且因为一行字塞了太多词，短短 8 段话只占了屏幕上方 1/3，底下全是苍白空洞！
   - **修复方案（书卷黄金行宽居中版心）**：
     - 当 `columns === 1`（单栏分页）且 `viewportWidth` 大于单栏舒适最大行宽（如 `maxSingleColumnWidthPx = 820`）时，自动将水平内边距 `horizontalInsetPx` 扩大为 `Math.max(baseInset, Math.round((viewportWidth - 820) / 2))`（让单栏正文在超宽屏下像一本摊在桌中央的精装书一样**水平居中、保持 ~820px 的黄金阅读行宽**！）；
     - 当 `columns === 2` 或 `3` 时，同样为每栏设置舒适上限（如双栏总净宽上限 `1560px`，三栏总净宽上限 `2160px`，超出部分转化为两侧均衡的书页留白 `horizontalInsetPx`），确保任何屏幕尺寸下字行都不会被拉成横跨整个显示器的面条！

### 核心实现要求
1. **彻底消除分页模式下的横向滚动条 & 修正 `::after` 定位（`pagination.ts`、`obsidian/plugin.ts`、`web/server.ts`）**：
   - 在 `src/plugins/stage-reader/pagination.ts:74` 将 `viewport.style.overflowX = "hidden"`（编程式 `scrollTo` / `scrollLeft` 在 `overflow: hidden` 容器上 100% 正常工作，且零滚动条）；同时在 `obsidian/plugin.ts` 与 `web/server.ts` 的 `.pith-reader.pith-paged` / `.reader.paged` 上设置 `position: relative; overflow: hidden; scrollbar-width: none;` 及 `::-webkit-scrollbar { display: none; }`；
   - 将 `.pith-reader.pith-paged::after` 与 `.reader.paged::after` 修正为 `content: ""; position: absolute; left: var(--pith-page-scroll-extent, 0px); top: 0; width: 1px; height: 1px; pointer-events: none;`（对标 `ganfan-garden/styles.css:1250-1256`）。
2. **单/双/三栏黄金版心宽度约束与居中留白（`src/plugins/stage-reader/pagination.ts`）**：
   - 在 `computePagination(viewportWidth, viewportHeight, scrollWidth, mode)` 中：
     - 基础边距 `baseInset = Math.min(48, Math.max(16, viewportWidth * 0.05), viewportWidth / (columns * 4))`；
     - 设定单栏最大舒适列宽 `maxColumnWidth = columns === 1 ? 820 : columns === 2 ? 680 : 580`；
     - 当默认计算出的 `columnWidthPx > maxColumnWidth` 时，将多余宽度均分到水平边距中（使版心在视口内自然水平居中，且 strictly 保持 `columns * columnWidthPx + columns * columnGapPx === viewportWidth` 分页步长等式恒成立！注意：在 CSS Multicol 中，`padding-left/right` + `column-width` + `column-gap` 必须满足每屏恰好等于 `viewportWidth`，若通过加大 `horizontalInsetPx` 实现，请确认多屏翻页时第 2 屏及后续屏的列步长 `columnWidthPx + columnGapPx` 与 `viewportWidth / columns` 严格对齐，或者对单栏/多栏使用精确匹配的 `horizontalInsetPx` / 版心约束，绝不能破坏多屏 `scrollLeft = pageIndex * viewportWidth` 的像素级对齐！）。
     - *数学校验提示*：在 CSS Multi-column 中，每一列的重复步长（stride）固定是 `columnWidth + columnGap`。若 `body` 的 `padding-left = horizontalInsetPx`、`padding-right = horizontalInsetPx`，则第一屏能放下 `columns` 列的充要条件是 `2 * horizontalInsetPx + columns * columnWidth + (columns - 1) * columnGap = viewportWidth`；而后续每一屏滚动 `viewportWidth` 要恰好对齐新的一组 `columns` 列，必须满足 **`columns * (columnWidth + columnGap) === viewportWidth`**，即 **`columnGap === 2 * horizontalInsetPx`**！因此，当单栏 `columns === 1` 时，令 `horizontalInsetPx = Math.max(baseInset, Math.min(Math.floor((viewportWidth - 820) / 2), Math.floor(viewportWidth * 0.28)))`，此时 `columnWidthPx = viewportWidth - 2 * horizontalInsetPx`，`columnGapPx = 2 * horizontalInsetPx`，不仅单栏完美居中控制在 `820px` 黄金行宽，而且 **`1 * (columnWidthPx + columnGapPx) === viewportWidth` 恒等式 100% 严格成立**，翻到第 2、3、N 页永远分毫不差居中对齐！

### 授权修改范围
- `src/plugins/stage-reader/pagination.ts`
- `src/shells/obsidian/plugin.ts`
- `src/shells/web/server.ts`
- `tests/` 下相关测试文件

### Worker 工程自检门禁 vs. Tester 模拟真实用户验收标准
- **Worker 工程自检门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；
- **Tester 模拟真实用户验收**：在超宽视口（如 `1800×1000`）与常规视口下打开 Web 与 `.dev-vault` 真实 Obsidian 阅读器，切换单栏/双栏/三栏并开启底部音频朗读条，截屏通过 `view_image` 肉眼确认：**1) 书页底部横向滚动条 100% 消失；2) 超宽屏下单栏正文居中呈黄金书卷行宽（约 820px），翻到第 2、3 页依然严丝合缝居中对齐，不再贴左拉成超长面条行**。



