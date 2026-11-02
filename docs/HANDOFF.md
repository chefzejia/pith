# Pith · Wave 4 并行独立 Agent 开发交接单（HANDOFF · Track A / Track B）

> **仓库路径**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **必读契约**：[`AGENTS.md`](../AGENTS.md) · [`docs/002-architecture.md`](002-architecture.md) · [`docs/003-interaction.md`](003-interaction.md) · [`src/core/seams.ts`](../src/core/seams.ts)
> **并行隔离铁律**：以下 **2 个任务包（Track A / Track B）的修改文件集 100% 物理正交，零交集**！每个 Agent **严禁触碰自己 Write Scope 之外的任何文件**（尤其严禁修改 `src/core/**` 和现有旧测试文件），确保两人同时开发零冲突。

---

## 📦 Wave 4 · Track A（Agent A 负责）：语音本地回环 ASR 转写 + 音视频时间轴交互视图 + 外部网页/媒体安全摄取管线

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/plugins/speech-service/index.ts`
- 新增 `src/plugins/speech-service/asrClient.ts`（基于 `HostPort.http` 的本地回环 Whisper ASR 健康检查与音频转写客户端）
- `src/plugins/stage-timeline/index.ts`
- `src/plugins/guide-acp/index.ts`
- `src/plugins/guide-acp/tools.ts`
- 新增 `src/plugins/guide-acp/externalIngest.ts`（零 Node 耦合、基于 `HostPort.http` 的防 SSRF 外部网页/音视频离线材料摄取器）
- `src/shells/dsh/index.ts`
- 新增 `tests/wave4-trackA-speech-timeline-ingest.test.ts`
- *(严禁修改 `src/core/**`、`src/plugins/stage-reader/**`、`src/shells/web/**`、`src/shells/obsidian/**` 或其他现有测试文件！严禁在 `src/plugins/**` 中 import `node:*`！)*

### 2. 核心设计目标（对齐 [`src/core/seams.ts`](../src/core/seams.ts) 已定型签名，参考 `ganfan-garden/src/speech/asrTransport.ts` & `src/material/ingest/external.ts`）

1. **本地回环 Whisper ASR 语音转写客户端（`src/plugins/speech-service/asrClient.ts` & `SpeechAsrService`）**：
   - 参考 `ganfan-garden/src/speech/asrTransport.ts`：
   - 实现 `localAsrEndpoint(baseUrl: string, endpoint: "health" | "transcribe"): string`：严格校验 `isLoopbackSafe(baseUrl)`（仅允许无凭据、无 query/hash 的 `http(s)://localhost`、`127.x.x.x`、`[::1]`），拼接 `/health` 或 `/transcribe`；
   - 通过 `ctx.service<HostPort>("host")?.http` 实现：
     - `checkHealth(signal?)`: 请求 `GET <url>/health`，返回 `{ ok: boolean, note: string }`（若宿主未注入 `http` 或返回非 2xx 则返回明确诊断信息）；
     - `transcribeAudio(audioBytes, mimeType = "audio/wav", signal?)`: 请求 `POST <url>/transcribe`（请求体为 `audioBytes`，`content-type: mimeType`），解析 JSON `{ text, language, durationSec }` 或纯文本响应，返回 `AsrTranscriptionResult`（空音频或空白转写结果抛明确错误）。
   - 挂载到 `speech.asr` 服务实例上。

2. **音视频时间轴舞台 HTML 视图与字幕联动渲染（`src/plugins/stage-timeline/index.ts` & `StageTimelineService.renderTimelineView`）**：
   - 实现 `renderTimelineView(input): string`：
     - 渲染 `<section class="pith-timeline-stage" data-media-kind="audio|video">`；
     - 顶部包含内嵌媒体播放器占位容器与当前 A-B 循环区间状态栏（若传入 `loopRange`，展示 `formatTimestamp(startSec) - formatTimestamp(endSec)` 及匹配的循环字幕数）；
     - 将每条 `TranscriptCue` 渲染为可寻址、可框选、可一键送入跟读工坊的字幕行：`<article class="pith-cue${cue.id === activeCueId ? " is-active" : ""}" data-cue-id="${cue.id}" data-locator="time:${cue.startSec}" data-prose="true"><time>${formatTimestamp(cue.startSec)}</time>${speaker}<p>${escape(cue.text)}</p></article>`。

3. **防 SSRF 外部网页/文章/媒体摄取管线（`src/plugins/guide-acp/externalIngest.ts` & `pith_ingest_external` 工具）**：
   - 参考 `ganfan-garden/src/material/ingest/external.ts`，但保持 100% 宿主无关（通过 `HostPort.http` 发起请求，零 `node:*` 导入）：
   - 实现 `isPublicHttpUrl(rawUrl: string): boolean`：**严禁 SSRF 访问内网地址**（拦截 `localhost`、`127.*`、`10.*`、`172.16-31.*`、`192.168.*`、`169.254.*`、`[::1]`、`[fc00::/fe80::]`、`.local`、以及含用户名密码的 URL）；
   - 实现 `ingestExternalUrl(input: ExternalIngestInput, http?: HttpPort): Promise<ExternalIngestBundle>`：
     - 支持拉取公开 Markdown/纯文本或 HTML 网页（剥离 `<script>/<style>/<nav>/<footer>` 标签，将 `<h1>..<h6>/<p>/<li>/<code>/<a>` 转为干净的离线 Markdown 并附上 `> 来源：<url>` 头），生成 `{ title, kind, files, warnings }`；
     - 支持 `kind === "media"` 时验证可下载媒体扩展名并附带清洗后的 `transcriptMarkdown` 文件；
   - 在 `src/plugins/guide-acp/tools.ts`（`createGuideWorkspaceTools`）与 `src/shells/dsh/index.ts` 中新增第 7 个受控工具 `pith_ingest_external`（参数 `{ url: string, kind?: "article" | "discussion" | "media", topicId?: string, transcriptMarkdown?: string }`）：调用 `ingestExternalUrl` 后自动通过 `store.importMaterial()` 写入工作区，若传入 `topicId` 则自动绑定到该 Topic！

4. **测试要求（`tests/wave4-trackA-speech-timeline-ingest.test.ts`）**：
   - 验证 `speech.asr` 的 `checkHealth` 与 `transcribeAudio`（含非回环地址拒绝、空音频拒绝、JSON/文本转写解析）；
   - 验证 `stage.timeline.renderTimelineView` 生成带 `data-locator="time:..."`、`data-prose="true"`、高亮当前字幕与 A-B 循环范围的 HTML；
   - 验证 `isPublicHttpUrl` 拦截所有内网/回环 SSRF 地址，且 `pith_ingest_external` 工具能将模拟 HTML 网页清洗转换为工作区离线 Material 并自动关联到 Topic。

---

## 📦 Wave 4 · Track B（Agent B 负责）：双壳多材料工作台升级（时间轴/固定页/EPUB 切换 + 本地材料上传导入 + Dojo ASR 语音录入联调）

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/shells/web/server.ts`
- `src/shells/obsidian/index.ts`
- `src/shells/obsidian/plugin.ts`
- 新增 `tests/wave4-trackB-workbench-and-media.test.ts`
- *(严禁修改 `src/core/**`、`src/plugins/**`、`src/shells/dsh/**` 或其他现有测试文件！保证现有 59 项测试继续 100% 通过！)*

### 2. 核心设计目标（让 Web 与 Obsidian 双壳真正支持导入新材料、渲染音视频时间轴与固定页、以及在 Dojo 中调用 ASR）

1. **Web 壳与控制器支持「新建/导入本地材料」与「音视频时间轴 Stage 自动切换」（`src/shells/web/server.ts`）**：
   - 新增 `POST /api/materials` 路由：接收 `{ title: string, kind: "book" | "article" | "media" | "discussion", files: { name: string, mimeType?: string, contentBase64?: string, text?: string }[], topicId?: string }`，调用 `store.importMaterial()` 创建不可变原始材料（若提供 `topicId` 则调用 `store.updateTopic(topicId, { materialId: material.id })`）；
   - 升级 `GET /api/materials/file`（及 `/api/materials/:id/file`）：
     - 当材料 `kind === "media"` 或文件为 `.vtt / .srt`（或关联了字幕文件）时，若 `stage.timeline` 服务可用，调用 `timeline.parseTranscript(text)` 解析字幕 cues，并返回 `{ format: "timeline", text, html, sections, cues }`（前端点击字幕时间点或设置 A-B 区间时，可一键将选中字幕填入底部 4 阶跟读工坊 `#dojo-target`！）；
   - 新增 `POST /api/speech/transcribe` 路由：接收 `{ audioBase64: string, mimeType?: string }`，调用 `runtime.getService<SpeechAsrService>("speech.asr")?.transcribeAudio(...)`（若服务实现了 `transcribeAudio`）返回 `{ text }`，并在底部 4 阶跟读工坊面板中增加 `[ 🎙️ 语音转写复述 ]` 按钮支持一键转写填入 `#dojo-produced`！

2. **前端工作台与 Obsidian 视图同步升级（`src/shells/web/server.ts` & `src/shells/obsidian/plugin.ts` & `index.ts`）**：
   - 在 Web 首页（罗盘页）或课题页支持 `＋ 导入材料` 表单（可粘贴 Markdown/字幕文本或上传本地文件创建 Material）；
   - 在阅读舞台与 `obsidianStyles` 中补齐 `.pith-timeline-stage` 与 `.pith-cue` 的宿主原生样式（完全使用 `var(--background-secondary)`、`var(--text-normal)`、`var(--text-accent)`，零硬编码暖黄色），点击 `.pith-cue` 可直接将该句字幕选为跟读目标或从该处伴读；
   - 在 `PithObsidianController` 中增加 `importMaterial(input)` 与 `renderMaterialFile(materialId, fileName)` 辅助方法，使 Obsidian 插件可直接渲染 Markdown、EPUB、PDF/CBZ 固定页以及音视频字幕时间轴。

3. **测试要求（`tests/wave4-trackB-workbench-and-media.test.ts`）**：
   - 验证 `POST /api/materials` 导入新材料（含 Markdown 与 WebVTT/SRT 媒体字幕）并绑定到 Topic；
   - 验证 `GET /api/materials/file` 对字幕材料自动返回解析后的 `cues` 与时间轴 HTML；
   - 验证 `PithObsidianController.importMaterial` 与 `renderMaterialFile` 在 Obsidian 壳下正常工作，且 `npm run build:obsidian` 与全量测试 100% 通过。

---

## 三、 每个 Agent 交付前必跑的自检命令

```bash
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm run typecheck
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm test
npm run build:obsidian
git status -s
```
