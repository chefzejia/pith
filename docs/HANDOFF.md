# Pith · Wave 2 并行独立 Agent 开发交接单（HANDOFF · Track A / Track B）

> **仓库路径**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **必读契约**：[`AGENTS.md`](../AGENTS.md) · [`docs/002-architecture.md`](002-architecture.md) · [`docs/003-interaction.md`](003-interaction.md) · [`src/core/seams.ts`](../src/core/seams.ts)
> **并行隔离铁律**：以下 **2 个任务包（Track A / Track B）的修改文件集 100% 物理正交，零交集**！每个 Agent **严禁触碰自己 Write Scope 之外的任何文件**（尤其严禁修改 `src/core/**` 和现有旧测试文件），确保两人同时开发零冲突。

---

## 📦 Wave 2 · Track A（Agent A 负责）：插件层深水区升级（Agent 动态挂载工具 + 阅读教学块/精准锚点 + 时间轴循环切分）

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/plugins/guide-acp/index.ts`
- `src/plugins/guide-acp/acpSession.ts`
- `src/plugins/stage-reader/index.ts`
- 新增 `src/plugins/stage-reader/teachingBlocks.ts`（内嵌交互式教学块解析与渲染）
- 新增 `src/plugins/stage-reader/textAnchor.ts`（基于 `locator` + `quote` + `prefix/suffix` 的跨文本精准重定位）
- `src/plugins/stage-timeline/index.ts`
- `src/shells/dsh/index.ts`
- 新增 `tests/wave2-trackA-plugins.test.ts`
- *(严禁修改 `src/core/**`、`src/shells/web/**`、`src/shells/obsidian/**` 或其他现有测试文件！)*

### 2. 核心设计目标（对齐 [`src/core/seams.ts`](../src/core/seams.ts) 已定型签名）

1. **由 Agent 驱动课题工具包动态挂载（`guide-acp` & `shells/dsh`）**：
   - 在 `src/plugins/guide-acp/index.ts` 中：
     - 升级 `buildScenePrompt(input)`：当传入 `availableToolkits`（或默认列出可用 Dojo 工具，如 `shadowing: 4-Stage Language Shadowing`）时，在 Prompt 中输出 `# 可用实训工具包（Dojo Toolkits）` 与当前课题已挂载的 `topic.toolkits`，引导 Agent 根据用户学习目标主动建议或调整实训工具；
     - 在 `GuideAgentService` 上实现 `configureTopicToolkits(topicId, toolkits): Promise<Topic>`：校验 `toolkits` ID 合法性（`^[a-z][a-z0-9-]*$` 且去重），调用 `store.updateTopic(topicId, { toolkits })` 动态为课题启用/卸载 Dojo 工具；
     - 支持解析 Agent 回复尾部的可选工具挂载指令块（例如 ````pith-toolkits\n["shadowing"]\n````），或在 `LocalAcpGuideProvider.reply()` 中保留清晰的扩展钩子。
   - 在 `src/shells/dsh/index.ts` 的 `createDshPluginBundle()` 中：
     - 新增工具 `pith_configure_toolkits`（参数 `{ topicId: string, toolkits: string[] }`），允许 DSH Agent 直接为指定课题开启或关闭实训工具包（如 `["shadowing"]`）。

2. **`stage-reader` 深水区升级：交互式教学块（`teachingBlocks.ts`）与精准文本锚点（`textAnchor.ts`）**：
   - 参考 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/material/render/teachingBlocks.ts` 与 `textAnchor.ts`：
   - **内嵌教学块（`src/plugins/stage-reader/teachingBlocks.ts` & `StageReaderService.extractTeachingBlocks`）**：
     - 识别 Markdown 中的围栏教学块（如 ````pith-teaching` 或 ````garden-teaching` 或 Callout `> [!reflection|hint|checkpoint|explanation] 标题`），提取出 `TeachingBlockSpec`（`id`, `kind: "reflection" | "hint" | "checkpoint" | "explanation"`, `title`, `body`, `locator: "text:line:<n>"`）；
     - 在 `renderMarkdown(markdown)` 中将其渲染为 `<section class="pith-teaching-block" data-teaching-kind="..." data-locator="text:line:<n>" data-prose="false">...</section>`（注意 `data-prose="false"`，确保全文伴读自动跳过教学卡片元数据，不打断正文朗读）。
   - **跨文本精准锚点匹配（`src/plugins/stage-reader/textAnchor.ts` & `StageReaderService.matchTextAnchor`）**：
     - 实现 `matchTextAnchor(fullText, anchor): TextQuoteMatch | null`：
       1. 若 `anchor.locator` 为 `text:offset:<n>` 且 `fullText.slice(n, n + quote.length) === quote`，直接命中返回 `{ startOffset, endOffset, exact, prefix, suffix }`；
       2. 若偏移漂移（文章前部被微调），遍历 `fullText` 中所有 `anchor.quote` 的出现位置，优先选择 `prefix` / `suffix` 上下文匹配度最高或距离原 `offset` 最近的匹配项；
   - 在 `stage-reader/index.ts` 的 `StageReaderService` 实例上挂载 `extractTeachingBlocks` 与 `matchTextAnchor`。

3. **`stage-timeline` 深水区升级：A-B 区间循环切片与双语/多行字幕清理**：
   - 在 `src/plugins/stage-timeline/index.ts` 中实现 `sliceLoopRange(cues, startSec, endSec): readonly TranscriptCue[]`：
     - 校验 `startSec >= 0` 且 `endSec > startSec`，返回所有与 `[startSec, endSec]` 时间区间有交集（`cue.endSec > startSec && cue.startSec < endSec`）的字幕片段，供 A-B 复读与一键送入 `dojo-shadowing` 使用；
     - 挂载到 `StageTimelineService.sliceLoopRange`。

4. **测试要求（`tests/wave2-trackA-plugins.test.ts`）**：
   - 验证 `guide.agent.configureTopicToolkits` 与 `dsh` 工具 `pith_configure_toolkits` 动态挂载/卸载课题工具包，以及 `buildScenePrompt` 包含可用工具包上下文；
   - 验证 `extractTeachingBlocks` 与 `renderMarkdown` 正确渲染教学块且标记 `data-prose="false"`；
   - 验证 `matchTextAnchor` 在原文前部插入/删除文字导致 offset 漂移后，仍能通过 `quote` + `prefix/suffix` 精准找回高亮区间；
   - 验证 `stage-timeline` 的 `sliceLoopRange` 准确切出 `[startSec, endSec]` 区间字幕。

---

## 📦 Wave 2 · Track B（Agent B 负责）：壳层纠偏升级（砍掉用户插件开关 UI + 本机 Agent 探测配置面板 + 真实 ACP 联机对话）

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/shells/web/server.ts`
- `src/shells/obsidian/index.ts`
- `src/shells/obsidian/plugin.ts`
- 新增 `tests/wave2-trackB-shells.test.ts`
- *(严禁修改 `src/core/**`、`src/plugins/**`、`src/shells/dsh/**` 或其他现有测试文件！注意保证 `tests/web-shell.test.ts` 和 `tests/track3-spatial-ui-and-obsidian.test.ts` 继续 100% 通过！)*

### 2. 核心设计目标（对齐「插件由 Agent 编排、不暴露给用户手工开关」的新铁律）

1. **彻底移除面向用户的「插件开关列表与 Preset 选择器」UI，升级为「本机 AI 向导连接与外观设置面板」**：
   - **产品铁律**：普通用户绝不需要手动开关 `stage-reader`、`dojo-shadowing`、`speech-service`！所有内置插件在内核中默认开启就绪，由课题材料类型和 Agent 驱动的 `topic.toolkits` 动态决定界面上展示什么工具。
   - 在 `src/shells/web/server.ts` 的前端 `settings()` 抽屉中：
     - **彻底删除** `插件预设 (all/essentials)` 下拉框与 `input[type="checkbox"][data-plugin]` 插件勾选框列表！
     - 替换为干净现代的 **「向导 Agent 与工作区设置」**：
       - **本机 Agent 选择器（`#agent-id`）**：下拉选择 `""`（离线模式 / 不启用 AI）、`"dsh"`（DeepSeek Harness）、`"claude"`（Claude Code）、`"codex"`（Codex）；
       - **一键扫描本机 Agent 按钮（`#detect-agents`）与状态列表**：调用 `GET /api/agents?force=true` 扫描本机已安装的 CLI，清晰展示每个 Agent 的可用状态（`available`）、版本号（`version`）与诊断说明（`note`）；
       - **模型与推理强度（`#agent-model`、`#agent-effort`）** 与 **术语风格（`#persona`：`studio` 工作区/向导 vs `sanctuary` 花园/园丁）**。

2. **打通 `shells/web/server.ts` 的本机 Agent API 与真实对话闭环**：
   - 新增 `GET /api/agents` 路由：调用 `runtime.getService<GuideAgentService>("guide.agent")?.detectAgents(url.searchParams.get("force") === "true")`，返回本机 Agent 探测结果数组；
   - 新增（并兼容保留 `/api/plugins` 以免破坏旧接口测试）`POST /api/settings` 路由：支持保存 `agentId`（`"" | "dsh" | "claude" | "codex"`）、`model`、`effort`、`persona` 到 `_cache/web-settings.json`，并将 `agentId / model / effort` 传入 `guide-acp` 插件配置触发 `runtime.reconcile()`；
   - **真实本机 Agent 对话闭环**：当用户未传入外部 mock `options.guideProvider`，但在设置中配置了有效的本机 `agentId`（如 `"dsh"`）时，`POST /api/chat` 与后台 `processEffects()` 自动使用 `LocalAcpGuideProvider`（或由 `guide-acp` 提供的 provider）完成对话与下一步建议生成！

3. **同步升级 `src/shells/obsidian/index.ts` 与 `plugin.ts`**：
   - 在 `PithObsidianController` 中增加 `detectAgents(force?: boolean)` 与 `setAgentConfig({ agentId, model, effort, persona })` 方法，将设置持久化并在 `runtime.reconcile()` 时传入 `guide-acp` 插件配置。

4. **测试要求（`tests/wave2-trackB-shells.test.ts`）**：
   - 验证 Web 壳 HTML 中不再渲染任何 `data-plugin=` 手工开关插件勾选框，而是包含本机 Agent 探测与配置控件（`#agent-id`、`#detect-agents`）；
   - 验证 `GET /api/agents` 与 `POST /api/settings` 能正确探测本机 Agent 并持久化 `agentId / model / effort / persona`；
   - 验证 `PithObsidianController` 的 `detectAgents()` 与 `setAgentConfig()` 正常工作，且原有全部测试（`web-shell.test.ts`、`track3-spatial-ui-and-obsidian.test.ts` 等）保持 100% 全绿。

---

## 三、 每个 Agent 交付前必跑的自检命令

```bash
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm run typecheck
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm test
git status -s
```
