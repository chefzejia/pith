# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：
> **单文件滑动任务栈与多 Worktree 协同契约**：详见 [ROLES.md](ROLES.md) 等文档。

---

## [Task #40] 架构重整：视图模块化拆解与双壳交互逻辑对称收敛

- **Status**: pending
- **Scope**: `src/workbench/view.ts` (拆解为 `src/workbench/view/*.ts`), `src/shells/`
- **验收摘要**：将核心视图组件（顶栏、目录、播放、向导、原位工具）模块化，样式归口统一；收敛 Web 与 Obsidian 壳在导入、路由、会话逻辑上的不一致，统一为 HostPort 适配器。
- **验证门禁**：`npm run typecheck && npm test` 全绿，确保双端体验完全对称。

---

## [Task #41] MVP 场景 1：纯阅读闭环（网页直投剪藏、结构化净化与行间翻译自动注入）

- **Status**: pending
- **Scope**: `src/plugins/guide-acp/externalIngest.ts`, `src/workbench/compass.ts`, `src/workbench/toolkitSlot.ts`, `src/plugins/dojo-interline/index.ts`, `tests/**`
- **验收摘要**：
  1. Omnibox 支持 URL 直投剪藏，跳过 Agent 生成直接落盘。
  2. 优化 HTML 净化 Markdown，完整保留标题、代码块与引用结构。
  3. EPUB/Blog 导入自动识别语言并自动挂载 `["interline"]`，开箱即双语模式就绪。
- **验证门禁**：通过英文博客导入即刻阅读且行间模式即时可用，断言工具组精确包含行间而不混入误报工具。

---
