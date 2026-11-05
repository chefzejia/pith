# Pith · 跨会话交接单（HANDOFF Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（区块内标记 `- **Status**: pending`）写入本文件，并执行隔离提交 `git commit --only docs/HANDOFF.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/HANDOFF.md`），取单先置 `Status: in_progress`，串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand, each red` 并在业务 Commit Body 记录完整审计账本）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；每完成一单先重读确认未被标为 `superseded`，再仅将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并 `git commit`；**提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #14] 宿主壳接入 `dojo-interline`（行间双语伴读）一级工具、滑动窗口静默预热与朗读过滤

- **Status**: verified
- **Verified-Commit**: df97236
- **Updated**: 2026-11-05
- **验收**：Worker 完成 typecheck、222 项测试和 Obsidian 构建；Tester 在 Web 与 `.dev-vault` Obsidian 实际验证三种模式、分栏、邻章预热与缓存回放，以及受控 TTS 请求不包含译文。

---

## [Task #15] 动态拉取 ACP Agent 模型/推理强度下拉列表（`configOptions`）与本机轻量语音按需网关（Managed Local Speech Daemon）

- **Status**: verified
- **Verified-Commit**: 8aee0fba8d7d426c3047d716e4f76dbf88ec961f
- **Updated**: 2026-11-05
- **验收**：Worker 完成 typecheck、239 项测试与 Obsidian 构建；Tester 在 Web 和 `.dev-vault` Obsidian 验证 ACP 模型选项及真实 Kokoro 听读，在 Web 验证中英文转写、手动释放和空闲回收。dsh 会话使用本地受控 provider；未做真实云端推理或扬声器逐句听证。取消守卫的破壁未被回归测试捕获。
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



