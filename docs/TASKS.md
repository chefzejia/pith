# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；**每完成一单必须在进入下一单前立即将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #25] 课题看板（Topic Board）视觉打磨、时间轴 `.pith-cue` 时间戳原位保留与右上角轻菜单收口

- **Status**: verified
- **Scope**: `src/workbench/**`, `src/plugins/stage-timeline/**`, `tests/**`
- **Verified-Commit**: 2daebd8
- **Updated**: 2026-11-07
- **验收摘要**：Worker 通过类型检查、全仓测试（218 通过、44 跳过）、构建与手动破壁；Tester 在 Web 与隔离 Obsidian 复验看板、悬停对比、设置入口、工具菜单及字幕时间戳，截图归档于 `.tmp/evidence/task-25/`。

---

## [Task #Audit] 修复 `tests/task23-shared-web-browser.test.ts` 无硬件麦克风环境下的 `getUserMedia` 假阴性超时

- **Status**: verified
- **Scope**: `tests/task23-shared-web-browser.test.ts`
- **Verified-Commit**: ce4727a69791a97c9983663deefc0c3e6f2e1978
- **Updated**: 2026-11-07
- **验收摘要**：指定 Chromium 测试实际运行通过；Worker 完成全仓检查与转写断言破壁，Tester 独立观察合成录音、受控转写回填及音轨释放。证据见 `.tmp/evidence/task-Audit/`。

---

## [Task #26] 设置面板重构（Agent 右侧对齐与单键刷新、云端语音平铺显隐、本机语音单主按钮与安装修复）

- **Status**: pending
- **Scope**: `src/shells/obsidian/**`, `src/shells/web/**`, `src/shells/speech/**`, `src/workbench/**`, `scripts/**`, `tests/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-08
- **授权范围**：允许修改 `src/shells/obsidian/index.ts`、`src/shells/web/client.ts`、`src/shells/web/server.ts`、`src/shells/speech/speechRuntime.ts`、`src/workbench/**`、`scripts/build-obsidian.mjs` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/` 冻结契约；严禁在 `src/plugins/` 或 `src/workbench/` 中引入宿主包。
- **背景与参考代码**：执行环在开工前请主动阅读 `src/shells/obsidian/index.ts`（`PithSettingTab.display`、`createObsidianHostPort`）、`src/shells/web/client.ts`（`openSimpleSettings`）、`src/shells/speech/speechRuntime.ts`（`NodeManagedSpeechRuntime`），以及母本仓库 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/settings.ts` 中关于设置行右侧控件组布局的细节。
- **接口与行为契约**：
  1. **「本机 Agent」行右侧对齐与轻量刷新图标按钮（`src/shells/obsidian/index.ts` & `src/shells/web/client.ts`）**：
     - 修复 `PithSettingTab` 中 `row(root, "本机 Agent", ...)` 把 `<select>` 和 `重新检测` 按钮直接塞进三元 `justify-content: space-between` 容器导致 `<select>` 卡在中间的问题：每行右侧统一使用 `.pith-setting-control`（`display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px`）包裹右侧控件，使 Agent 下拉框与刷新按钮紧凑靠右对齐；
     - 将笨重的文字按钮 `重新检测` 替换为紧凑的轻量刷新按钮（`↻`，`aria-label="刷新本机 Agent"`，`title="刷新本机 Agent"`，检测中禁用并显示旋转或状态提示），在 Obsidian 设置页与 Web 设置抽屉保持一致。
  2. **「语音服务模式」切换时严格显隐对应参数，云端模式直接平铺展开且「检测连接」置于底部（`src/shells/obsidian/index.ts` & `src/shells/web/client.ts`）**：
     - 当 `语音服务模式` 选择 **`本机语音服务`** 时：**100% 隐藏**所有云端配置项（`API Key`、`TTS 端点 URL`、`TTS 模型`、`音色`、`ASR 端点 URL`、`ASR 模型` 以及 `检测连接` 按钮），仅显示本机语音引擎区；
     - 当 `语音服务模式` 选择 **`云端语音服务`** 时：**100% 隐藏**本机语音引擎区，**直接平铺展开**所有云端配置行（`API Key`、`TTS 端点 URL`、`TTS 模型`、`音色`、`ASR 端点 URL`、`ASR 模型`），**彻底移除 `<details><summary>高级自定义端点与模型（可选）</summary>` 折叠包裹与“（可选）”字样**，并将 **`[检测连接]`** 按钮放在所有云端参数行的**最底部**。
  3. **「本机语音引擎」状态表达精简与单主按钮交互重构（废除四个并排按钮）**：
     - **简洁状态行**：第一栏作为标准设置行展示标签 `本机语音引擎`（副文案简洁说明内置模型如 `Kokoro 中英 TTS · SenseVoice 多语种 ASR`），状态徽标仅简洁显示当前状态：**`未安装`**、**`安装中…`**、**`已就绪（按需自动启动）`**、**`运行中`** 或 **`安装异常`**（同步调整 `NodeManagedSpeechRuntime.getState()` 或视图层状态映射，避免冗长拼接）；
     - **废除 `安装/启用 + 启动/检测 + 释放 + 卸载` 四按钮并排**：本机语音守护进程本来就是按需自动拉起、空闲自动释放的，无需让用户手动管理进程启停！按状态仅渲染清晰的操作入口：
       - `not-installed` / `failed`：仅显示 1 个主按钮 **`[安装引擎]`**（`failed` 时显示 **`[重新安装]`**）；
       - 安装进行中：按钮置为 `disabled` 并显示实时阶段文案 **`正在安装…`**；
       - `stopped` / `running`（已安装）：主操作显示 **`[检测语音]`**（调用 `ensureRunning` 验证可用性），右侧辅以次级/弱化按钮 **`[卸载]`**（调用 `remove`）。
  4. **修复 Obsidian 中点击安装本机语音引擎完全无反应的重大 Bug（`src/shells/obsidian/index.ts` & `src/shells/speech/speechRuntime.ts`）**：
     - **根因 1**：在 `src/shells/obsidian/index.ts:156` 的 `createObsidianHostPort` 中，`const speechRuntime = processPort && vault.getFullPath ? new NodeManagedSpeechRuntime({ protectedRoot: vault.getFullPath("") }) : undefined;`——当 Obsidian 的 `vault.adapter` 方法签名或原型链判断不满足条件，或 `vault.getFullPath` 未绑定时，`speechRuntime` 直接变成了 `undefined`（或异常未被正确捕获展示）；即使未拿到 `vault.getFullPath`，也应安全初始化 `new NodeManagedSpeechRuntime(vault.getFullPath ? { protectedRoot: vault.getFullPath("") } : {})`；
     - **根因 2**：点击安装后，`PithSettingTab` / `openSimpleSettings` 与 `NodeManagedSpeechRuntime.install` 必须立即更新 UI 状态并透传进度/错误（若本机已有缓存归档或下载中，提供明确的状态反馈与错误提示，绝不能静默无反应），完成后立即刷新按钮状态为已安装态。
  5. **构建脚本同步增强（`scripts/build-obsidian.mjs`）**：
     - `npm run build:obsidian` 除同步 `.dev-vault/.obsidian/plugins/pith/` 外，若检测到用户本机 Vault 插件目录 `/Users/zejiawu/Library/Mobile Documents/iCloud~md~obsidian/Documents/ganfan-media/.obsidian/plugins/pith` 已存在，一并自动同步 `main.js`、`styles.css`、`manifest.json`，确保用户在真实 Obsidian 中无需手动拷文件即可看到最新构建。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；更新设置面板单测与浏览器回归测试覆盖：Agent 右侧对齐与 `↻` 刷新按钮、本机/云端模式互斥显隐、云端无 `<details>` 平铺且 `检测连接` 位于最底部、本机语音按状态渲染单主按钮（不再渲染 4 个按钮）及点击安装的状态流转；完成手动破壁验证并截屏存入 `.tmp/evidence/task-26/` 自检。
- **Tester 模拟用户终验要求**：在 Web 与真实 Obsidian 中打开设置页，截屏验证本机模式与云端模式的显隐切换、Agent 右侧刷新图标、本机语音引擎简洁状态与安装响应，截图归档至 `.tmp/evidence/task-26/`。

---

## [Task #27] 阅读舞台键盘翻页焦点自动接管 & EPUB 深色模式字色可读性修复（对齐 `ganfan-garden` 渲染演进）

- **Status**: pending
- **Scope**: `src/workbench/**`, `src/plugins/stage-reader/**`, `tests/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-08
- **授权范围**：允许修改 `src/workbench/view.ts`、`src/plugins/stage-reader/epub.ts`、`src/plugins/stage-reader/epubResources.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/` 冻结契约。
- **背景与参考代码**：执行环在开工前请主动阅读 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden` 中经过多轮迭代的成熟实现：
  - 深色模式下 EPUB 内联/样式表字色与背景对比度保护：`/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/material/render/css.ts`（`backgroundContrastForeground`、`extractInlineColorCascade`、`sanitizeDeclarations`）、`src/material/render/adapters/epubStyles.ts`（`rewriteEpubInlineFontStyles`）以及测试 `tests/epub-color-browser.test.cjs`、`tests/epub-color-cascade-browser.test.cjs`；
  - 阅读器键盘翻页事件与焦点处理：`src/workbench/view.ts`（`render`、`keydown` 监听）。
- **接口与行为契约**：
  1. **从看板首页点击进入书本后，无需再次点击正文即可直接按方向键左右翻页（`src/workbench/view.ts`）**：
     - **根因**：当前 `view.ts:261` 的 `keydown` 监听绑定在 `root` 上，且判断 `!target || typeof target.closest !== "function"`；当用户从课题看板点击卡片进入书籍时，原本被点击的看板 `<button>` 被销毁，焦点回落到 `document.body`（不在 `root` 内），导致用户按 `ArrowRight / ArrowLeft / PageDown / PageUp` 时事件根本未命中 `root`！
     - **修复要求**：
       1. 在 `PithWorkbenchView.render()` 完成书籍/文档渲染后（当文档不在输入框焦点中时），自动调用 `this.reader.focus({ preventScroll: true })` 将焦点移入阅读容器；
       2. 同时将分页键盘快捷键监听挂在 `this.doc`（`document`）级别（当 `this.root.isConnected`、当前焦点不在 `input, textarea, select, button, [contenteditable=true], .pith-guide, .pith-left-drawer` 且无修饰键时响应方向键/翻页键），确保用户进入书本后第一时间按左右方向键即可顺滑翻页。
  2. **EPUB 深色模式字色与背景对比度自适应，解决暗底深紫/深蓝/黑字无法阅读问题（`src/plugins/stage-reader/epub.ts` & `epubResources.ts` & `src/workbench/view.ts`）**：
     - **根因（以用户实测《女人的性爱动机》EPUB 为例）**：原书 `Style0001.css` 含有大量专为浅色纸面或特定底色编写的硬编码深色字（如 `h4 { color: #5500af }`、`.text1 { color: #004080 }`、`.text { color: #003000 }`、`a { color: #808080 }`、`color: black / #2b271e / #000066`），以及部分章节 `body class="bjqs"` 设了浅黄底色 `#efaf43` 但在 `epub.ts:431` 中被拼在同一个 `<section class="pith-epub-chapter ... bjqs">` 上（而 `sanitizeStylesheet` 把 `.bjqs` 重写成了后代选择器 `.pith-epub-chapter-1 .bjqs`，导致挂在章节根节点上的 `class="bjqs"` 无法命中自身！而且章节 `body` 背景或无背景下的深色文字在深色模式 `#1e1e1e` 背景上对比度极低，完全看不清）；
     - **修复要求（参考 `ganfan-garden/src/material/render/css.ts` 与 `epubStyles.ts` 的色彩与级联处理）**：
       1. **修复章节根选择器作用域（`src/plugins/stage-reader/epubResources.ts`）**：在 `sanitizeStylesheet` 中，不仅 `body` 选择器映射到 `${root}`，当选择器为 `.className` 或 `body.className` 时，同时生成匹配章节自身与后代的选择器（如 `${root}.bjqs, ${root} .bjqs`），防止原书挂在 `<body class="bjqs">` 上的样式丢失；
       2. **深色模式色彩可读性保护与对比度自适应（`epubResources.ts` & `epub.ts` & `workbenchStyles`）**：
          - 参考 `ganfan-garden` 的颜色解析与亮度对比度算法（解析 `#hex`、`rgb/rgba`、`hsl/hsla` 及常见命名色如 `black / darkblue / darkred / navy / maroon` 等）：
          - 当元素/规则声明了不透明背景色时，计算背景相对亮度并自动注入高对比度前景回退变量（浅底配深字、深底配浅字，如 `--pith-bg-contrast`）；
          - 当元素/规则**未声明局部背景色**（直接裸露在阅读器主题背景上）但声明了硬编码 `color`（来自 CSS 规则、内联 `style="color:..."` 或 `<font color="...">`）时：在浅色模式下保持原色；**在深色模式下（`body.theme-dark` 或 `@media (prefers-color-scheme: dark)` 且未处于浅色局部背景块内），对过暗的硬编码字色（如 `#5500af`、`#004080`、`#003000`、`#000000`、`darkblue` 等在深色背景 `#1e1e1e` 上对比度 `< 4.5:1` 的颜色）自动提亮或通过 CSS `color-mix` / 自适应变量映射为高可读性的亮色，同时保留色相语义**（并支持 `<font color="...">` 属性净化转换，避免深色下黑字/深蓝字隐身）。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增浏览器真机测试：1) 从看板点击打开 EPUB 课题后，不做任何鼠标点击直接发送 ` page.keyboard.press("ArrowRight") `，验证页码从 `1 / N` 变为 `2 / N`；2) 在深色模式下渲染含 `h4 { color: #5500af }`、`.text1 { color: #004080 }`、`<body class="bjqs">` 及深色正文的 EPUB，验证所有文本与实际背景的 WCAG 对比度 $\ge 4.5:1$；完成手动破壁验证并截屏存入 `.tmp/evidence/task-27/` 自检。
- **Tester 模拟用户终验要求**：在 Web 与真实 Obsidian（含深色模式）中打开真实 EPUB（含《女人的性爱动机》），验证进入书本直接按左右方向键翻页、深色模式下章节标题與正文清晰可读，截图归档至 `.tmp/evidence/task-27/`。
