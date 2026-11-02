# Pith · 三路并行独立 Agent 开发交接单（HANDOFF · Track 1 / Track 2 / Track 3）

> **仓库路径**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **必读契约**：[`AGENTS.md`](../AGENTS.md) · [`docs/002-architecture.md`](002-architecture.md) · [`docs/003-interaction.md`](003-interaction.md) · [`src/core/seams.ts`](../src/core/seams.ts)
> **并行隔离铁律**：以下 **3 个任务包（Track 1 / Track 2 / Track 3）的修改文件集 100% 物理正交，零交集**！每个 Agent **严禁触碰自己 Write Scope 之外的任何文件**，确保三人可同时开发、互不冲突。

---

## 📦 Track 1（Agent 1 负责）：本机 Agent 扫描发现与 ACP 会话复用（零 Magpie 依赖！）

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/plugins/guide-acp/index.ts`
- 新增 `src/plugins/guide-acp/discovery.ts`（扫描本机已安装的 Agent CLI 与 ACP 能力探测）
- 新增 `src/plugins/guide-acp/acpSession.ts`（ACP JSON-RPC 会话桥与沙箱只读隔离）
- 新增 `tests/track1-guide-providers.test.ts`
- *(严禁修改 `src/core/*`、`src/plugins/stage-*`、`src/plugins/speech-*`、`src/shells/*` 或现有其他测试文件！)*

### 2. 核心设计纠偏与参考遗产
**严禁假设用户安装了 Magpie 网关！Pith 与 Magpie 互不依赖。**
我们要向 [`infra/magpie/internal/agent/`](/Users/zejiawu/Projects/Project-Atlas/infra/magpie/internal/agent/)、[`labs/obsidian_labs/packages/obsidian-agent-runtime`](/Users/zejiawu/Projects/Project-Atlas/labs/obsidian_labs/packages/obsidian-agent-runtime) 及 [`labs/ganfan-garden/src/gardener/`](/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/gardener/) 学习的，是**「自动扫描并复用用户电脑上已安装的本地 Agent CLI（Claude Code / Codex / DSH）」**：
1. **本机 Agent 自动扫描器（`discoverLocalAgents` in `src/plugins/guide-acp/discovery.ts`）**：
   - 扫描标准 PATH 与常见 CLI 路径（如 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`、`~/.nvm/versions/node/*/bin` 等，支持传入自定义 `searchPaths` 与 `probeRunner` 以便单测验证），探测本机已安装的 Agent：
     - **DSH (`dsh`)**：探测 `dsh --version` 与 `dsh --profile acp --help`；
     - **Claude Code (`claude` / `claude-agent-acp`)**：探测 `claude-agent-acp --version` 或本机 `claude` CLI；
     - **Codex (`codex` / `codex-acp`)**：探测 `codex-acp --version` 或本机 `codex` CLI；
   - 返回结构化的 `DiscoveredAgentDescriptor[]`（`id: "dsh" | "claude" | "codex"`, `label`, `command`, `args`, `version`, `available: boolean`, `note?: string`），带 30 秒缓存 TTL（参考 `ganfan-garden/src/gardener/GardenerService.ts:120-150`）。
2. **本机 Agent 会话执行与安全隔离（`LocalAcpGuideProvider` in `src/plugins/guide-acp/acpSession.ts`）**：
   - 提纯复用 `obsidian-agent-runtime` 与 `ganfan-garden/src/gardener/GardenerService.ts` 的核心机制：
     - 通过 JSON-RPC 2.0 over stdio（或注入的 `AcpTransport` 替身）与选中的本机 Agent 建立会话（`initialize` -> `session/new` -> `session/prompt` -> `session/cancel` -> `session/close`）；
     - **安全铁律**：向导进程以 `read-only` 权限运行（对于 DSH 自动注入 `DSH_PERMISSION_MODE: "read-only"`，macOS 下支持 `sandbox-exec` 屏蔽对工作区原始材料的直接写入，所有笔记与讲义写入只走受控工具或宿主回调）；
     - 调用 `buildScenePrompt()` 组装融合 `ME.md`、`Topic`、最近笔记与 `SelectionAnchor` 的完整上下文，流式/完整接收回复并解析尾部 ````pith-choices` 胶囊；支持超时与 `AbortSignal` 取消。
3. **挂载到 `guide-acp` 插件与 `AttentionEngine`**：
   - 在 `guide-acp` 插件 `settings` 中配置 `agentId`（`"" | "dsh" | "claude" | "codex"`，默认 `""`）、`model`、`effort`、`timeoutMs`；
   - 在 `guide.agent` 服务上暴露 `detectAgents(force?: boolean)` 方法供 UI 设置页一键扫描本机可用 Agent；
   - 当配置了有效的本机 Agent（或注入了 `guide.provider`）时，自动注册 `AttentionEngine` 的 `prepare-next-action` 后台 `Effects` 处理器！
4. **测试要求（`tests/track1-guide-providers.test.ts`）**：
   - 使用可控的 fake CLI / stdio JSON-RPC fixture 测试：本机 Agent 扫描发现（识别 `dsh` / `claude-agent-acp` / `codex-acp` 及未安装时的明确 `note` 诊断）、ACP JSON-RPC 握手与 `session/prompt` 问答、超时/取消回收、DSH `read-only` 环境变量隔离、以及驱动 `AttentionEngine.processDueEffects()` 自动更新 `topic.nextAction`。

---

## 📦 Track 2（Agent 2 负责）：阅读与伴读内核大升级（只读正文伴读 + 起读定位 + EPUB 提纯迁移）

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/plugins/stage-reader/index.ts`
- 新增 `src/plugins/stage-reader/epub.ts`（从 `ganfan-garden/src/material/ingest/epub.ts` & `zip.ts` 提纯零依赖 EPUB 解析与章节提取）
- `src/plugins/speech-service/index.ts`
- 新增 `tests/track2-reader-speech.test.ts`
- *(严禁修改 `src/core/*`、`src/plugins/guide-acp/*`、`src/shells/*` 或现有其他测试文件！)*

### 2. 实现目标（严格对齐 [`docs/003-interaction.md`](003-interaction.md)）
1. **智能识别「正文段落（Prose Blocks）」vs「非正文（代码块/表格/公式/装饰行）」**：
   - 在 `stage-reader` 中实现 `extractProseBlocks(markdown): readonly ProseBlock[]`（符合 [`src/core/seams.ts`](../src/core/seams.ts) 契约）：
     - 自动将代码块（````...````）、YAML Frontmatter、分隔线、纯表格线标记为 `isProse: false`；
     - 将自然语言段落、标题、列表项、引用块标记为 `isProse: true`，并在 `render(markdown)` 生成的 HTML 节点上输出 `data-locator="text:line:<n>"` 与 `data-prose="true|false"` 属性！
2. **篇幅级连续正文伴读 +「从任意选中句起读」游标引擎（`speech-service`）**：
   - 实现 `filterProseOnly(blocks): readonly SpeechSentenceSegment[]`：只提取 `isProse === true` 的段落切分为带 `locator` 与 `blockIndex` 的连续句子队列，**彻底杜绝傻乎乎朗读代码块和表格符号**；
   - 新增 `createReadAloudSession(blocks, startLocator?)`：
     - 默认从当前文章开头连续朗读整篇正文；
     - 当传入用户鼠标选中的 `startLocator`（或句子文本匹配）时：若目标属于 `isProse: false`（非正文），立即返回 `{ started: false, reason: "not-prose", tip: "此处非正文段落，无法伴读" }`（供前端展示 2 秒自动褪去的小 Tip）；若属于正文，则精准从该句起连续往后朗读全文，并提供 `current()`、`next()`、`previous()` 与句级高亮 `locator` 回调！
3. **EPUB 零依赖解析提纯（`src/plugins/stage-reader/epub.ts` & `renderFile`）**：
   - 从 `ganfan-garden/src/material/ingest/zip.ts` 与 `epub.ts` 提纯零外部依赖的 ZIP/Deflate 解压与 OPF/NCX/Nav 目录提取，实现 `StageReaderService.renderFile(file, bytes)`，使 `stage-reader` 既能渲染 `.md` 也能直接解析 `.epub` 章节与目录树。
4. **测试要求（`tests/track2-reader-speech.test.ts`）**：
   - 验证含代码块/表格的 Markdown 经 `extractProseBlocks` 与 `filterProseOnly` 后，100% 跳过代码块只读正文；
   - 验证从中间某句正文起读、以及点击代码块触发 `"not-prose"` Tip 拒绝；
   - 验证合成最小 `.epub` 二进制包的目录与章节正文提取。

---

## 📦 Track 3（Agent 3 负责）：7 大空间与视觉重构 + Obsidian 原生系统风格统一（[`docs/003-interaction.md`](003-interaction.md) 落地）

### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/shells/obsidian/index.ts`
- 新增 `src/shells/obsidian/plugin.ts`（Obsidian 视图控制器、左侧目录抽屉、底部悬浮 Dojo Dock、右侧可完全收起图标栏、Readest 滚轮/方向键翻页、以及遵循 Obsidian 系统变量的 `styles.css` 生成器）
- `src/shells/web/server.ts`（同步升级独立 Web 壳的 UI 布局与 CSS 变量体系，100% 对齐 `003-interaction.md`）
- 新增 `tests/track3-spatial-ui-and-obsidian.test.ts`
- *(严禁修改 `src/core/*`、`src/plugins/*` 或现有其他测试文件！)*

### 2. 实现目标（复用 `ganfan-garden/styles.css` 成熟系统跟随方案，彻底根治 7 大体验缺陷）
严格按照 [`docs/003-interaction.md`](003-interaction.md) 与 [`ganfan-garden/styles.css:60-89`](/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/styles.css#L60-L89) 重构 `shells/obsidian` 与 `shells/web`：
1. **视觉 100% 紧跟 Obsidian 系统主题（消灭“左边白底、右边黄纸”的割裂丑态）**：
   - 严禁在主画布、工具栏或右侧向导栏硬编码死 `#f3ede1` 暖黄纸色！
   - 所有界面表面、文字、边框与强调色统一使用宿主 CSS 变量（`var(--background-primary)`、`var(--background-secondary)`、`var(--background-modifier-border)`、`var(--text-normal)`、`var(--text-muted)`、`var(--text-faint)`、`var(--text-accent)`、`var(--font-interface)`），使插件在 Obsidian 浅色/暗色主题下与原生界面浑然一体（独立 Web 壳在 `:root` 中定义这套同名变量的干净中性默认值，不再强刷复古黄纸背景）。
2. **左上角按钮 `[☰]` + 左侧滑出导航抽屉（Left Navigation Drawer）**：
   - 彻底移除正文上方的多文件水平 Tab 条与 Markdown 正文头部的内嵌 TOC 链接墙（正文第一行直接是标题！）；
   - 点击左上角 `[☰]` 按钮从**左侧**弹出抽屉（`.pith-left-drawer`），抽屉内统一承载「当前课题材料文件列表 + 当前文件章节目录树（TOC）」，点击章节或文件后跳转并自动收起抽屉。
3. **底部悬浮感应 Dojo Dock（Bottom Floating Dock）**：
   - 彻底移除正文左上方的 `[分句伴读]`、`[挂载跟读]` 按钮；
   - 改为舞台正下方的悬浮胶囊条（`.pith-bottom-dock`）：平时静止阅读时半透明弱化隐去（`opacity: 0.15`，鼠标移近底部或伴读/实训激活时 `opacity: 1` 平滑浮出），内含 `[ 🎧 伴读全文 ]` 与 `[ 🗣️ 4 阶跟读工坊 ]`。
4. **朗读微反应 + 框选“从此句朗读” + 2 秒自动褪去非正文 Tip**：
   - 朗读时当前正在朗读的正文句子呈现温和的呼吸底色/下划线微反应（`.pith-speech-active`）；
   - 框选文字弹出的悬浮条增加 `[ ▶ 从此句朗读 ]`；若用户在代码块或非正文区域触发朗读，浮出 `.pith-toast-tip`（*“此处非正文段落，无法伴读”*），2 秒后自动淡出消失，**全仓 UI 严禁使用 `alert()` 弹窗**！
5. **Readest 级翻页手势统一**：
   - 监听 `wheel`（带冷却防抖）与 `keydown`（`ArrowUp / ArrowDown / ArrowLeft / ArrowRight / PageUp / PageDown`），统一承担上一屏/下一屏翻页职责。
6. **右上角纯图标开关关闭向导栏 + 主舞台 100% 自适应撑满**：
   - 右上角侧栏开关去掉“向导/园丁”文字，改用极简侧栏 SVG/图标按钮（带 `aria-label` 与 `title`）；
   - 点击关闭（或当用户在插件设置中关闭 `guide-acp` 插件）时，右侧区域彻底隐藏占 0 像素，中间主视觉阅读区自动平滑居中撑满全宽。
7. **测试要求（`tests/track3-spatial-ui-and-obsidian.test.ts`）**：
   - 验证更新后的 HTML/CSS 契约：全部基于 `var(--background-primary)` / `var(--text-normal)` 等宿主变量、包含左侧抽屉 `.pith-left-drawer`、底部悬浮 `.pith-bottom-dock`、纯图标侧栏开关、非正文 `.pith-toast-tip`（全仓 UI 零 `alert(` 调用！）、正文内不再渲染内嵌 `<div class="toc">` 链接墙；
   - 验证 `shells/obsidian` 控制器完整支持翻页手势（滚轮与上下左右键一致）、左侧抽屉开关、右侧 Guide 彻底关闭自适应与伴读起读状态管理。

---

## 三、 每个 Agent 交付前必跑的自检命令

```bash
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm run typecheck
PATH="/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/node_modules/.bin:$PATH" npm test
git status -s
```
