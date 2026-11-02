# Task Packages · Worker 执行任务包清单

本文件由 **Brain** 维护，按严格串行（共享工作树 `Write = 1`）定义交给 **Worker** 实现并由 **Tester** 独立验收的垂直切面任务包。

---

## Task 1：实现零宿主依赖的 `WorkspaceStore`（Phase 1）

- **授权修改范围**：
  - 新增 `src/core/store/MutationQueue.ts`、`src/core/store/frontmatter.ts`、`src/core/store/WorkspaceStore.ts`
  - 更新 `src/core/index.ts`（导出 `DefaultWorkspaceStore`）
  - 新增 `tests/store.test.ts`
- **只读参考来源**：
  - `/Users/zejiawu/Projects/Project-Atlas/labs/pith/src/core/store/contract.ts`（必须 100% 实现该接口）
  - `/Users/zejiawu/Projects/Project-Atlas/labs/pith/docs/001-domain.md`
  - `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/store/`（可提纯复用其 `MutationQueue` 与 Markdown 解析逻辑，但必须彻底洗净 `garden-` / `GardenStore` 旧前缀，改用 `pith-` 与 `WorkspaceStore`）
- **不在范围内（Out of Scope）**：
  - 严禁引入任何第三方 npm 运行时依赖（如 `yaml` 包；使用纯 TS 实现受控 frontmatter 与 `<!-- pith-note:v1 -->` 块解析）；
  - 严禁修改 `src/plugins/*` 或触碰 UI 视图。
- **接口与行为契约**：
  1. `ensureScaffold()` 确保 `ME.md`、`topics/`、`materials/`、`_cache/` 存在，幂等且不覆盖已有文件；
  2. `listTopics()` 与 `listMaterials()` 扫描时遇到单个损坏文件必须 `try/catch` 跳过，绝不阻断整个工作区加载；
  3. 所有写操作（`writeProfile`、`createTopic`、`updateTopic`、`appendNote`、`importMaterial`、`writeGeneratedFile`、`updateReadingLocator`）通过同一 `MutationQueue` 串行化，防止并发读写竞态；
  4. 能够直接无损读取并解析 `workspace/ME.md`、`workspace/topics/topic-001-architecture-foundations/topic.md` 与 `workspace/materials/material-001-magpie-dsh-anatomy/material.md`。
- **Worker 自检要求**：
  - `npm run typecheck` 与 `npm test`（含 `tests/boundaries.test.ts`、`tests/pluginrt.test.ts`、`tests/store.test.ts`）全部通过。
- **Tester 验收标准**：
  - 静态检查：`src/core/store/` 零外部依赖、零旧隐喻残留；
  - 动态检查：用真实 Node `fs` 适配器指向 `/Users/zejiawu/Projects/Project-Atlas/labs/pith/workspace/`，实测读取第 001 号课程 Topic 与 Material 完整往返无损。

---

## Task 2：实现独立 Web 端宿主壳与第一屏 Attention Compass（Phase 2 · 待 Task 1 验收后派发）

- **授权修改范围**：
  - `src/shells/web/**`、`src/plugins/stage-reader/**`、`tests/web-shell.test.ts`
- **不在范围内**：
  - 不实现 EPUB/PDF 复杂分页（Phase 2 先打通 Markdown 课程讲义阅读、选区高亮写回 `topic.md`、以及插件开关面板）。
- **接口与行为契约**：
  - 提供 `npm run web` 启动本地 `http://127.0.0.1:<port>`，直接加载 `workspace/` 中的第 001 号《Magpie · DSH · Super-agent 拆解课》，支持切换 `sanctuary`（花园/园丁）与 `studio`（工作区/向导）两种 Persona 皮肤。
