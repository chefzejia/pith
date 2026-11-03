# Pith · 跨会话交接单（HANDOFF）

Status: pending
Updated: 2026-11-03

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **协同触发说明**：Brain 冻结 `src/core/` 契约后将本文件设为 `Status: pending` 并提交 Git，自动唤醒常驻 Worker 与独立 Tester 完成实现与 `.dev-vault` 真机验收，验收通过后更新为 `Status: verified`。

## 一、 当前架构与协议基线

1. **三层同心圆架构（`src/core` · `src/plugins` · `src/shells`）**：
   - `src/core/`：`PluginRuntime`、`DefaultWorkspaceStore`（Markdown 事实源 + `MutationQueue` 串行写锁）、`DefaultAttentionEngine`（去 Session 化罗盘与 `_cache/effects.json` 合并队列）及 `HostPort` 能力接缝。
   - `src/plugins/`：`stage-reader`、`stage-timeline`、`dojo-shadowing`、`dojo-feynman`、`speech-service`、`guide-acp` 六大内置插件互不耦合，由内核与 Agent 按需编排。
   - `src/shells/`：`shells/obsidian`、`shells/web`、`shells/dsh` 遵循 [003-interaction.md](003-interaction.md) 空间契约。
2. **音频与语音协议解耦（Contract-First · Brain 已冻结核心契约）**：
   - **静态衍生音频资产**：材料目录 `materials/<id>/files/` 下的标准音频文件（`.mp3/.m4a/.wav/.ogg`）与时间轴字幕（`.vtt/.srt`）由 `.pith-media-deck` 直接停靠加载并同步高亮，与外部生成工具零耦合。
   - **实时 TTS / ASR 协议适配器**：`src/core/seams.ts` 与 `src/plugins/speech-service/` 已扩展支持通用协议标识（`openai-compatible-local`）及自定义 `ttsModel`、`asrModel`、`ttsEndpoint`、`ttsVoice`；`tests/boundaries.test.ts` 已锁死零系统低劣 TTS 与零外部仓库硬编码耦合。

---

## 二、 当前待办任务包（Wave 8：宿主壳通用语音协议配置同步与文案去耦合）

### 背景与目标
Brain 已在 `src/core/seams.ts` 与 `src/plugins/speech-service/` 中完成通用语音协议解耦（支持自定义 `ttsModel` / `asrModel` 与通用本机 OpenAI 兼容端点）。但 `src/shells/web/server.ts` 与 `src/shells/obsidian/` 的前端设置表单及错误提示仍残留硬编码的特定模型文案（如把本机服务写死为 `Kokoro-82M` 且未暴露 `ttsModel` / `asrModel` 配置项，或限制非 `whisper-local` 时禁用 `asr-endpoint`）。

### 授权修改范围（Worker）
- `src/shells/web/server.ts`
- `src/shells/obsidian/index.ts`
- `src/shells/obsidian/plugin.ts`（如需调整文案）
- `tests/` 下相关测试文件

### 具体要求
1. **Web 壳（`src/shells/web/server.ts`）**：
   - 设置抽屉支持配置并持久化 `ttsModel` 与 `asrModel`（随 `/api/settings` 的 `speech` 字段保存并传入 `speech-service`）；
   - 允许所有本机 ASR 预设（`whisper-local` 与 `sensevoice-local`）编辑自定义端点 URL，不再仅限 `whisper-local`；
   - 将前端与服务端错误提示中的硬编码品牌催促文案统一收敛为中性的通用协议提示（如 `"未连接语音引擎，请前往 ⚙ 设置配置本地或云端 TTS 服务"`）。
2. **Obsidian 壳（`src/shells/obsidian/index.ts`）**：
   - `PithSettingTab` 同步更新通用协议选项文案，并允许配置/保存 `ttsEndpoint`、`ttsModel`、`ttsVoice`、`asrLoopbackUrl`；
   - 重新运行 `npm run build:obsidian` 更新 `dist/obsidian/` 产物。
3. **验收标准（Tester）**：
   - `npm run typecheck && npm test && npm run build:obsidian` 全部零报错通过；
   - `tests/boundaries.test.ts` 全绿；
   - Web 与 Obsidian 设置持久化和语音协议自定义 `ttsModel` / `asrModel` 经测试验证生效。
