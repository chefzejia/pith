# Pith · Wave 4 并行独立 Agent 开发交接单（HANDOFF · Track A / Track B）

> **仓库路径**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **必读契约**：[`AGENTS.md`](../AGENTS.md) · [`docs/002-architecture.md`](002-architecture.md) · [`docs/003-interaction.md`](003-interaction.md) · [`src/core/seams.ts`](../src/core/seams.ts)
> **产品品质死命令（Zero System-TTS Garbage · 严格 Fail-Closed）**：
> - **严禁使用任何操作系统/浏览器自带的低劣机械语音或语音识别**（全仓永久封杀 `window.speechSynthesis`、`SpeechSynthesisUtterance`、`webkitSpeechRecognition`、`SpeechRecognition` 及 macOS `say` 命令）！
> - **保持极致轻量 + 严选官方可选项 + 用户自备/自下载 + 不具备条件即直接失败（Fail-Closed）**：Pith 安装包绝不内置或偷偷下载几百 MB 模型；我们在设置中提供严选的官方高品质预设（TTS 默认 `kokoro-local` 备选 `openai-tts` / `azure-neural`；ASR 默认 `whisper-local` 备选 `sensevoice-local` / `openai-whisper`），附清晰的本机启动/安装指引。若用户本机未启动对应服务或未配 Key，点击伴读或转写时**直接快速失败并弹出轻量 `.pith-toast-tip` 引导去设置中连接**，绝不退化用系统自带语音糊弄用户！
> **并行隔离铁律**：以下 **2 个任务包（Track A / Track B）的修改文件集 100% 物理正交，零交集**！每个 Agent **严禁触碰自己 Write Scope 之外的任何文件**（尤其严禁修改 `src/core/**` 和现有旧测试文件）。

---

## 📦 Wave 4 · Track A（Agent A 负责）：严选高品质神经网络 TTS/ASR 引擎（Fail-Closed）+ 音视频时间轴视图 + 防 SSRF 外部摄取管线

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/plugins/speech-service/index.ts`
- 新增 `src/plugins/speech-service/neuralSpeech.ts`（严选官方 TTS/ASR 预设清单、基于 `HostPort.http` & `HostPort.secrets` 的高品质语音合成与转写客户端、下一句预取器 `PrefetchSpeechQueue`）
- `src/plugins/stage-timeline/index.ts`
- `src/plugins/guide-acp/index.ts`
- `src/plugins/guide-acp/tools.ts`
- 新增 `src/plugins/guide-acp/externalIngest.ts`（零 Node 耦合、基于 `HostPort.http` 的防 SSRF 外部网页/媒体摄取器）
- `src/shells/dsh/index.ts`
- 新增 `tests/wave4-trackA-speech-timeline-ingest.test.ts`
- *(严禁修改 `src/core/**`、`src/plugins/stage-reader/**`、`src/shells/web/**`、`src/shells/obsidian/**` 或其他现有测试文件！严禁在 `src/plugins/**` 中 import `node:*`！)*

### 2. 核心设计目标（对齐 [`src/core/seams.ts`](../src/core/seams.ts) 已定型签名）

1. **严选官方高品质 TTS & ASR 预设与 Fail-Closed 客户端（`src/plugins/speech-service/neuralSpeech.ts` & `index.ts`）**：
   - 定义并导出官方严选预设清单 `CURATED_TTS_PRESETS` 与 `CURATED_ASR_PRESETS`（符合 `SpeechEnginePreset`）：
     - **TTS 预设（`CuratedTtsProviderId`）**：
       1. `"kokoro-local"`（默认推荐 · 轻量开源首选）：`label: "Kokoro-82M (本机开源引擎)"`, `kind: "local"`, `defaultEndpoint: "http://127.0.0.1:8880/v1/audio/speech"`, `defaultVoice: "af_heart"`, `installHint: "在终端运行 Kokoro OpenAI 兼容服务（如 docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest 或 mlx-audio）"`；
       2. `"openai-tts"`：`label: "OpenAI gpt-4o-mini-tts (云端)"`, `kind: "cloud"`, `defaultEndpoint: "https://api.openai.com/v1/audio/speech"`, `defaultVoice: "alloy"`, `installHint: "需配置 OPENAI_API_KEY"`；
       3. `"azure-neural"`：`label: "Azure Neural TTS (微软神经网络音色)"`, `kind: "cloud"`, `defaultEndpoint: "https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"`, `defaultVoice: "zh-CN-XiaoxiaoNeural"`, `installHint: "需配置 AZURE_SPEECH_KEY 与区域"`。
     - **ASR 预设（`CuratedAsrProviderId`）**：
       1. `"whisper-local"`（默认推荐）：`label: "MLX / Faster Whisper (本机回环)"`, `kind: "local"`, `defaultEndpoint: "http://localhost:8765"`, `installHint: "在本机启动 Whisper 回环服务监听 8765 端口"`；
       2. `"sensevoice-local"`：`label: "SenseVoice-Small (本机极速多语种)"`, `kind: "local"`, `defaultEndpoint: "http://127.0.0.1:8766"`, `installHint: "在本机启动 SenseVoice HTTP 服务监听 8766 端口"`；
       3. `"openai-whisper"`：`label: "Whisper-large-v3-turbo (云端 API)"`, `kind: "cloud"`, `defaultEndpoint: "https://api.openai.com/v1/audio/transcriptions"`, `installHint: "需配置 OPENAI_API_KEY"`。
   - **严格安全与 Fail-Closed 合成/转写实现**：
     - 本地预设（`kind === "local"`）强制校验 `isLoopbackSafe(endpoint)`（防数据外泄）；云端预设强制校验 `HostPort.secrets?.getSecret(...)` 非空（缺密钥直接抛清晰错误，绝不回退系统语音！）；
     - `speech.tts.synthesizeSpeech(text, signal?)`: 通过 `HostPort.http` 调用对应端点合成音频（`kokoro-local` 与 `openai-tts` 发送 OpenAI `/v1/audio/speech` JSON 请求；`azure-neural` 发送 SSML XML 请求），校验返回 HTTP 2xx 且 `bytes.byteLength > 0`（空音频或连接失败直接抛含 `installHint` 的明确错误！）；
     - 实现并导出 `PrefetchSpeechQueue`（参考 `ganfan-garden/src/speech/cloudPlayer.ts`）：在播放第 `i` 句时自动并发预取第 `i+1` 句音频，支持 `AbortSignal` 立即取消；
     - `speech.asr.checkHealth()` 与 `speech.asr.transcribeAudio(audioBytes, mimeType, signal?)`：支持本地回环 `/health` & `/transcribe` 以及 OpenAI 兼容 JSON/纯文本响应解析，空音频或未连接直接 Fail-Closed 抛错。
   - 扩展 `speech-service` 插件 `settings`：增加 `ttsProvider`（默认 `"kokoro-local"`）、`ttsEndpoint`、`ttsVoice`、`azureRegion`、`asrProvider`（默认 `"whisper-local"`），保留原有 `rate` 与 `asrLoopbackUrl` 默认值以兼容旧单测。

2. **音视频时间轴舞台 HTML 视图（`src/plugins/stage-timeline/index.ts` & `renderTimelineView`）**：
   - 实现 `renderTimelineView(input): string`：输出 `<section class="pith-timeline-stage" data-media-kind="...">`，包含 A-B 循环区间状态栏与每条带 `data-cue-id`、`data-locator="time:${cue.startSec}"`、`data-prose="true"` 的 `.pith-cue` 字幕节点。

3. **防 SSRF 外部网页/媒体摄取管线（`src/plugins/guide-acp/externalIngest.ts` & `pith_ingest_external` 工具）**：
   - 实现零 `node:*` 依赖的 `isPublicHttpUrl(url)`（严格拦截 `localhost`、`127.*`、`10.*`、`172.16-31.*`、`192.168.*`、`169.254.*`、`[::1]`、`.local` 等内网 SSRF 地址）与 `ingestExternalUrl(input, http)`；
   - 在 `guide-acp/tools.ts` 与 `shells/dsh/index.ts` 中注册 `pith_ingest_external` 工具，将清洗后的外部文章/字幕导入 `WorkspaceStore` 并可选绑定到 `topicId`。

4. **测试要求（`tests/wave4-trackA-speech-timeline-ingest.test.ts`）**：
   - 验证 `kokoro-local`、`openai-tts`、`azure-neural` 合成请求格式、下一句 `PrefetchSpeechQueue` 预取命中、以及未启动本机服务/缺 API Key 时的 **严格 Fail-Closed 拒绝**；
   - 验证 `whisper-local` / `sensevoice-local` 回环校验与转写解析；
   - 验证 `renderTimelineView` 与 `pith_ingest_external`（含 SSRF 拦截）。

---

## 📦 Wave 4 · Track B（Agent B 负责）：彻底铲除双壳系统垃圾语音 + 接入高品质音频流伴读/ASR 面板 + 多材料导入工作台

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/shells/web/server.ts`
- `src/shells/obsidian/index.ts`
- `src/shells/obsidian/plugin.ts`
- 新增 `tests/wave4-trackB-workbench-and-media.test.ts`
- *(严禁修改 `src/core/**`、`src/plugins/**`、`src/shells/dsh/**` 或其他现有测试文件！注意：`src/shells/web/nodeHttp.ts` 已由上游备好可直接 import `NodeHttpPort`！)*

### 2. 核心设计目标（彻底根除 `speechSynthesis` 垃圾语音，打通高品质语音设置、流式 `<audio>` 伴读与多材料工作台）

1. **在 `shells/web/server.ts` 和 `shells/obsidian/plugin.ts` 中 100% 铲除 `speechSynthesis` / `SpeechSynthesisUtterance`！**
   - **红线要求**：删除 `src/shells/web/server.ts` 与 `src/shells/obsidian/plugin.ts` 中所有 `speechSynthesis`、`SpeechSynthesisUtterance`、`webkitSpeechRecognition` 相关代码！
   - 改为 **高品质神经网络音频流播放（Fail-Closed）**：
     - 在 `src/shells/web/server.ts` 中挂载 `http: new NodeHttpPort()`（来自 `./nodeHttp.ts`）与 `secrets`（从设置或环境变量读取 `OPENAI_API_KEY` / `AZURE_SPEECH_KEY`）；
     - 新增 `GET /api/speech/presets`（返回 TTS/ASR 官方严选预设清单与连接健康状态）、`POST /api/speech/synthesize`（调用 `speech.tts.synthesizeSpeech(text)` 返回音频二进制流或 Base64，失败时返回 503 与清晰的 `installHint` 指引）、`POST /api/speech/transcribe`（调用 `speech.asr.transcribeAudio`）；
     - Web 前端 `startSpeech()` 改为：按句请求 `/api/speech/synthesize`（并在播放当前句 `HTMLAudioElement` 时预取下一句音频），同步高亮 `.pith-speech-active` 并自动滚动翻页；若服务端返回未连接高品质 TTS 引擎错误，立即停止并用 2 秒自动消散的 `.pith-toast-tip` 提示用户前往 `⚙ 设置` 连接 Kokoro 或云端 TTS，**绝不调用浏览器自带语音**！
     - `PithObsidianView`（`src/shells/obsidian/plugin.ts`）同样移除 `speechSynthesis`，改为通过注入的 `ObsidianViewActions.synthesizeSpeech?(text, signal)` 播放真实音频二进制流（未配置音频合成器时直接通过 `.pith-toast-tip` 提示“未连接高品质语音引擎，请在设置中配置 Kokoro 或云端语音”）。

2. **升级 `⚙ 设置` 面板：提供「官方严选 TTS / ASR 引擎选择与一键检测」**：
   - 在设置抽屉中，除了本机向导 Agent（`dsh / claude / codex`）外，新增 **「语音伴读 (TTS) 与跟读识别 (ASR)」** 配置区：
     - 从官方严选下拉框选择 TTS 引擎（默认 `kokoro-local` Kokoro-82M 本机开源引擎，可选 `openai-tts` / `azure-neural`）与 ASR 引擎（默认 `whisper-local`，可选 `sensevoice-local` / `openai-whisper`）；
     - 展示对应的本机自下载/启动命令提示（`installHint`）、自定义端点 URL 输入框、可选 API Key 输入框，以及 `[ 检测语音引擎 ]` 按钮。

3. **支持本地材料上传导入与音视频时间轴舞台切换**：
   - 新增 `POST /api/materials` 路由与前端 `＋ 导入材料` 入口（支持导入 Markdown、EPUB、PDF/CBZ 或 WebVTT/SRT 字幕材料并绑定到课题）；
   - 当打开 `kind === "media"` 或 `.vtt/.srt` 文件时，自动渲染 `.pith-timeline-stage` 与 `.pith-cue` 字幕时间轴，点击字幕可直接送入底部 4 阶跟读工坊；
   - 在 `PithObsidianController` 中同步提供 `importMaterial`、`renderMaterialFile` 与 `setSpeechConfig`。

4. **测试要求（`tests/wave4-trackB-workbench-and-media.test.ts`）**：
   - **静态门禁测试**：扫描整个 `src/` 目录所有源码，断言 **零 `speechSynthesis`、零 `SpeechSynthesisUtterance`、零 `webkitSpeechRecognition`** 残留！
   - 验证未连接 TTS 服务时，`POST /api/speech/synthesize` 严格 Fail-Closed 返回明确指引；连接模拟 Kokoro 端点时正常返回音频字节流；
   - 验证 `POST /api/materials` 导入材料、字幕时间轴自动切换渲染、以及 `npm run build:obsidian` 构建全绿。

---

## 三、 每个 Agent 交付前必跑的自检命令

```bash
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm run typecheck
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm test
npm run build:obsidian
git status -s
```
