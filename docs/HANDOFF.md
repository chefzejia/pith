# Pith · 跨会话交接单（HANDOFF）

Status: verified
Verified-Commit: 5282737
Updated: 2026-11-03

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **双环四重身份协同契约（详见 [ROLES.md](ROLES.md)）**：
> - **思考环（Brain）**：与用户明确业务/产品目标并冻结 `src/core/` 契约后，将本文件设为 `Status: pending` 并 `git commit`；
> - **执行环（无人值守 Router → Worker & Tester）**：仅当存在明确业务任务包且 `Status: pending` 时触发执行。

## 一、 当前架构与协议基线（Wave 1 ~ Wave 8 已收官）

1. **三层同心圆架构（`src/core` · `src/plugins` · `src/shells`）**：
   - `src/core/`：`PluginRuntime`、`DefaultWorkspaceStore`（Markdown 事实源 + `MutationQueue` 串行写锁）、`DefaultAttentionEngine`（去 Session 化罗盘与 `_cache/effects.json` 合并队列）及 `HostPort` 能力接缝。
   - `src/plugins/`：`stage-reader`、`stage-timeline`、`dojo-shadowing`、`dojo-feynman`、`speech-service`、`guide-acp` 六大内置插件互不耦合，由内核与 Agent 按需编排。
   - `src/shells/`：`shells/obsidian`、`shells/web`、`shells/dsh` 遵循 [003-interaction.md](003-interaction.md) 空间契约。
2. **音频与语音协议解耦（Contract-First）**：
   - **静态衍生音频资产**：材料目录 `materials/<id>/files/` 下的标准音频文件（`.mp3/.m4a/.wav/.ogg`）与时间轴字幕（`.vtt/.srt`）由 `.pith-media-deck` 直接停靠加载并同步高亮。
   - **实时 TTS / ASR 协议适配器**：`src/core/seams.ts` 定义 `SpeechHealthStatus = "verified" | "unverified" | "failed"` 与 `SpeechHealthReport`；支持通用 OpenAI-Compatible 端点、自定义 `ttsModel` / `asrModel` 及本机 Loopback 服务。
3. **验证门禁**：
   - `npm run typecheck && npm test`（146 项单测与架构边界守卫全绿）
   - `npm run verify:obsidian`（自动同步 `.dev-vault` 并通过 CDP 执行真实 Obsidian 客户端 E2E 验证）

## 二、 当前待办任务包

当前无挂起任务包（`Status: verified`）。待 Brain 与用户敲定下一个具体产品功能或体验问题后派发。
