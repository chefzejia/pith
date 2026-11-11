# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：
> **单文件滑动任务栈与多 Worktree 协同契约**：详见 [ROLES.md](ROLES.md) 等文档。

---

## [Task #40] 架构重整：视图模块化拆解与双壳交互逻辑对称收敛

- **Status**: verified
- **Verified-Commit**: 77895ee44464140721fb3e4af6ecb7cf1cdfa180
- **Evidence**: `.tmp/evidence/task-40/final-report.md`；双端正常/窄屏操作截图位于同目录。
- **验收结果**: 双端材料导入/切换、播放定位/关闭、向导对话隔离/恢复、工具打开/移除通过；全仓 268 通过、70 条件跳过、0 失败。
- **Scope**: `src/workbench/view.ts` (拆解为 `src/workbench/view/*.ts`), `src/shells/`
- **验收摘要**：将核心视图组件（顶栏、目录、播放、向导、原位工具）模块化，样式归口统一；收敛 Web 与 Obsidian 壳在导入、路由、会话逻辑上的不一致，统一为 HostPort 适配器。
- **验证门禁**：`npm run typecheck && npm test` 全绿，确保双端体验完全对称。

---

## [Task #41] MVP 场景 1：纯阅读闭环（网页直投剪藏、结构化净化与行间翻译自动注入）

- **Status**: blocked
- **Last-Tested-Commit**: aa09b2fe04341fd6f3a2f58fd66e6adbff912765
- **阻塞证据**: 三轮真实服务验收未通过（c93d9e4、3fde728、aa09b2f）。最新单独运行隔离 Obsidian，新导入公网英文文章、使用新材料且无旧翻译缓存，真实 dsh 的 `session/prompt` 仍在 60000ms 超时且无译文；已核对运行中的 Agent/model/effort 与授权设置一致，真实执行命令和沙盒工作目录正确。尚不能归因于配置、服务端或产品协议路径。
- **已修复边界**: 整篇单元改为正文块渐进翻译；单段译文使用纯文本，避免生成式 JSON 的引号解析失败。真实 Web 译文已观察到，但不能替代双端最终通过。
- **Evidence**: `.tmp/evidence/task-41/final-report.md`、`live-retest-report.md`、`live-final-report.md` 及同目录 `live-*.png`；固定译文截图仅属链路回归，不算真实翻译验收。
- **未完成**: 最新业务版本 Web 独立复验、原生真实译文与成功后的模式切换、原生显式工具选择后导入保留；不得填写 Verified-Commit。
- **后续诊断边界**: 需捕获原生实际 ACP 协议阶段和服务响应以区分超时来源；保留现有 Agent/model/effort，禁止回退固定译文或盲目延长超时。依 ROLES 三轮失败规则退回思考环。
- **Scope**: `src/plugins/guide-acp/externalIngest.ts`, `src/workbench/compass.ts`, `src/workbench/toolkitSlot.ts`, `src/plugins/dojo-interline/index.ts`, `tests/**`
- **验收摘要**：
  1. Omnibox 支持 URL 直投剪藏，跳过 Agent 生成直接落盘。
  2. 优化 HTML 净化 Markdown，完整保留标题、代码块与引用结构。
  3. EPUB/Blog 导入自动识别语言并自动挂载 `["interline"]`，开箱即双语模式就绪。
- **验证门禁**：通过英文博客导入即刻阅读且行间模式即时可用，断言工具组精确包含行间而不混入误报工具。

---
