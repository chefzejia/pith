# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；每完成一单先重读确认未被标为 `superseded`，再仅将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；**提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #17] 全局麦克风录音与语音转写输入底座（移除 `<input type="file">` 音频上传）

- **Status**: superseded (by #20)
- **Scope**: `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **Verified-Commit**: dba8e08
- **Updated**: 2026-11-06
- **验收摘要**：已由 `dba8e08` 落地 `VoiceInput` 麦克风采集与转写回填，后续整体验收并入 `#20 ~ #22` 根本性架构手术后统一验证。

---

## [Task #18] 重做 Dojo 原地实训卡片与正交 Eval 反馈闭环（废除双文本框与费曼正则凑词打分）

- **Status**: superseded (by #22)
- **Scope**: `src/plugins/dojo-feynman/**`, `src/plugins/dojo-shadowing/**`, `src/plugins/guide-acp/**`, `src/shells/**`, `tests/**`
- **Verified-Commit**: 380a53c
- **Updated**: 2026-11-06
- **验收摘要**：已由 `380a53c` 落地 `evalMode: "deterministic" | "guide-rubric"` 与三明治追问数据流，但其右上角 `.training-panel / .pith-dojo-panel` 弹窗与费曼生搬硬套的四阶段按钮被 `#22`（Stage 画布原位映射手术）推翻重做。

---

## [Task #19] 课题毕业门禁与 `ME.md` 认知权重合并闭环（Eval & Checkpoint Merge）

- **Status**: verified
- **Scope**: `src/plugins/guide-acp/**`, `src/shells/dsh/**`, `tests/**`
- **Verified-Commit**: f1f76a4607e5d8d19dd610ff966798f96e54aad0
- **Updated**: 2026-11-06
- **验收**：Worker 通过 typecheck、215 项测试、Obsidian 构建及手动破壁；38 项环境相关测试跳过。Tester 在真实沙盒存储中验证结题、画像更新及不更新、空笔记拒绝和画像写入失败。未验证真实模型调用；跨文件写入按契约顺序执行，并非事务。
- **授权范围**：允许修改 `src/plugins/guide-acp/tools.ts`、`src/plugins/guide-acp/index.ts`、`src/plugins/guide-acp/acpSession.ts`、`src/shells/dsh/index.ts` 及 `tests/**`。只读依赖 `src/core/`。
- **不在范围内**：严禁引入任何外部图数据库或非 Markdown 状态文件；`ME.md` 保持纯文本 Markdown 唯一事实源。
- **接口与行为契约**：
  1. **`pith_settle_topic` 顺序合并更新 `ME.md` 与 `topic.md`（`src/plugins/guide-acp/tools.ts` · 无需跨文件数据库事务）**：
     - 保持既有硬门禁不变：课题必须处于 `status === "exploring"` 且 `topic.notes.length > 0`（无学习者思考/实训记录严禁结题）；
     - 扩展 `pith_settle_topic` 的 `inputSchema`：除必填的 `topicId` 与 `verificationSummary` 外，新增可选字段 `profilePatchMarkdown`（字符串，向导提炼出的更新后 `ME.md` 全文内容，包含新内化的核心心智模型及修正的旧认知盲区）；
     - **确定性写入顺序（Fail-safe Sequential Write）**：
       1. 先校验所有参数（`topic` 存在、`status === "exploring"`、`topic.notes.length > 0`、`verificationSummary` 非空；若传入了 `profilePatchMarkdown`，通过 `text(input, "profilePatchMarkdown", 100000)` 校验其为非空字符串）；
       2. 若提供了 `profilePatchMarkdown`，**先调用 `await store.writeProfile(profilePatchMarkdown)` 更新 `ME.md`**（若写入失败则直接抛错中止，此时课题仍保持 `exploring` 状态，用户可安全重试）；
       3. 随后调用 `await store.appendNote(topicId, { kind: "note", body: "## 核心认知总结\n\n" + summary })` 与 `const settled = await store.updateTopic(topicId, { status: "settled" })`；
       4. 返回 `settled`（保持与既有调用方对 `Topic` 返回结构的 100% 兼容）。
  2. **向导毕业答辩与权重合并规程（`src/plugins/guide-acp/index.ts`）**：
     - 更新 `buildScenePrompt` 中的 `# 毕业门控（Settlement Gate）` 与 `# 工作区工具` 说明：明确指示向导在学习者通过深水区迁移问题后，调用 `pith_settle_topic` 时对比当前 `# 学习者画像`（`ME.md`）与本课题笔记，一并传入可选参数 `profilePatchMarkdown` 更新 `ME.md`。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿，新增 `pith_settle_topic` 传入 `profilePatchMarkdown` 时同步更新 `ME.md`、未传入时保持原 `ME.md` 不变、以及空笔记课题拒绝结题且不污染 `ME.md` 的单测，并完成手动破壁验证（`Broken by hand`）。
- **Tester 模拟用户终验要求**：在真实工作区沙盒中走通一个含笔记/实训记录的课题结题流程，验证结题后 `topic.md` 状态变为 `settled`、追加了 `## 核心认知总结`，且 `<workspace>/ME.md` 真实写入了更新后的认知基座内容。

---

## [Task #20] 架构手术一：铲除 `ViewKernel` / `parts` 死代码伪装与 `shells/` 根目录水平大泥球（跨插件代码归位）

- **Status**: pending
- **Scope**: `src/core/index.ts`, `src/core/pluginrt/**`, `src/plugins/**`, `src/shells/**`, `tests/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **授权范围**：允许删除 `src/core/pluginrt/kernel.ts` 并修改 `src/core/index.ts`、`src/core/pluginrt/runtime.ts`、`src/plugins/**`、`src/shells/**` 及 `tests/**`。
- **不在范围内**：严禁破坏 `src/core/` 不导入 `src/plugins/` 或 `src/shells/`、插件互不导入、宿主零泄漏（`node:*` / `"obsidian"` 仅限 `src/shells/`）的边界铁律。
- **接口与行为契约（彻底铲除假代码与错位碎片）**：
  1. **删除 100% 未使用的 `ViewKernel` 与 `PluginPart` 死代码（`src/core/pluginrt/` & `src/plugins/`）**：
     - 直接删除 `src/core/pluginrt/kernel.ts`，并从 `src/core/index.ts` 中移除 `export * from "./pluginrt/kernel.ts"`；
     - 从 `src/core/pluginrt/runtime.ts` 中删除未被任何生产宿主消费的 `PluginPart`、`PluginManifest.parts`、`PluginStatus.parts`、`PluginContext.contribute` 与 `PluginContext.getParts`；
     - 从 `src/plugins/*/index.ts` 的 `registerPlugin({...})` 中删除装样子的 `parts: [...]` 字段，并移除 `tests/pluginrt.test.ts` 中测死代码的 `ViewKernel` 用例。
  2. **清理 `src/shells/` 根目录水平碎片，将插件专属协调/视图归还给所属插件包（`src/plugins/dojo-interline/` & `src/plugins/stage-reader/`）**：
     - 将 `src/shells/interlineView.ts` 中的通用正文文本节点遍历函数 `proseTextNodes(block: Element): Text[]` 下沉至 `src/plugins/stage-reader/pagination.ts`（并由 `stage-reader/index.ts` 导出）；
     - 将 `src/shells/interlineView.ts` 中的 `InterlineView`、`preserveInterlinePosition`（改由调用方注入 `capturePosition` 回调以保持与 `stage-reader` 零直接 import）以及 `src/shells/interline.ts` 中的 `InterlineSession` 移入 `src/plugins/dojo-interline/` 包内并由 `src/plugins/dojo-interline/index.ts` 导出，删除 `src/shells/interlineView.ts`；
     - 将 `src/shells/dojoView.ts` 中的 `renderDojoAlignment`、`visibleDojoTarget`、`practiceMessage`、`displayPracticeMessage` 按职责分别归入 `src/plugins/dojo-shadowing/index.ts`、`src/plugins/dojo-feynman/index.ts` 与 `src/plugins/stage-reader/pagination.ts`，**彻底删除 `src/shells/dojoView.ts`**！
  3. **将散落在 `src/shells/` 根目录的语音网关与配置模块收束进垂直子包 `src/shells/speech/`**：
     - 将 `src/shells/speechRuntime.ts`、`src/shells/speechGateway.ts`、`src/shells/speechSettings.ts`、`src/shells/voiceInput.ts`、`src/shells/mediaAssets.ts` 移入 `src/shells/speech/` 目录下（统一由 `src/shells/speech/index.ts` 导出），并在 `tests/boundaries.test.ts` 中同步更新路径检查，使 `src/shells/` 结构清晰干净。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；确认 `src/core/pluginrt/kernel.ts`、`src/shells/interlineView.ts`、`src/shells/dojoView.ts` 已物理删除，且 `tests/boundaries.test.ts` 100% 通过并完成手动破壁验证（`Broken by hand`）。
- **Tester 模拟用户终验要求**：在 Web 与 `.dev-vault` 真实 Obsidian 中验证插件加载、行间双语切换、语音听读与麦克风输入在模块归位后功能与界面 100% 正常。

---

## [Task #21] 架构手术二：消灭 `src/shells/web/server.ts` 200 行无类型内联 `<script>` 字符串，转为强类型编译前端包

- **Status**: pending
- **Scope**: `src/shells/web/**`, `scripts/**`, `tests/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **授权范围**：允许新增 `src/shells/web/client.ts`（及样式模块），修改 `src/shells/web/server.ts`、`scripts/` 构建脚本与 `tests/**`。
- **不在范围内**：严禁引入 React / Vue / Vite 等重型第三方前端框架依赖（使用仓库已有的 `esbuild` 或 TypeScript 强类型模块化组织）。
- **接口与行为契约**：
  1. **将 `src/shells/web/server.ts` 底部的无类型内联 JS 大字符串拆为独立强类型 TypeScript 前端入口 `src/shells/web/client.ts`**：
     - 目前 `server.ts:413-579` 把近 200 行浏览器 DOM 代码和 18 个 `.toString()` 函数拼接塞在 `const APP = String.raw` 字符串里，完全逃脱了 `tsc --noEmit` 类型检查；
     - 创建 `src/shells/web/client.ts`，直接通过标准 TypeScript `import` 导入所需纯函数（`resolveResponsiveLayout`, `computePagination`, `InterlineView`, `VoiceInput` 等），编写接受 `npm run typecheck` 100% 严格静态类型检查的浏览器端代码（严禁再使用 `${fn.toString()}` 拼接源码字符串！）；
     - `server.ts` 通过 `esbuild`（内存打包缓存或启动预构建）在 `GET /app.js`（及 `CSP script-src 'self'`）提供编译后的前端脚本，彻底删除 `server.ts` 中脆弱的 `.toString()` 注入与超长单行内联脚本字符串。
  2. **更新边界守卫（`tests/boundaries.test.ts`）**：
     - 更新 `Web reader entry points have one definition and are never reassigned` 守卫单测以检查强类型的 `src/shells/web/client.ts`（并新增一条守卫：**禁止在 `src/shells/web/server.ts` 中使用 `.toString()` 拼接客户端函数源码**）。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；确认 `src/shells/web/client.ts` 受 TypeScript 严格类型检查且 `server.ts` 中零 `.toString()` 函数注入，完成手动破壁验证（`Broken by hand`）。
- **Tester 模拟用户终验要求**：启动真实 Web 桌面壳，在浏览器中完整操作罗盘首页、导入材料、多栏翻页、行间双语、听读、麦克风输入与向导对话，确认零 CSP 报错、零控制台异常。

---

## [Task #22] 架构手术三：将 Dojo 实训彻底原位映射到 Stage 画布段落/字幕块上（废除右上角大弹窗与费曼假四阶按钮）

- **Status**: pending
- **Scope**: `src/plugins/dojo-feynman/**`, `src/plugins/dojo-shadowing/**`, `src/shells/**`, `tests/**`, `docs/subsystems/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **授权范围**：允许修改 `src/plugins/dojo-feynman/index.ts`、`src/plugins/dojo-shadowing/index.ts`、`src/shells/obsidian/plugin.ts`、`src/shells/web/**`、`tests/**` 及同步文档。
- **不在范围内**：严禁在内容正下方（Bottom Area）新增除 `.pith-media-deck` 以外的常驻底栏。
- **接口与行为契约（对齐 [`docs/subsystems/5-spatial-ui-and-slots.md`](subsystems/5-spatial-ui-and-slots.md) 的 Stage 原位映射设计）**：
  1. **顶栏右上角近源气泡瘦身（仅作轻量工具选择/开关，绝不塞 `<textarea>` 表单！）**：
     - 点击顶栏 `#open-dojo` 工具胶囊时：若当前激活的是 `interline`，右上角轻量气泡仅展示 `[ 原文 | 行间双语 | 译文主显 ]` 三个胶囊；若挂载了多个工具，仅展示工具切换胶囊；
     - **彻底废除在右上角浮窗（`.training-panel` / `.pith-dojo-panel`）里塞入 `<pre>` 原文框、`<textarea>` 复述框和诊断结果的大弹窗设计！**
  2. **`dojo-feynman`（费曼复述）：砍掉生搬硬套的 4 阶段切换按钮，实现 Stage 目标段落原位合书遮罩与内联阐述**：
     - 在 `src/plugins/dojo-feynman/index.ts` 中，将 `feynmanToolkit.stages` 简化为单一的 `["blind-produce"]`（概念内化不需要机械的“按句号拆行/双字挖空”四阶段按钮）；
     - 当课题挂载了 `feynman` 且用户点击顶栏 `[费曼复述]`（或框选段落触发复述、点击正文段落）时，**直接在 Stage 画布的目标段落（`[data-prose="true"]` 或 `.pith-cue`）原位**挂载内联费曼实训卡（`.pith-inline-dojo[data-dojo="feynman"]`）：
       - 目标段落原文自动进入遮罩折叠态（显示 `【合上原文】请用自己的话向初学者解释这段机制的核心因果链与边界条件` 及 `[偷看原文]` 切换钮）；
       - 紧贴该段落正下方内联展示阐述 `<textarea>`、`🎙️ 语音输入`、`**[提交复述并请向导追问]**` 按钮与 `[收起 ×]`；
       - 点击提交后，自动将复述落盘为 `practice` 笔记、携带 `evaluationRubric` 发往右侧向导对话流并展开向导侧栏呈现三明治苏格拉底追问。
  3. **`dojo-shadowing`（影子跟读）：实现 Stage 目标字幕/段落原位四阶镜头变形与内联跟读**：
     - 当课题挂载了 `shadowing` 且用户点击 `.pith-cue` 字幕句或目标段落（或点击顶栏 `[影子跟读]` 定位到当前句）时，**直接在该字幕句/段落原位**挂载内联跟读卡（`.pith-inline-dojo[data-dojo="shadowing"]`）：
       - 顶部轻量四阶镜头条 `[ 意群拆解 | 原文 | 骨干词 | 盲听 ]` 直接使该句原文原位变形（意群 `/`、完整原文、`___` 挖空、`••••••••` 盲听遮罩）；
       - 紧贴该句下方内联展示跟读 `<textarea>`、`🎙️ 语音输入`、`**[对齐漏词]**` 与 `**[记入实训账本]**`；点击对齐后直接在该句原位用 `<mark>` 标亮漏读词！
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；更新相关单测与浏览器集成测试以验证 `.pith-inline-dojo` 在 `#article` / `.pith-article` 目标块原位挂载、费曼无多余四阶按钮、跟读原位四阶变形与漏词高亮，完成手动破壁验证（`Broken by hand`）。
- **Tester 模拟用户终验要求**：在 Web 与 `.dev-vault` 真实 Obsidian 中打开课题，分别开启 `feynman` 与 `shadowing`，截屏通过 `view_image` 肉眼确认：**1) 右上角不再弹出笨重的大文本框浮窗；2) 费曼复述与影子跟读 100% 嵌入在 Stage 画布的目标段落/字幕句原位展开，费曼直接遮蔽原文进入阐述+向导追问，跟读原位切换四阶镜头并标亮漏词，视觉呼吸感与书卷融为一体**。
