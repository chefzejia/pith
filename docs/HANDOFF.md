# Pith · Wave 3 并行独立 Agent 开发交接单（HANDOFF · Track 1 / Track 2 / Track 3）

> **仓库路径**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **必读契约**：[`AGENTS.md`](../AGENTS.md) · [`docs/002-architecture.md`](002-architecture.md) · [`docs/003-interaction.md`](003-interaction.md) · [`src/core/seams.ts`](../src/core/seams.ts)
> **并行隔离铁律**：以下 **3 个任务包（Track 1 / Track 2 / Track 3）的修改文件集 100% 物理正交，零交集**！每个 Agent **严禁触碰自己 Write Scope 之外的任何文件**（尤其严禁修改 `src/core/**` 和现有旧测试文件），确保三人同时开发零冲突。

---

## 📦 Wave 3 · Track 1（Agent 1 负责）：阅读舞台全版式升级（Readest 多栏分页 + CBZ/图片漫画与 PDF 固定页解析）

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/plugins/stage-reader/index.ts`
- `src/plugins/stage-reader/epub.ts`（如需复用其中的 ZIP 读取函数，可 export `readZipEntries`）
- 新增 `src/plugins/stage-reader/pagination.ts`（Readest 级 CSS 多栏分页几何计算与 DOM 应用器）
- 新增 `src/plugins/stage-reader/fixedPage.ts`（CBZ 漫画压缩包、单张图片与轻量 PDF 固定版式解析器）
- 新增 `tests/wave3-track1-reader-formats.test.ts`
- *(严禁修改 `src/core/**`、`src/plugins/guide-acp/**`、`src/shells/**` 或其他现有测试文件！严禁在 `src/plugins/**` 中 import `node:*`！)*

### 2. 核心设计目标（对齐 [`src/core/seams.ts`](../src/core/seams.ts) 已定型签名，参考 `ganfan-garden/src/material/render/pagination.ts` & `adapters/cbz.ts` & `adapters/pdf.ts`）

1. **Readest 级 CSS 多栏分页几何计算器（`src/plugins/stage-reader/pagination.ts` & `StageReaderService.computePagination`）**：
   - 实现纯函数 `computePagination(viewportWidth, viewportHeight, scrollWidth, mode = "auto"): PaginationMetrics`：
     - 当 `mode === "double"` 或（`mode === "auto"` 且 `viewportWidth >= 900`）时，`columns = 2`，否则 `columns = 1`；
     - 计算 `horizontalInsetPx = Math.min(48, Math.max(16, viewportWidth * 0.05), viewportWidth / (columns * 4))`；
     - 计算 `verticalInsetPx = Math.min(32, Math.max(12, viewportHeight * 0.05))`；
     - 计算 `columnWidthPx = Math.max(1, viewportWidth / columns - 2 * horizontalInsetPx)`、`columnGapPx = 2 * horizontalInsetPx`、`contentHeightPx = Math.max(1, viewportHeight - 2 * verticalInsetPx)`；
     - 计算总屏数 `totalScreens = Math.max(1, Math.ceil(( Math.max(viewportWidth, scrollWidth) - 1 ) / Math.max(1, viewportWidth)))`。
   - 导出辅助函数 `applyPaginationStyles(viewport: HTMLElement, body: HTMLElement, mode?: "auto" | "single" | "double"): PaginationMetrics`：将计算出的多栏 CSS 变量与宽高写入 DOM 节点。

2. **固定版式解析器：CBZ 漫画包、图片与 PDF（`src/plugins/stage-reader/fixedPage.ts` & `renderFile` 扩展）**：
   - **CBZ 漫画包解析（`renderCbz(file, bytes)`）**：
     - 复用 `stage-reader/epub.ts` 的零依赖 ZIP 解压能力，提取所有图片条目（`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`），忽略目录与非图片文件，按自然序（Natural Sort：`page-2.png < page-10.png`）排序；
     - 生成 `FixedPageEntry[]`（`page: 1..N`, `label: "第 N 页"`, `mimeType`, `bytes`），并将每页渲染为 `<figure class="pith-fixed-page" data-locator="page:${page}" data-prose="false"><img alt="第 ${page} 页" data-page="${page}"></figure>`，返回 `RenderedDocumentView`（`format: "cbz"`, `layout: "fixed-page"`, `pages`, `sections` 每页一条目录项，`totalUnits: pages.length`）；若 ZIP 中无图片则抛明确错误。
   - **单张图片与 PDF 解析（`renderImage(file, bytes)` & `renderPdf(file, bytes)`）**：
     - 对 `.png/.jpg/.jpeg/.webp/.gif` 返回单页 `format: "image"`, `layout: "fixed-page"`；
     - 对 `.pdf`（`application/pdf`）：实现零外部依赖的轻量 PDF 页面与文本流扫描器（扫描 `/Type /Page\b` 统计页数，提取括号文本流 `( ... )` 或 `BT ... ET` 中的可读文本行构建每页 `FixedPageEntry` 与 `ProseBlock`），返回 `format: "pdf"`, `layout: "fixed-page"`，使 PDF 无需重型 Canvas 也能在内核中提取目录、页码 `page:1..N` 与可伴读文本。
   - 更新 `StageReaderService.formats` 为 `["epub", "pdf", "markdown", "cbz", "image"]`，并在 `stage-reader/index.ts` 中暴露 `computePagination` 与扩展后的 `renderFile`。

3. **测试要求（`tests/wave3-track1-reader-formats.test.ts`）**：
   - 验证 `computePagination` 在窄屏（单栏）、宽屏（双栏 `>= 900px`）及强制 `single/double` 模式下的几何精度与总屏数计算；
   - 验证合成 `.cbz` 压缩包的自然排序（`page2.png` 排在 `page10.png` 前）、目录生成与空包报错；
   - 验证最小合成 `.pdf` 二进制字节流的页数识别、页级 `page:1` 定位符生成与文本提取。

---

## 📦 Wave 3 · Track 2（Agent 2 负责）：向导受控工作区工具箱 + 毕业门控（Settlement Gate）+ 会话内工具自动执行

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/plugins/guide-acp/index.ts`
- `src/plugins/guide-acp/acpSession.ts`
- 新增 `src/plugins/guide-acp/tools.ts`（向导受控工作区工具箱与权限门控）
- `src/shells/dsh/index.ts`
- 新增 `tests/wave3-track2-guide-tools.test.ts`
- *(严禁修改 `src/core/**`、`src/plugins/stage-*`、`src/shells/web/**`、`src/shells/obsidian/**` 或其他现有测试文件！严禁在 `src/plugins/**` 中 import `node:*`！)*

### 2. 核心设计目标（参考 `ganfan-garden/src/gardener/tools.ts` & `GardenerService.ts:354-379`）

1. **提纯向导受控工作区工具箱（`src/plugins/guide-acp/tools.ts` & `GuideAgentService.listWorkspaceTools`）**：
   - 创建 `createGuideWorkspaceTools(store: WorkspaceStore, engine: AttentionEngine): readonly GuideMcpToolSpec[]`，提供 6 个受控工具（所有写入只走 `WorkspaceStore` / `AttentionEngine`）：
     1. `pith_get_context`：读取学习者画像 `ME.md`、罗盘状态与指定课题详情；
     2. `pith_read_material_section`：按 `materialId` + `file` 读取材料文件内容（支持按 `locator` 如 `text:line:<n>` 截取附近段落，绝不一次性塞爆上下文）；
     3. `pith_save_note`：为课题保存一条 `note` / `highlight` / `practice` 笔记（可带 `guideRemark` 点评与 `anchor`）；
     4. `pith_write_lesson`：调用 `store.writeGeneratedFile(materialId, fileName, markdown)` 为当前课题生成定制导读讲义（严格保持原始导入材料只读）；
     5. `pith_configure_toolkits`：动态为课题挂载或卸载 `toolkits`（如 `["shadowing"]`）；
     6. `pith_settle_topic`：**毕业门控（Settlement Gate）**——将课题状态从 `"exploring"` 沉淀为 `"settled"`，但**强制校验**：目标课题必须至少有 1 条学习者笔记（`topic.notes.length > 0`）且传入非空的 `verificationSummary`（记录学习者通过深水区检验的回答摘要，并自动追加为一条总结笔记后才将 `status` 更新为 `"settled"`；若无笔记或未提供检验摘要则拒绝毕业并抛错）。

2. **会话内受控工具指令执行与权限门控（`src/plugins/guide-acp/acpSession.ts`）**：
   - 实现 `createGuidePermissionGate(allowedToolNames: readonly string[])`：仅当 ACP `tool-call` 属于已注册的受控 `pith_*` 工具时返回 `"allow_once"`，任何试图直接写磁盘或执行未知工具的请求一律返回 `"reject_once"`；
   - 在 `LocalAcpGuideProvider.reply()`（及 `guide-acp/index.ts`）中：支持识别并执行 Agent 回复中的受控工具调用块（例如 ````pith-tool\n{"name":"pith_write_lesson","arguments":{...}}\n```` 或 `pith-toolkits`），自动在 `WorkspaceStore` 上安全执行工具并将结果落盘。

3. **同步升级 `src/shells/dsh/index.ts`**：
   - 将新增的 `pith_read_material_section` 与带毕业门控校验的 `pith_settle_topic` 同步暴露到 `createDshPluginBundle()` 中。

4. **测试要求（`tests/wave3-track2-guide-tools.test.ts`）**：
   - 验证 6 个受控工具（特别是 `pith_read_material_section` 局部读取、`pith_write_lesson` 写定制讲义、以及 `pith_settle_topic` 毕业门控在无笔记时拒绝、有笔记+检验摘要时成功沉淀课题）；
   - 验证 `createGuidePermissionGate` 只放行白名单内的 `pith_*` 工具并拒绝越权工具；
   - 验证 `LocalAcpGuideProvider` 在回复中携带 `pith-tool` 指令块时自动安全执行对应工作区写入。

---

## 📦 Wave 3 · Track 3（Agent 3 负责）：Obsidian 一键生产构建链路（`main.js` + `manifest.json` + `styles.css`）+ 双壳阅读舞台联调

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `package.json`（新增 `"build:obsidian"` 脚本）
- 新增 `manifest.json`（Obsidian 插件标准清单，id 为 `"pith"`）
- 新增 `scripts/build-obsidian.mjs`（调用 `../ganfan-garden/node_modules/esbuild` 一键打包生成 Obsidian 插件 `dist/obsidian/{main.js,manifest.json,styles.css}`）
- `src/shells/obsidian/index.ts`
- `src/shells/obsidian/plugin.ts`
- `src/shells/web/server.ts`
- 新增 `tests/wave3-track3-obsidian-build.test.ts`
- *(严禁修改 `src/core/**`、`src/plugins/**`、`src/shells/dsh/**` 或其他现有测试文件！)*

### 2. 核心设计目标（让 Pith 真正具备拖进 Obsidian 即装即用的生产产物，并与 Web 壳 100% 同步）

1. **Obsidian 标准插件清单与一键打包脚本（`manifest.json` & `scripts/build-obsidian.mjs` & `package.json`）**：
   - 在仓库根目录创建标准 `manifest.json`（`id: "pith"`, `name: "Pith"`, `version: "0.1.0"`, `minAppVersion: "1.5.0"`, `description: "Agents automate your output. Pith grows your core."`, `isDesktopOnly: true`）；
   - 编写 `scripts/build-obsidian.mjs`：通过直接导入 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/esbuild/lib/main.js`（或 `createRequire` 解析 `../ganfan-garden/node_modules/esbuild`），将 `src/shells/obsidian/index.ts` 打包为 CommonJS 格式的 `dist/obsidian/main.js`（external `["obsidian", "electron", ...builtinModules]`），同时自动把 `obsidianStyles` 写出为 `dist/obsidian/styles.css`、复制 `manifest.json` 到 `dist/obsidian/manifest.json`；
   - 在 `package.json` 的 `scripts` 中增加 `"build:obsidian": "node scripts/build-obsidian.mjs"`（保持 `dependencies` 为空，零运行时第三方依赖污染）。

2. **增强 `src/shells/obsidian/` 与 `src/shells/web/server.ts` 的阅读舞台与教学块样式呈现**：
   - 在 `obsidianStyles`（`src/shells/obsidian/plugin.ts`）与 Web 壳样式（`src/shells/web/server.ts`）中：
     - 补齐内嵌教学块 `.pith-teaching-block` 与固定页 `.pith-fixed-page` 的原生主题自适应样式（使用 `var(--background-secondary)`、`var(--background-modifier-border)`、`var(--text-accent)`，零硬编码暖黄纸色）；
     - 在 `src/shells/obsidian/index.ts` 中导出默认的 Obsidian 插件入口类 `PithObsidianPlugin`（兼容 Obsidian `Plugin` 生命周期 `onload` / `onunload`，自动注入 `NodeAgentProcessPort` 以支持本机 Agent 扫描与 ACP 会话）。

3. **测试要求（`tests/wave3-track3-obsidian-build.test.ts`）**：
   - 端到端运行 `buildObsidianBundle()`（或执行 `scripts/build-obsidian.mjs`），断言 `dist/obsidian/main.js`、`dist/obsidian/manifest.json`、`dist/obsidian/styles.css` 全部成功生成且非空；
   - 验证生成的 `styles.css` 遵循宿主 CSS 变量规范且包含 `.pith-teaching-block`、`.pith-left-drawer`、`.pith-bottom-dock`；
   - 验证 `PithObsidianPlugin` 的 `onload()` / `onunload()` 生命周期与控制器联动正常。

---

## 三、 每个 Agent 交付前必跑的自检命令

```bash
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm run typecheck
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm test
git status -s
```
