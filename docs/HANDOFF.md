# Pith · 跨会话交接单（HANDOFF）

Status: pending
Updated: 2026-11-03

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **双环四重身份协同契约（详见 [ROLES.md](ROLES.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/003-interaction.md` 契约后将本文件设为 `Status: pending` 并 `git commit`；
> - **执行环（无人值守 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒，在同一轮次内循环 `wait_agent` 调度常驻 Worker 与独立 Tester 完成实现与 `.dev-vault` 真机验收，通过后更新为 `Status: verified`（附 `Verified-Commit`）并 `git commit` 收口。

## 一、 当前架构与协议基线

1. **三层同心圆架构（`src/core` · `src/plugins` · `src/shells`）**：146 项单测与架构门禁全绿。
2. **交互契约更新（详见 [003-interaction.md](003-interaction.md)）**：基于用户真机体验反馈，已冻结以下四项核心交互纠偏。

---

## 二、 当前待办任务包（Wave 9：阅读翻页模式回归、Obsidian 原生右侧边栏挂载、砍掉“从此句朗读”与听读前置守卫）

### 背景与目标（来自用户真机体验的 4 项明确问题）
1. **阅读翻页模式错误**：当前把整本 EPUB 渲染成可上下滚轮滚动的长条，且默认是 `"scroll"`。按设计规范，**书本阅读场景（EPUB）不应当有上下滚轮滚动模式，只有「单屏翻页」这一个范式，仅区分「单栏（Single Column）」和「双栏（Two-Column）」两种模式**，鼠标滚轮和方向键统一触发翻页（上一屏/下一屏）；只有普通长文（Markdown `article`）才使用滚轮纵向连续滚动。
2. **向导（Agent 助手）未挂载到 Obsidian 原生侧边栏**：当前 `shells/obsidian` 在主阅读视口内部画了一个 `.pith-guide` 右栏，与 Obsidian 自身的原生右侧边栏叠在一起形成“双侧边栏叠罗汉”。如果宿主（如 Obsidian）具备原生侧边栏能力，向导（对话 + 笔记）**必须注册为独立的 Obsidian `ItemView`（`pith-guide`）并挂载到 Obsidian 原生右侧边栏（`workspace.getRightLeaf(false)` / `workspace.rightSplit`）**，主阅读视口只保留纯粹的阅读舞台（参考母本 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/main.ts` 的 `GARDENER_VIEW_TYPE` 实现）。
3. **砍掉“从此句朗读”功能**：当前单击正文任意位置（未选中文本）都会弹出孤零零的 `▶ 从此句朗读` 气泡，体验极差。**彻底移除 `▶ 从此句朗读` 功能与单击弹出逻辑**！框选悬浮条仅在用户真正框选了非空正文文本时弹出，按钮收敛为 `[ 高亮 | 记笔记 | 问向导 | 复制 ]`。
4. **“听读本章”前置正文与语音可用性判断**：当前点击 `🎧` 直接发请求报 `Speech request failed: connect ECONNREFUSED 127.0.0.1:8880`，且未判断当前章节是否有有效正文。需做好前置守卫：① 检查当前章节是否包含有效可读正文段落（`[data-prose="true"]` 过滤后有实质句子）；② 检查 TTS 服务可用性（`checkHealth`）或是否存在衍生音频文件，未配置/不可达时友好提示“请先在设置中连接可用的语音服务”或置灰，严禁直接裸弹 `ECONNREFUSED` 原始网络异常。

### 授权修改范围（Worker · 含 Router 同目标裁决权）
- `src/shells/obsidian/index.ts` & `src/shells/obsidian/plugin.ts`
- `src/shells/web/server.ts`
- `src/plugins/stage-reader/`（如需调整分页/布局辅助函数）
- `scripts/verify-obsidian-e2e.ts`
- `tests/` 下相关单测与集成测试文件

### 具体实现要求
1. **单屏翻页（单栏 / 双栏）vs 长文滚动**：
   - 当阅读材料为书本（`epub` / `pdf` / `cbz`）时，阅读舞台固定处于**单屏翻页模式（`.pith-paged`）**，`[Aa]` 气泡中的版式选项仅提供 **「单栏」** 与 **「双栏」**（移除书本模式下的“流式滚动”选项）：
     - 「单栏」调用 `applyPaginationStyles(reader, article, "single")`（`columns = 1`，单屏按页高分栏，横向按屏翻页）；
     - 「双栏」调用 `applyPaginationStyles(reader, article, "double")`（当窗口几何满足 `canDoubleColumn` 时 `columns = 2`，否则自动降级为 `1`）；
     - 鼠标滚轮（`WheelPageGate`）与方向键（`ArrowLeft/Right/Up/Down`, `PageUp/Down`）在书本模式下统一触发 `turnPage(-1 | 1)` 横向翻一屏，底部或顶栏清晰展示当前页码/总页数（如 `1 / N`）及翻页按钮 `<` `>`。
   - 仅当打开普通 Markdown 长文（`format === "markdown"`）时，才允许纵向连续滚轮滚动（此时不拦截原生纵向滚轮）。
2. **Obsidian 原生右侧边栏挂载（`PithGuideView`）**：
   - 在 `src/shells/obsidian/index.ts` 中注册独立的向导视图 `PITH_GUIDE_VIEW_TYPE = "pith-guide"`；
   - 在 Obsidian 宿主下，主视口 `pith-reader` 内部不再渲染并排的 `.pith-guide` 分栏；点击顶栏向导切换按钮、或框选点击“问向导 / 记笔记”时，通过 `workspace.getRightLeaf(false)` 获取/挂载右侧边栏 `pith-guide` Leaf，并通过 `workspace.rightSplit?.expand()` / `collapse()` 控制展开与收起，实现与 Obsidian 原生右侧边栏无缝融合。
3. **砍掉“从此句朗读”**：
   - 在 `src/shells/obsidian/plugin.ts` 与 `src/shells/web/server.ts` 中彻底删除 `data-selection="speak"` / `data-action="speak"`（`▶ 从此句朗读`）按钮，以及单击正文（`selection.isCollapsed`）时通过 `caretRangeFromPoint` 弹出悬浮条的代码；
   - 框选悬浮条仅在 `mouseup` 存在非空文本选区（`!selection.isCollapsed && selection.toString().trim().length > 0`）时显示，提供 `高亮`、`记笔记`、`问向导`、`复制` 四个操作。
4. **“听读本章”正文判断与友好错误提示**：
   - 判断当前可见页面/章节是否存在有效正文句子（排除纯图片、封面或空块）；若无有效正文，点击 `🎧` 时提示 `"当前页面没有可朗读的正文段落"`；
   - 启动 TTS 伴读前先通过 `speech.tts.checkHealth()` 检查（或捕获连接失败），若本地/云端 TTS 服务未启动或不可达，提示干净的中文指引 `"未连接可用的语音服务，请先启动本地语音服务或在设置中配置云端 TTS"`，绝不向用户裸露 `Speech request failed: connect ECONNREFUSED 127.0.0.1:8880` 英文底层报错。

### 验收标准（Tester）
- `npm run typecheck && npm test && npm run build:obsidian && npm run verify:obsidian` 全部零报错通过；
- `.dev-vault` 真实桌面 Obsidian 客户端（可直接通过 `http://127.0.0.1:9229` CDP 或 `npm run verify:obsidian` 验证并热重载插件）实测确认：
  1. 书本阅读下只有单屏翻页（单栏 / 双栏），无纵向滚动条，滚轮与方向键均按屏翻页；
  2. Obsidian 下向导面板挂载在 Obsidian 原生右侧边栏（Right Split）而非主视口内部；
  3. 单击正文不再弹出“从此句朗读”，框选文本仅显示高亮/记笔记/问向导/复制；
  4. 未启动 TTS 服务时点击 `🎧` 给出干净的中文提示，不再弹 `ECONNREFUSED`；
- 验收通过后，由 Router 将本文件更新为 `Status: verified`（附 `Verified-Commit`）并 `git commit` 收口。
