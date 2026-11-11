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

- **Status**: verified
- **Verified-Commit**: aa09b2fe04341fd6f3a2f58fd66e6adbff912765
- **Evidence**: `.tmp/evidence/task-41/live-after-user-exit-report.md`；同目录 `live-after-user-exit-native-paragraph-visible.png`、`live-after-user-exit-web-paragraph-visible.png` 及 original/restored 截图为本轮真实服务证据；早期固定译文仅属链路回归。
- **验收结果**: 独立 Tester 串行使用真实配置的 dsh，在隔离 Obsidian 与 Web 新材料中确认引文、实质正文的对应中文译文，原文/行间切换及缓存恢复通过；原生直接导入后明确改选费曼并重开保持。导入前显式选择的条件分支以工程回归覆盖，不虚构缺少入口的原生操作。Worker 类型检查、构建通过，全仓 274 通过、71 条件跳过、0 失败。
- **已修复边界**: URL 直接剪藏、结构净化、外文默认仅行间；正文块渐进翻译，单段纯文本响应避免生成式 JSON 引号解析失败。未修改 Agent/model/effort。
- **已知限制**: 双端采样通过不代表整篇稳定。Web 引文约 69 秒、正文约 145 秒出现，后续另一段发生一次 60000ms session/prompt 超时；未确认该失败提示的实际可见性与重试入口，未证明该段完成。自然语言向导剪藏另有超时，与 URL 直接导入分开记录。
- **产物核对**: 本轮同步并核对隔离 configDir 实际插件三文件哈希。此前原生失败进程缺少加载哈希，旧报告不能作为最新业务 SHA 原生失败的有效结论；不推断旧产物或用户退出是先前超时的确定原因。
- **Scope**: `src/plugins/guide-acp/externalIngest.ts`, `src/workbench/compass.ts`, `src/workbench/toolkitSlot.ts`, `src/plugins/dojo-interline/index.ts`, `tests/**`
- **验收摘要**：
  1. Omnibox 支持 URL 直投剪藏，跳过 Agent 生成直接落盘。
  2. 优化 HTML 净化 Markdown，完整保留标题、代码块与引用结构。
  3. EPUB/Blog 导入自动识别语言并自动挂载 `["interline"]`，开箱即双语模式就绪。
- **验证门禁**：通过英文博客导入即刻阅读且行间模式即时可用，断言工具组精确包含行间而不混入误报工具。

---
