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
- **验收**：Worker 通过 typecheck、215 项测试、Obsidian 构建及手动破壁；Tester 在真实沙盒存储中验证结题、画像更新及不更新、空笔记拒绝和画像写入失败。

---

## [Task #20] 架构手术一：铲除 `ViewKernel` / `parts` 死代码伪装与 `shells/` 根目录水平大泥球（跨插件代码归位）

- **Status**: superseded (by #23)
- **Scope**: `src/core/index.ts`, `src/core/pluginrt/**`, `src/plugins/**`, `src/shells/**`, `tests/**`
- **Verified-Commit**: 183c6252fb4ceb1f82e74d933d39db5ab66e9cef
- **Updated**: 2026-11-06
- **验收摘要**：已由 `183c625` 物理删除 `ViewKernel`、`interlineView.ts`、`dojoView.ts` 并将语音模块收束进 `src/shells/speech/`；剩余 4 个散装文件（`acpSettings.ts`, `toolkitSlot.ts`, `httpDeadline.ts`, `interline.ts`）并入 `#23` 彻底清零。

---

## [Task #21] 架构手术二：消灭 `src/shells/web/server.ts` 200 行无类型内联 `<script>` 字符串，转为强类型编译前端包

- **Status**: superseded (by #23)
- **Scope**: `src/shells/web/**`, `scripts/**`, `tests/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **验收摘要**：升级并入 `#23`（建立四层单向架构 `src/workbench/`，实现 Obsidian / Web / DSH 全 Shell 共享唯一工作台 UI，而非仅拆一个 Web 私有 `client.ts`）。

---

## [Task #22] 架构手术三：将 Dojo 实训彻底原位映射到 Stage 画布段落/字幕块上（废除右上角大弹窗与费曼假四阶按钮）

- **Status**: superseded (by #24)
- **Scope**: `src/plugins/dojo-feynman/**`, `src/plugins/dojo-shadowing/**`, `src/shells/**`, `tests/**`, `docs/subsystems/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **验收摘要**：升级为 `#24`，直接在 `#23` 抽离的统一 `src/workbench/` 与插件层上实现 Stage 原位内联 Dojo，一次修改全 Shell 同步生效。

---

## [Task #23] 四层架构根本手术：清空 `src/shells/` 根目录残余散装文件 & 建立全 Shell 共享图形工作台层（`src/workbench/`）

- **Status**: pending
- **Scope**: `src/core/**`, `src/plugins/**`, `src/workbench/**`, `src/shells/**`, `scripts/**`, `tests/**`, `docs/subsystems/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **授权范围**：允许修改 `src/core/host.ts`、`src/core/index.ts`、`src/plugins/**`、新建 `src/workbench/**`、修改并删除 `src/shells/` 根目录下残余散装文件、修改 `src/shells/{obsidian,web,dsh,speech}/**`、`scripts/**`、`tests/**` 及同步文档。
- **不在范围内**：严禁引入 React / Vue / Vite 等重型第三方前端框架依赖；严禁在 `src/core/`、`src/plugins/` 或 `src/workbench/` 中导入 `node:*`、`"obsidian"` 或 `@deepseek-ai/*`。
- **接口与行为契约（落子四层单向架构 `core → plugins → workbench → shells`）**：
  1. **`src/shells/` 根目录散装 `.ts` 文件 100% 清零（物归原主 + 守卫单测锁死）**：
     - 将 `src/shells/httpDeadline.ts`（`withHttpDeadline`）下沉至 `src/core/host.ts`（由 `src/core/index.ts` 导出），删除 `src/shells/httpDeadline.ts`；
     - 将 `src/shells/interline.ts`（`agentInterlineTranslator`）归入 `src/plugins/guide-acp/index.ts`（因为它本质是基于 `runOneShotAcpPrompt` 提供的 `InterlineTranslator` 适配器），删除 `src/shells/interline.ts`；
     - 将 `src/shells/acpSettings.ts`（`renderAcpSelect`）、`src/shells/toolkitSlot.ts`（`effectiveToolkits`, `topicUsesToolkit`, `toolkitSlot`）与 `src/shells/speech/voiceInput.ts`（`VoiceInput`）移入新建的 **`src/workbench/`** 层（由 `src/workbench/index.ts` 统一导出）；
     - 在 `tests/boundaries.test.ts` 中新增静态守卫：**① `src/shells/` 根目录下严禁存在任何散装文件（仅允许 `obsidian/`、`web/`、`dsh/`、`speech/` 子目录）；② 四层 DAG 守卫：`src/workbench/**` 仅允许导入 `src/core/` 与 `src/plugins/`，严禁导入 `src/shells/`、`node:*`、`"obsidian"` 或 `@deepseek-ai/*`**。
  2. **建立全 Shell 统一图形工作台 `src/workbench/` & 消灭 `web/server.ts` 无类型内联 `<script>` 字符串**：
     - 将五区工作台视图控制器（`PithWorkbenchView` / 原 `PithObsidianView`）与统一书卷 CSS 样式表（`workbenchStyles` / 原 `obsidianStyles`）抽离至 **`src/workbench/`**（从 `src/workbench/index.ts` 导出，同时在 `src/shells/obsidian/plugin.ts` re-export 以保持对外符号兼容）；
     - 将 `src/shells/web/server.ts` 底部 200 行无类型内联 `<script>` 字符串拆为受 `tsc --noEmit` 严格静态类型检查的 `src/shells/web/client.ts`（直接 `import` `src/workbench/`、`src/plugins/` 与 `src/core/`，彻底删除 `server.ts` 中所有 `${fn.toString()}` 源码字符串拼接！），由 `server.ts` 通过 `esbuild` 提供编译脚本；
     - 在 `src/shells/dsh/index.ts` 中，除导出 `createDshPluginBundle`（`DshTool[]`）外，一并导出统一的 `mountPithWorkbench` / `PithWorkbenchView` 与 `workbenchStyles`，使 `obsidian`、`web`、`dsh` 三个 Shell 共享同一份工作台 UI 真源；
     - 在 `tests/boundaries.test.ts` 中更新 `Web reader entry points` 守卫以检查 `src/shells/web/client.ts`，并新增守卫：**禁止在 `src/shells/web/server.ts` 中使用 `.toString()` 注入客户端函数源码**。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；确认 `src/shells/` 根目录下 0 散装 `.ts` 文件、`src/workbench/` 边界守卫与 `.toString()` 禁用守卫通过手动破壁验证（`Broken by hand`）。
- **Tester 模拟用户终验要求**：在真实 Web 桌面壳与 `.dev-vault` Obsidian 中打开 Pith，验证罗盘首页、材料导入、阅读翻页、行间双语、听读、麦克风录音与向导对话 100% 正常工作且零 CSP/控制台报错。

---

## [Task #24] 将 Dojo 实训彻底原位映射到 Stage 画布段落/字幕块上（废除右上角大弹窗与费曼假四阶按钮）

- **Status**: pending
- **Scope**: `src/plugins/dojo-feynman/**`, `src/plugins/dojo-shadowing/**`, `src/workbench/**`, `src/shells/**`, `tests/**`, `docs/subsystems/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **授权范围**：允许修改 `src/plugins/dojo-feynman/index.ts`、`src/plugins/dojo-shadowing/index.ts`、`src/workbench/**`、`src/shells/**`、`tests/**` 及同步文档。
- **不在范围内**：严禁在内容正下方（Bottom Area）新增除 `.pith-media-deck` 以外的常驻底栏。
- **接口与行为契约（对齐 [`docs/subsystems/5-spatial-ui-and-slots.md`](subsystems/5-spatial-ui-and-slots.md) 的 Stage 原位映射设计）**：
  1. **顶栏右上角近源气泡瘦身（仅作轻量工具选择/模式开关，绝不塞 `<textarea>` 表单！）**：
     - 点击顶栏 `#open-dojo` 工具胶囊时：若当前激活的是 `interline`，右上角轻量气泡仅展示 `[ 原文 | 行间双语 | 译文主显 ]` 三个胶囊；若挂载了多个工具，仅展示工具切换胶囊；
     - **彻底废除在右上角浮窗（`.training-panel` / `.pith-dojo-panel`）里塞入 `<pre>` 原文框、`<textarea>` 复述框和诊断结果的大弹窗设计！**
  2. **`dojo-feynman`（费曼复述）：砍掉生搬硬套的 4 阶段切换按钮，实现 Stage 目标段落原位合书遮罩与内联阐述**：
     - 在 `src/plugins/dojo-feynman/index.ts` 中，将 `feynmanToolkit.stages` 简化为单一的 `["blind-produce"]`（概念内化不需要机械的“按句号拆行/双字挖空”四阶段按钮）；
     - 当课题挂载了 `feynman` 且用户点击顶栏 `[费曼复述]`（或框选段落触发复述、点击正文段落）时，**直接在 Stage 画布的目标段落（`[data-prose="true"]` 或 `.pith-cue`）原位**挂载内联费曼实训卡（`.pith-inline-dojo[data-dojo="feynman"]`）：
       - 目标段落原文自动进入遮罩折叠态（显示 `【合上原文】请用自己的话向初学者解释这段机制的核心因果链与边界条件` 及 `[查看原文]` 切换钮）；
       - 紧贴该段落正下方内联展示阐述 `<textarea>`、`🎙️ 语音输入`、`**[提交复述并请向导追问]**` 按钮与 `[收起 ×]`；
       - 点击提交后，自动将复述落盘为 `practice` 笔记、携带 `evaluationRubric` 发往右侧向导对话流并展开向导侧栏呈现三明治苏格拉底追问。
  3. **`dojo-shadowing`（影子跟读）：实现 Stage 目标字幕/段落原位四阶镜头变形与内联跟读**：
     - 当课题挂载了 `shadowing` 且用户点击 `.pith-cue` 字幕句或目标段落（或点击顶栏 `[影子跟读]` 定位到当前句）时，**直接在该字幕句/段落原位**挂载内联跟读卡（`.pith-inline-dojo[data-dojo="shadowing"]`）：
       - 顶部轻量四阶镜头条 `[ 意群拆解 | 原文 | 骨干词 | 盲听 ]` 直接使该句原文原位变形（意群 `/`、完整原文、`___` 挖空、`••••••••` 盲听遮罩）；
       - 紧贴该句下方内联展示跟读 `<textarea>`、`🎙️ 语音输入`、`**[对齐漏词]**` 与 `**[记入实训账本]**`；点击对齐后直接在该句原位用 `<mark>` 标亮漏读词！
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；更新相关单测与浏览器集成测试以验证 `.pith-inline-dojo` 在 `#article` / `.pith-article` 目标块原位挂载、费曼无多余四阶按钮、跟读原位四阶变形与漏词高亮，完成手动破壁验证（`Broken by hand`）。
- **Tester 模拟用户终验要求**：在 Web 与 `.dev-vault` 真实 Obsidian 中打开课题，分别开启 `feynman` 与 `shadowing`，截屏通过 `view_image` 肉眼确认：**1) 右上角不再弹出笨重的大文本框浮窗；2) 费曼复述与影子跟读 100% 嵌入在 Stage 画布的目标段落/字幕句原位展开，费曼直接遮蔽原文进入阐述+向导追问，跟读原位切换四阶镜头并标亮漏词，视觉呼吸感与书卷融为一体**。
