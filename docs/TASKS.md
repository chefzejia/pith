# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；每完成一单先重读确认未被标为 `superseded`，再仅将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；**提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #15] 动态拉取 ACP Agent 模型/推理强度下拉列表（`configOptions`）与本机轻量语音按需网关（Managed Local Speech Daemon）

- **Status**: verified
- **Scope**: `src/core/seams.ts`, `src/core/host.ts`, `src/plugins/guide-acp/**`, `src/plugins/speech-service/**`, `src/shells/**`, `tests/**`
- **Verified-Commit**: 8aee0fba8d7d426c3047d716e4f76dbf88ec961f
- **Updated**: 2026-11-05
- **验收摘要**：通过标准 ACP `session/new` 的 `configOptions` 与 `session/set_config_option` 动态发现并切换本机 Agent 模型与推理强度；通过 `NodeManagedSpeechRuntime` 管理 Vault 外零 Python 依赖的本机按需语音网关（契约见 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md)）。

---

## [Task #16] 修复分页阅读器横向滚动条泄露与超宽屏单栏行宽失控/大片留白

- **Status**: verified
- **Scope**: `src/plugins/stage-reader/pagination.ts`, `src/shells/obsidian/plugin.ts`, `src/shells/web/server.ts`, `tests/**`
- **Verified-Commit**: 3441c988aab6e1cfe80fdd5c4b516df557bde80d
- **Updated**: 2026-11-05
- **验收摘要**：分页视口隐藏原生横向滚动条并将 `::after` 撑宽伪元素改为绝对定位；`computePagination` 按 `1 / 2 / 3` 栏最大舒适列宽自动扩大两侧水平留白并保持多屏翻页步长恒等式（契约见 [2-stages.md](subsystems/2-stages.md)）。

---

## [Task #17] 全局麦克风录音与语音转写输入底座（移除 `<input type="file">` 音频上传）

- **Status**: pending
- **Scope**: `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **授权范围**：允许修改 `src/shells/obsidian/index.ts`、`src/shells/obsidian/plugin.ts`、`src/shells/web/server.ts` 以及 `tests/` 下相关测试文件（若需抽取双壳共用的纯客户端录音辅助模块，可新增 `src/shells/` 下辅助文件）。只读依赖 `src/core/` 与 `src/plugins/speech-service/`。
- **不在范围内**：严禁修改 `src/core/` 冻结接口；严禁使用浏览器内置 `webkitSpeechRecognition / SpeechRecognition`（必须 100% 走 `speech.asr` 服务接口 `transcribeAudio(bytes, mimeType, signal)`）。
- **接口与行为契约**：
  1. **Obsidian 壳接通 `transcribeAudio` 动作（`src/shells/obsidian/index.ts` & `plugin.ts`）**：
     - 在 `ObsidianViewActions` 中新增可选方法 `transcribeAudio?(bytes: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<{ readonly text: string }>`；
     - 在 `PithWorkspaceView.openTopic` 创建视图时，将 `transcribeAudio` 桥接至 `this.controller.runtime.getService<SpeechAsrService>("speech.asr")?.transcribeAudio`（未配置或不可达时抛出清晰引导错误，与 `synthesizeSpeech` 保持一致）。
  2. **双壳统一麦克风录音输入（移除 `<input id="asr-audio" type="file">`）**：
     - **彻底删除** `src/shells/web/server.ts` 中的 `<label for="asr-audio">跟读录音</label><input id="asr-audio" type="file" accept="audio/*"><button type="button" class="button" id="transcribe-audio">识别录音</button>` 文件选择器与 `#transcribe-audio` 旧逻辑；
     - 在 **Web 壳与 Obsidian 壳** 的两处输入区同时提供统一的麦克风按钮（`🎙️ 语音输入` / 录音中显示 `⏹ 停止录音` 并带 `aria-pressed="true"`，转写中显示 `识别中…` 并 `disabled`）：
       - **位置 1**：向导侧栏底部消息输入区（Web `.compose` / Obsidian `.pith-guide-compose`），转写成功后将识别文本追加或填入消息 `<textarea>` 并聚焦；
       - **位置 2**：Dojo 实训面板的产出输入区（Web `.training-panel` / Obsidian `.pith-dojo-panel`），转写成功后将识别文本填入复述/跟读 `<textarea>`（`#dojo-produced` / `[data-dojo-produced]`）。
  3. **录音生命周期与资源释放**：
     - 点击开始录音时调用 `navigator.mediaDevices.getUserMedia({ audio: true })` 并启动 `MediaRecorder`；
     - 再次点击停止（或切换课题/关闭面板/卸载视图 `dispose()`）时，立即停止 `MediaRecorder` **并对 `MediaStream.getTracks()` 的所有 track 调用 `.stop()` 释放麦克风硬件占用**；
     - 若宿主机无麦克风权限、`mediaDevices` 不可用或录得空音频（`0 bytes`），立即释放 track 并通过 `notify / tip` 提示明确错误，绝不静默吞错。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿，新增针对 Web 与 Obsidian 双壳向导输入框及 Dojo 面板麦克风录音 -> ASR 转写 -> track 释放的单测，并完成手动破壁验证（`Broken by hand`）。
- **Tester 模拟用户终验要求**：在 Web 与 `.dev-vault` 真实 Obsidian 中打开课题，检查向导侧栏底部与 Dojo 面板均已渲染 `🎙️` 语音输入按钮且旧版文件上传框已彻底消失；验证点击录音、停止并转写回填文字、以及语音服务未就绪时的错误提示与 UI 排版。

---

## [Task #18] 重做 Dojo 原地实训卡片与正交 Eval 反馈闭环（废除双文本框与费曼正则凑词打分）

- **Status**: pending
- **Scope**: `src/plugins/dojo-feynman/**`, `src/plugins/dojo-shadowing/**`, `src/plugins/guide-acp/**`, `src/shells/**`, `tests/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **授权范围**：允许修改 `src/plugins/dojo-feynman/index.ts`、`src/plugins/dojo-shadowing/index.ts`、`src/plugins/guide-acp/index.ts`、`src/plugins/guide-acp/acpSession.ts`、`src/shells/**` 及 `tests/**`。只读依赖上游已冻结的 `src/core/seams.ts`（`evalMode: "deterministic" | "guide-rubric"`、`evaluationRubric`、`activeRubric`）。
- **不在范围内**：严禁新增额外 `dojo-*` 插件目录；严禁在 `src/core/` 引入特定教学法隐喻。
- **接口与行为契约**：
  1. **正交声明 `evalMode` 与教练规程（`dojo-shadowing` vs `dojo-feynman`）**：
     - `dojo-shadowing`（`src/plugins/dojo-shadowing/index.ts`）：显式设置 `evalMode: "deterministic"`；保留 4 阶脚手架与 LCS 词级对齐 `diagnose(targetText, producedText)`，但 `summaryMarkdown` 与 UI 渲染重点展示**原文对照与漏词高亮（`<mark>` 标出漏读词）**，去除冷冰冰的百分数考试打分感；
     - `dojo-feynman`（`src/plugins/dojo-feynman/index.ts`）：显式设置 `evalMode: "guide-rubric"` 并提供 `evaluationRubric`（**三明治苏格拉底追问规程**：① 🟢 肯定学习者复述中抓准的核心因果链或自创类比；② 🟡 指出对照原文遗漏的一个关键前提或边界条件；③ 🎯 提出 1 个具体的反例或跨场景追问，绝不直接替学习者背书）；在 `buildScenePrompt`（`src/plugins/guide-acp/index.ts`）中，当传入 `activeRubric` 时将其注入向导上下文。
  2. **砍掉反人类的可编辑“目标文本 `<textarea>`”，改为原地锚定目标段 + 单一产出区（双壳 UI 重构）**：
     - 在 Web（`src/shells/web/server.ts`）与 Obsidian（`src/shells/obsidian/plugin.ts`）的 Dojo 面板中，**移除可编辑的「目标文本 `<textarea>`」与「应用阶段」冗余按钮**；
     - 打开 Dojo 时自动绑定当前正文框选段落、点击的字幕句（`.pith-cue`）或当前可见章节首段作为目标锚点，顶部直接展示只读的当前阶段脚手架视图（切换 4 个阶段按钮时立即实时切换脚手架展示：如 `blind-produce` 阶段自动遮蔽原文并展示费曼/跟读提示）；
     - 下方仅保留**一个产出输入框（支持打字 + `[Task #17]` 的 `🎙️` 麦克风语音输入）**：
       - 当 `evalMode === "deterministic"`（`shadowing`）时，主按钮为 **「对齐漏词」**（本地即时标亮漏读词）与 **「记入实训账本」**；
       - 当 `evalMode === "guide-rubric"`（`feynman`）时，主按钮为 **「提交复述并请向导追问」**（将目标原文选区 `anchor`、学习者复述正文与 `feynman` 的 `evaluationRubric` 一并发送至向导对话流，同时将本次复述记录为 `kind: "practice"` 笔记并展开右侧向导侧栏接收三明治追问；若向导未配置，则回退本地盲区提示并允许直接保存为 `practice` 笔记）。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿，更新并新增 `dojo-feynman` / `dojo-shadowing` / 双壳实训交互单测，完成手动破壁验证（`Broken by hand`）。
- **Tester 模拟用户终验要求**：在 Web 与 `.dev-vault` 真实 Obsidian 中分别测试 `shadowing`（点击字幕/选区 -> 切换 4 阶脚手架 -> 漏词高亮展示）与 `feynman`（框选正文 -> 遮蔽原文复述 -> 提交触发向导三明治苏格拉底追问并落盘 `practice` 笔记），截屏审视单文本框实训卡片的视觉排版。

---

## [Task #19] 课题毕业门禁与 `ME.md` 认知权重合并闭环（Eval & Checkpoint Merge）

- **Status**: pending
- **Scope**: `src/plugins/guide-acp/**`, `src/shells/**`, `tests/**`
- **Verified-Commit**: none
- **Updated**: 2026-11-06
- **授权范围**：允许修改 `src/plugins/guide-acp/tools.ts`、`src/plugins/guide-acp/index.ts`、`src/plugins/guide-acp/acpSession.ts`、`src/shells/dsh/index.ts` 及 `tests/**`。只读依赖 `src/core/`。
- **不在范围内**：严禁引入任何外部图数据库或非 Markdown 状态文件；`ME.md` 保持纯文本 Markdown 唯一事实源。
- **接口与行为契约**：
  1. **`pith_settle_topic` 支持原子合并更新 `ME.md`（`src/plugins/guide-acp/tools.ts`）**：
     - 保持既有硬门禁不变：课题必须处于 `status === "exploring"` 且 `topic.notes.length > 0`（无学习者思考/实训记录严禁结题）；
     - 扩展 `pith_settle_topic` 的 `inputSchema`：除必填的 `topicId` 与 `verificationSummary` 外，新增可选字段 `profilePatchMarkdown`（字符串，向导提炼出的本次课题对学习者认知基座 `ME.md` 的增量更新或重写后的完整 `ME.md` 内容，包含新内化的核心心智模型及修正的旧认知盲区）；
     - 当传入非空的 `profilePatchMarkdown` 时，`pith_settle_topic` 在追加 `## 核心认知总结` 并将课题置为 `settled` 的同时，调用 `store.writeProfile(...)` 持久化更新 `<workspace>/ME.md`，在返回值中一并返回 `{ topic, profileUpdated: boolean }`。
  2. **向导毕业答辩与权重合并规程（`src/plugins/guide-acp/index.ts`）**：
     - 更新 `buildScenePrompt` 中的 `# 毕业门控（Settlement Gate）` 与 `# 工作区工具` 说明：明确指示向导在学习者通过深水区迁移问题后，调用 `pith_settle_topic` 时对比当前 `# 学习者画像`（`ME.md`）与本课题笔记，一并生成 `profilePatchMarkdown` 以完成认知权重合并。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿，新增 `pith_settle_topic` 结题时同步更新 `ME.md` 及拒绝空笔记结题的单测，并完成手动破壁验证（`Broken by hand`）。
- **Tester 模拟用户终验要求**：在真实工作区沙盒中走通一个含笔记/实训记录的课题结题流程，验证结题后 `topic.md` 状态变为 `settled`、追加了 `## 核心认知总结`，且 `<workspace>/ME.md` 真实写入了更新后的认知基座内容。
