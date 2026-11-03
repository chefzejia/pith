# Pith · 跨会话交接单（HANDOFF）

Status: pending
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
2. **音频与语音协议解耦（Contract-First）**：
   - **静态衍生音频资产**：材料目录 `materials/<id>/files/` 下的标准音频文件（`.mp3/.m4a/.wav/.ogg`）与时间轴字幕（`.vtt/.srt`）由 `.pith-media-deck` 直接停靠加载并同步高亮，与外部生成工具零耦合。
   - **实时 TTS / ASR 协议适配器与三态健康报告**：`src/core/seams.ts` 定义 `SpeechHealthStatus = "verified" | "unverified" | "failed"` 与 `SpeechHealthReport`；本地回环 `/transcribe` 兼容无 `Content-Type` 或 `text/plain` 的 JSON 与纯文本响应并拒绝 HTML。

---

## 二、 当前待办任务包（Wave 8 真机 E2E 终验：真实桌面 Obsidian `.dev-vault` + Web 真机闭环）

### 背景与目标
上一轮（`dbe4f6f`）因当时尚未提供隔离 `--user-data-dir` 的真机启动脚手架，Tester 跳过了真实桌面 Obsidian 验收。现 Brain 已合入 `scripts/verify-obsidian-e2e.ts`（`npm run verify:obsidian`）并在 `scripts/build-obsidian.mjs` 中自动将构建产物同步至 `.dev-vault/.obsidian/plugins/pith/`。本轮要求对 Wave 8 全部改动执行**真正的桌面 Obsidian（`.dev-vault`）与 Web 端到端真机验收**（严禁用假 DOM / Controller Stub 替代真机验收）。

### 授权修改范围（Worker · 含 Router 同目标裁决权）
- `scripts/verify-obsidian-e2e.ts` & `scripts/build-obsidian.mjs`
- `src/shells/obsidian/index.ts` & `src/shells/obsidian/plugin.ts`
- `src/shells/web/server.ts`
- `tests/` 下相关测试文件

### 具体要求与真机验收标准（Worker & Tester）
1. **深化真机 Obsidian E2E 脚本（`scripts/verify-obsidian-e2e.ts`）并实际跑通 `npm run verify:obsidian`**：
   - 拉起真实的 `/Applications/Obsidian.app/Contents/MacOS/Obsidian`（使用 `--user-data-dir=.tmp/obsidian-user-data` 与动态 CDP 端口，不触碰宿主机正在运行的真实 Vault 实例）打开 `.dev-vault`；
   - 在真实 Obsidian 渲染进程 DOM 中：
     1. 验证 `pith-reader` 视图挂载成功、左侧原生文件树自动折叠（`leftSplit.collapsed === true`）；
     2. 渲染真实的 `PithSettingTab` DOM，**模拟真实用户在 DOM `<select>` / `<input>` 上修改 `TTS`、`TTS 端点`、`TTS 模型`、`TTS 音色`、`ASR`、`本机 ASR 端点`、`ASR 模型` 并点击 `保存设置` 按钮**（而非直接调用 `controller.setSpeechConfig` 绕过 UI）；
     3. 验证点击保存后状态文本变为 `"设置已保存"`，且 `.dev-vault/Pith/_cache/web-settings.json` 磁盘文件内容与 UI 输入完全一致；
     4. 验证结束后清理还原 `.dev-vault/Pith/_cache/web-settings.json` 测试痕迹并退出隔离 Obsidian 进程。
2. **全套门禁与独立验收（Tester）**：
   - 真实运行 `npm run typecheck && npm test && npm run verify:obsidian` 全部零报错通过；
   - 验收通过后，由 Router 将本文件更新为 `Status: verified`（附 `Verified-Commit`）并 `git commit` 收口。
