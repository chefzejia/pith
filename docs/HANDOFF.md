# Pith · 跨会话交接单（HANDOFF）

Status: verified
Verified-Commit: 468a9d277310594e6ecdfea7c60745638e1a1665
Updated: 2026-11-03

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **双环四重身份协同契约（详见 [ROLES.md](ROLES.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 契约后将本文件设为 `Status: pending` 并 `git commit`；
> - **执行环（无人值守 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒，在同一轮次内循环 `wait_agent` 调度常驻 Worker 与独立 Tester 完成闭环并提交 `Status: verified`（若遇同目标漏列非核心支撑文件，Router 直接授权 Worker 补齐；严禁在后台会话停下向人类提问等待回复）。

## 一、 当前架构与协议基线

1. **三层同心圆架构（`src/core` · `src/plugins` · `src/shells`）**：
   - `src/core/`：`PluginRuntime`、`DefaultWorkspaceStore`（Markdown 事实源 + `MutationQueue` 串行写锁）、`DefaultAttentionEngine`（去 Session 化罗盘与 `_cache/effects.json` 合并队列）及 `HostPort` 能力接缝。
   - `src/plugins/`：`stage-reader`、`stage-timeline`、`dojo-shadowing`、`dojo-feynman`、`speech-service`、`guide-acp` 六大内置插件互不耦合，由内核与 Agent 按需编排。
   - `src/shells/`：`shells/obsidian`、`shells/web`、`shells/dsh` 遵循 [003-interaction.md](003-interaction.md) 空间契约。
2. **音频与语音协议解耦（Contract-First · Brain 已裁决并冻结核心契约）**：
   - **静态衍生音频资产**：材料目录 `materials/<id>/files/` 下的标准音频文件（`.mp3/.m4a/.wav/.ogg`）与时间轴字幕（`.vtt/.srt`）由 `.pith-media-deck` 直接停靠加载并同步高亮，与外部生成工具零耦合。
   - **实时 TTS / ASR 协议适配器与三态健康报告**：
     - `src/core/seams.ts` 已定义 `SpeechHealthStatus = "verified" | "unverified" | "failed"` 与 `SpeechHealthReport`，在保持 `ok: boolean` 兼容的同时，以 `status` 显式区分已验证（`verified`）、未验证（`unverified`）与失败（`failed`）；
     - 本地回环 `/transcribe` 响应解析兼容无 `Content-Type` 或 `text/plain` 的 JSON 与纯文本响应，并严格拒绝 HTML 错误页。

---

## 二、 当前待办任务包（Wave 8 收口：通用语音协议与三态健康报告独立验收）

### 上游 Brain 裁决说明（针对上一轮 `Status: blocked` 事项）
1. **Core 契约已升级**：`src/core/seams.ts` 已新增 `SpeechHealthStatus = "verified" | "unverified" | "failed"` 与 `SpeechHealthReport`，并在 `src/plugins/speech-service/neuralSpeech.ts` 中落地；
2. **无 `Content-Type` 旧服务纯文本响应已修复**：`neuralSpeech.ts` 的 `legacyLocal` 分支已兼容 `responseType === ""` 的非 HTML 纯文本响应；
3. **无干扰验收契约已写入 `docs/ROLES.md`**：当宿主机已有用户真实桌面 Obsidian 正在运行时，**严禁打开或操作桌面 Obsidian 应用**，统一通过隔离 Controller 集成测试 + `dist/obsidian/` 产物核验 + Web 壳真实 HTTP/无头浏览器验证完成验收。

### 授权修改范围（Worker · 含 Router 同目标裁决权）
- `src/plugins/speech-service/neuralSpeech.ts` & `src/plugins/speech-service/index.ts`
- `src/shells/web/server.ts`
- `src/shells/obsidian/index.ts` & `src/shells/obsidian/plugin.ts`
- `tests/` 下相关测试文件

### 验收标准（Tester）
- `npm run typecheck && npm test && npm run build:obsidian` 全绿（当前 142 项单测含 `tests/wave8-*.test.ts` 与 `tests/boundaries.test.ts`）；
- 静态与无干扰动态验证确认：
  1. `checkTtsHealth` / `checkAsrHealth` 返回结构化 `status: "verified" | "unverified" | "failed"`；
  2. 本地 ASR（`whisper-local` / `sensevoice-local`）支持自定义端点、`/v1/audio/transcriptions` 模型透传、以及无 `Content-Type` 纯文本/JSON 兼容且拒绝 HTML；
  3. Web 与 Obsidian 壳设置持久化与产物构建通过（不触碰宿主机运行中的真实 Obsidian 桌面进程）；
- 验收通过后，由 Router 将本文件更新为 `Status: verified`（附 `Verified-Commit`）并 `git commit` 收口。
