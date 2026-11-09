# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；**每完成一单必须在进入下一单前立即将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #30] Kokoro v1.1-zh 内置 103 个多语种音色动态发现与本机/云端音色选择器

- **Status**: verified
- **Scope**: `src/shells/speech/**`, `src/plugins/speech-service/**`, `src/workbench/**`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **Verified-Commit**: f470ec896c13b916c3c3ce16ee374f5365d1ac23
- **Updated**: 2026-11-09
- **验收摘要**：Worker 类型检查、全仓测试（237 通过、56 跳过）与构建通过；独立 Tester 在 Web 与真实隔离 Obsidian 读取 103 个音色及三分组，验证本机/云端音色分别持久化、重开恢复及真实阅读页听读。`zf_001` / `zm_010` 两端均收到真实 Kokoro HTTP 200，Web 音频 49,768 / 52,298 字节，原生 49,876 / 52,294 字节；明暗窄幅及未安装/损坏状态已看图审视，未独立评价音色声学质量。截图：`.tmp/evidence/task-30/final-web-zm.png`、`.tmp/evidence/task-30/final-native-zm.png`、`.tmp/evidence/task-30/final-native-listen-zf.png`、`.tmp/evidence/task-30/final-web-dark-narrow.png`、`.tmp/evidence/task-30/final-native-error.png`。

---

## [Task #31] 语音下载协议容错加固与 Agent 环境探针轻量化

- **Status**: verified
- **Scope**: `src/shells/speech/speechDownload.ts`, `src/plugins/guide-acp/discovery.ts`, `src/shells/web/nodeProcess.ts`, `tests/**`
- **Verified-Commit**: d5ee65f63477bbf71693c810e33bd1086e9f7e59
- **Updated**: 2026-11-09
- **验收摘要**：Worker 类型检查、全仓测试（244 通过、56 跳过）、构建及手动破壁通过；独立 Tester 使用小型有效归档，经 Web 安装 UI 和真实 curl 验证 Range 请求收到 200 完整体后 SHA 匹配并安装完成；504 两次后恢复、四次耗尽，取消/坏哈希/超限均保留原分片。沙盒 HOME 与配置环境依赖 CLI 经真实发现入口识别并完成标准 ACP 初始化，非 ACP 输出被拒绝，超时约 4 秒返回失败。证据：`.tmp/evidence/task-31/final-observations.json`、`.tmp/evidence/task-31/final-web-install-200.png`、`.tmp/evidence/task-31/final-web-agent-discovery.png`、`.tmp/evidence/task-31/final-web-agent-timeout.png`。

---

## [Task #32] 认知管家课程拆解 Prompt、代码仓库只读工具与多步读取回路（对齐 `ganfan-garden` 拆课闭环）

- **Status**: verified
- **Verified-Commit**: 9e9a0c0b876cab5a312a53cc4257ef0cb80133c2
- **验收摘要**：独立 Tester 在真实临时 Git 仓库验证固定提交、分页/行号与脏文件隔离，拒绝符号链接、二进制、无效 UTF-8、超大文件和越界路径；受控标准 ACP 经目录→源码→上下文→写大纲/第一讲与工具配置，四拍上限及跨课题保护通过。空课题自动材料绑定、旧 materialId 写法及原始材料保护通过；Web 点按快捷动作/选择胶囊并打开第一讲，隔离 Obsidian 注入仓库端口可读固定提交。受控回复验证协议与存储链路，不评价真实模型教学质量。截图与记录：`.tmp/evidence/task-32/final-web-guide.png`、`final-web-lesson.png`、`final-native-sandbox.png`、`final-acp-four-turns.jsonl`、`final-acp-results.json`。
- **Scope**: `src/plugins/guide-acp/**`, `src/plugins/dojo-*/index.ts`, `src/shells/web/nodeRepository.ts`, `src/shells/web/server.ts`, `src/shells/obsidian/index.ts`, `tests/**`
- **授权范围**：允许新建 `src/shells/web/nodeRepository.ts`（实现 `RepositoryPort`，供 Web 与 Obsidian 壳共享），允许修改 `src/plugins/guide-acp/index.ts`、`src/plugins/guide-acp/acpSession.ts`、`src/plugins/guide-acp/tools.ts`、`src/plugins/dojo-shadowing/index.ts`、`src/plugins/dojo-feynman/index.ts`、`src/plugins/dojo-interline/index.ts`、`src/shells/web/server.ts`、`src/shells/obsidian/index.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/` 冻结契约；严禁允许向导修改外部 Git 仓库或读取未提交工作区脏文件及符号链接。
- **背景与参考代码**：执行环开工前请主动阅读 [`docs/subsystems/4-guide-speech-shells.md`](subsystems/4-guide-speech-shells.md)、[`docs/subsystems/3-dojos.md`](subsystems/3-dojos.md) 以及前身项目 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/gardener/harness.ts` 与 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/store/RepositoryBinding.ts`。
- **接口与行为契约**：
  1. **完善三大内置 `Toolkit` 的协议描述（`src/plugins/dojo-*/index.ts`）**：
     - 在 `shadowingToolkit`、`feynmanToolkit`、`interlineToolkit` 中补充 `whenToUse`、`compatibleStages` 与 `uiProtocol` 字段（对齐 `src/core/seams.ts` 中的 `DojoToolkitDescriptor`）：
       - `interline`: `whenToUse: "外文书籍、文章或讲义阅读需要段落级母语对齐字幕降噪时挂载"`, `compatibleStages: ["reader"]`, `uiProtocol: "interline-subtitle"`；
       - `shadowing`: `whenToUse: "外语听力、口语发音、演讲台词或音视频字幕需要四阶跟读与漏词诊断时挂载"`, `compatibleStages: ["timeline", "reader"]`, `uiProtocol: "inline-stage-lens"`；
       - `feynman`: `whenToUse: "架构设计、源码机制、核心概念或理论需要合书复述与苏格拉底反例追问时挂载"`, `compatibleStages: ["reader", "timeline"]`, `uiProtocol: "inline-stage-lens"`。
  2. **实现只读 Git 仓库端口 `NodeRepositoryPort`（`src/shells/web/nodeRepository.ts`）并注入 Web / Obsidian 壳**：
     - 参考 `ganfan-garden/src/store/RepositoryBinding.ts`，使用受控 `git -C <root> --no-optional-locks` 实现 `RepositoryPort`（`inspectRepository`、`listFiles`、`readFile`）：
       - `inspectRepository(repoPath)`：校验绝对路径为合法 Git 仓库，解析 `realpath(toplevel)`、`HEAD^{commit}` 40/64 位十六进制 `commitSha` 及仓库目录名作为 `title`；
       - `listFiles(externalPath, commitSha, offset = 0, limit = 200)`：通过 `git ls-tree -r -z --full-tree <commitSha>` 仅列出普通文件（mode `100644 | 100755`），拒绝符号链接（`120000`）与子模块，返回 `{ files, total, nextOffset }`；
       - `readFile(externalPath, commitSha, filePath, startLine = 1, maxLines = 120)`：通过 `git cat-file blob` 只读绑定 `commitSha` 下的 UTF-8 文本文件（单文件上限 256 KiB，拒绝含 `\0` 的二进制文件），按 1-based 行号截取 `startLine..endLine`（最大 12,000 字符），返回 `RepositoryFileExcerpt`。
  3. **升级受控工作区工具表与无材料课题自动创建讲义包（`src/plugins/guide-acp/tools.ts`）**：
     - `createGuideWorkspaceTools(store, engine, storage, http, repository)` 新增两个只读仓库工具：
       - `pith_list_repository_files`：参数 `{ materialId, offset?, limit? }`，校验 `material.kind === "repo"` 且具备 `externalPath` 与 `commitSha`，调用 `repository.listFiles`；
       - `pith_read_repository_file`：参数 `{ materialId, path, startLine?, maxLines? }`，调用 `repository.readFile` 返回带 `commitSha` 与行号范围的代码片段；
     - **支持向无初始材料的课题直接写讲义（`pith_write_lesson`）**：
       - 允许 `pith_write_lesson` 传入 `{ topicId, materialId?, fileName, markdown }`（保留旧 `{ materialId, fileName, markdown }` 100% 向后兼容）；
       - 当传入 `topicId` 且该 Topic 尚未关联 `materialId` 时，自动调用 `store.importMaterial({ title: topic.title, kind: "article", files: [] })` 创建材料包并 `store.updateTopic(topicId, { materialId: material.id })`，随后调用 `store.writeGeneratedFile(materialId, fileName, markdown)` 写入《`00-课程大纲.md`》或《`01-xxx.md`》。
  4. **升级认知管家与三类课题拆解 Prompt（`src/plugins/guide-acp/index.ts`）**：
     - 按照 [`docs/subsystems/4-guide-speech-shells.md`](subsystems/4-guide-speech-shells.md) 第 2.1 节与 2.2 节契约升级 `buildScenePrompt` 与 `quickActionsForTopic`：
       - 在 `buildScenePrompt` 中注入**私人课程架构师与三类课题分流指南**（A. 庞大陌生课题/代码仓库主动用 `pith_list_repository_files` / `pith_read_repository_file` 侦察并规划《`00-课程大纲.md`》与带 `commit` + `path:line` 出处的递进讲义；B. 书籍/长文导读路线；C. 技能微练习）、**可用 Toolkits 的 `whenToUse` 说明与动态 CRUD 规则**、以及**每次回复末尾输出 `pith-choices`（2~4 个可点击下一步胶囊）**的协议；
       - 在 `quickActionsForTopic` 中：当课题尚无可读材料文件或刚绑定代码仓时，提供 `{ id: "plan-curriculum", label: "规划课程大纲与第一讲", prompt: "请结合我的学习者画像和当前课题目标，先规划《00-课程大纲.md》并生成第一讲讲义，同时配置合适的实训工具。" }`。
  5. **支持多步只读工具循环（Multi-Step Read Tool Loop · `src/plugins/guide-acp/acpSession.ts`）**：
     - 在 `LocalAcpGuideProvider.reply` 中，当模型回复末尾包含只读工具调用（`pith_get_context`、`pith_read_material_section`、`pith_list_repository_files`、`pith_read_repository_file`）时，执行该工具并将工具返回结果拼入下一拍上下文继续调用 ACP（最多循环 4 拍），使向导能真正“先看仓库目录与源码，再写出有据可查的《`00-课程大纲.md`》与讲义”。
- **Worker 工程内环门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增单测覆盖：1) `NodeRepositoryPort` 对真实临时 Git 仓库的 `inspectRepository / listFiles / readFile`（含拒绝未提交文件、拒绝二进制与符号链接）；2) 无 `materialId` 的 Topic 调用 `pith_write_lesson` 自动创建绑定材料包并写入《`00-课程大纲.md`》；3) `LocalAcpGuideProvider.reply` 多步工具循环（先调 `pith_list_repository_files` / `pith_read_repository_file` 拿到源码，再调 `pith_write_lesson` + `pith-toolkits` 生成课程讲义并挂载工具）；完成手动破壁验证。

---

## [Task #33] 显式材料启发式默认 Toolkit 挂载、首页唯一统一立项台（Unified Intake）与顶栏 Toolkit CRUD

- **Status**: verified
- **Verified-Commit**: c6f35143ffb794b60bd0720392a7ebd9e2dd1573
- **验收摘要**：独立 Tester 在 Web 与隔离 Obsidian 验证统一立项、仓库及无材料向导生成、材料刷新、普通聊天保持阅读、源码逐行锚点与转义、二进制拒绝、默认及显式空工具和工具增删启动持久化。原生 `.ts` 的 `video/mp2t` 冲突已修复；332px 内容区与 Web 390px 中标题、工具图标和菜单完整，宽幅恢复名称。Worker 类型检查、全仓测试（253 通过、59 跳过）、构建与有效破壁通过。受控 ACP 不评价真实模型教学质量，原生窄幅使用 CDP 视口。截图及报告：`.tmp/evidence/task-33/final-header-native-narrow.png`、`final-header-native-menu.png`、`final-header-web-narrow.png`、`final-header-report.md`。
- **Scope**: `src/workbench/**`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **授权范围**：允许修改 `src/workbench/toolkitSlot.ts`、`src/workbench/compass.ts`、`src/workbench/view.ts`、`src/shells/obsidian/index.ts`、`src/shells/obsidian/plugin.ts`、`src/shells/web/client.ts`、`src/shells/web/server.ts`、`src/shells/web/workbench.ts` 及 `tests/**`。
- **不在范围内**：严禁在首页展开右侧向导侧边栏造成双输入框视觉分裂；严禁拦截用户上传代码或文本类文件（如 `.ts`, `.py`, `.json`, `.txt`）。
- **接口与行为契约**：
  1. **显式材料导入时的启发式默认 `Toolkit` 挂载（`src/workbench/toolkitSlot.ts` & `obsidian/index.ts` & `web/server.ts` & `web/client.ts`）**：
     - 在 `src/workbench/toolkitSlot.ts` 新增导出纯函数 `defaultToolkitsForMaterial(input: { kind: string; files: readonly { name: string; mimeType?: string }[]; sampleText?: string }): string[]`：
       - 若 `kind === "media"` 或文件含音视频/字幕（`.vtt / .srt / audio/* / video/*`）$\rightarrow$ 返回 `["shadowing"]`；
       - 若 `kind === "repo"` $\rightarrow$ 返回 `["feynman"]`；
       - 若为书籍/文章/文档且 `sampleText`（或文件名/标题）中拉丁/外文字母占非空白文字比例 $\ge 50\%$ $\rightarrow$ 返回 `["interline", "feynman"]`；
       - 其余书籍/文章/代码文档 $\rightarrow$ 返回 `["feynman"]`；
     - 当用户导入显式材料创建新课题且未显式指定 `toolkits` 时，自动调用 `defaultToolkitsForMaterial` 预填充 `topic.toolkits`（确保 Agent 介入前上传 EPUB/PDF/音视频即可直接使用对应的默认工具）。
  2. **放宽文件导入限制以支持任意代码与纯文本材料（`web/client.ts` & `obsidian/index.ts` & `stage-reader/index.ts`）**：
     - 移除文件选择器对代码/文本后缀的狭隘限制，支持导入 `.md, .markdown, .txt, .epub, .pdf, .cbz, .vtt, .srt, .ts, .tsx, .js, .py, .rs, .go, .java, .c, .cpp, .json, .yaml, .yml, .toml, .sh, .abc` 等任意常见文本/源码及图片、音视频；
     - 非 `.md` 的纯文本/源码文件在 `stage-reader` 中按行包入代码块或带 `data-locator="text:line:<N>"` 的段落渲染，保证在 Stage 中可读、可框选、可锚定。
  3. **重构首页「唯一统一立项与投喂台（Unified Intake Box）」（`src/workbench/compass.ts` & `view.ts` & `obsidian/index.ts` & `web/client.ts` & `web/server.ts`）**：
     - 按照 [`docs/subsystems/5-spatial-ui-and-slots.md`](subsystems/5-spatial-ui-and-slots.md) 第 1.1 节契约，将首页原本隐藏的死板四行表单升级为优雅常驻的统一立项台（`.pith-intake-box`）：
       - 主输入框（`input[name="title"]` 或自适应輸入框）：占位提示 `"输入想探索的课题（如：深入理解 DSH 架构），或直接添加文件 / 绑定代码仓…"`；
       - 附件与仓库操作行：`[ ＋ 添加文件 ]` 按钮、`[ 📁 绑定本地 Git 仓库 ]` 切换按钮（点开可输入本地 Git 仓库绝对路径 `repoPath`，经后端 `/api/materials/repo` 或 `host.repository.inspectRepository` 绑定为 `kind: "repo"` 材料）；
       - 两个明确动作按钮：
         1. **`[ 直接开启 → ]`**（`data-intake-open`）：创建课题（若附带材料则自动应用启发式默认 `toolkits`）并立即打开该课题；
         2. **`[ ✨ 请向导拆解立项 ]`**（`data-intake-guide`）：创建课题（默认预挂 `["feynman"]`），进入课题工作台后**自动展开右侧向导侧边栏**，并自动触发向导首轮拆课（规划《`00-课程大纲.md`》与第一讲讲义，生成后自动刷新左侧 Stage 与材料抽屉）。
  4. **顶栏 `🛠` 工具槽支持前端随时手动 CRUD 课题工具（`src/workbench/view.ts`）**：
     - 无论当前课题 `topic.toolkits` 是否为空，顶栏右侧始终显示 `#open-dojo`（已挂载工具时显示 `🛠 影子跟读` 等胶囊，未挂载时显示低调图标 `🛠`）；
     - 点击 `#open-dojo` 在顶栏右下方近源弹出的 `.pith-dojo-panel` 中，除了启动/切换当前工具外，提供已注册工具（`行间双语` / `影子跟读` / `费曼复述`）的开关切换能力（调用 `mountDojo` 或新增 `toggleToolkit` 回调更新 `topic.toolkits`），让用户与向导都能随时 CRUD 课题工具。
- **Worker 工程内环门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增单测与浏览器回归覆盖：1) 上传外文/中文/音视频/代码仓材料时自动预挂载对应的启发式默认 `toolkits`；2) 首页统一立项台绑定本地 Git 仓库并点击 `[ ✨ 请向导拆解立项 ]` 后自动进入课题、展开向导、生成《`00-课程大纲.md`》并在 Stage 显示；3) 顶栏 `🛠` 面板支持随时增删 `toolkits`；截屏存入 `.tmp/evidence/task-33/` 自检。

---

## [Task #34] 影子跟读（`shadowing`）Stage 原位声学闭环升级：单句定点播放、0.75x 慢听、单句循环与个人录音回放对比

- **Status**: pending
- **Scope**: `src/workbench/view.ts`, `src/workbench/voiceInput.ts`, `src/plugins/stage-timeline/index.ts`, `tests/**`
- **授权范围**：允许修改 `src/workbench/view.ts`、`src/workbench/voiceInput.ts`、`src/plugins/stage-timeline/index.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/`；严禁弹出脱离 Stage 目标句的独立模态对话框。
- **背景与参考代码**：参考 [`docs/subsystems/3-dojos.md`](subsystems/3-dojos.md) 第 3 节、[`docs/subsystems/5-spatial-ui-and-slots.md`](subsystems/5-spatial-ui-and-slots.md) 第 2 节以及 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/views/PracticeStudio.ts`。
- **接口与行为契约**：
  1. **句级原声定点播放、0.75x 慢速精听与单句循环（`src/workbench/view.ts` & `src/plugins/stage-timeline/index.ts`）**：
     - 当 `shadowing` 工具在 Stage 目标块（特别是时间轴 `.pith-cue[data-locator^="time:"]` 或支持 TTS 合成的正文块）原位展开 `.pith-inline-dojo[data-dojo="shadowing"]` 时，内联工具栏新增句级声学控制组：
       - **`[▶ 播放本句]`**（`data-dojo-play-cue`）：若当前材料有音频（`assetAudio`）且目标块带 `time:<start>` 与 `data-end-sec="<end>"`，从 `start` 播放至 `end` 自动停住（在 `listen-decompose` 意群拆解档位下默认以 **`0.75x` 慢速**播放，其余档位以当前倍速播放）；若无原生音频但配置了 `synthesizeSpeech`，则合成并朗读该目标句原声；
       - **`[🔁 单句循环]`**（`data-dojo-loop-cue`，带 `aria-pressed` 状态）：在当前句的 `start..end` 区间内循环复听，再次点击或切换句子/关闭内联工具时退出循环。
  2. **Stage 2 同步跟读（边放边录）与个人录音即时回放对比（`src/workbench/view.ts` & `src/workbench/voiceInput.ts`）**：
     - `VoiceInput` 在完成一次 `"dojo"` 录音时，除将音频字节送往 ASR 转写外，保留最新一次录音的 `Blob / ObjectURL`（组件销毁或重新录音时安全 `URL.revokeObjectURL`）；
     - 在 `.pith-inline-dojo[data-dojo="shadowing"]` 中，一旦用户完成录音，立即解锁显示 **`[🔊 听我的录音]`**（`data-dojo-play-recorded`）按钮，点击即可原位回放自己刚才的跟读录音，与 `[▶ 播放本句]` 原声做最直观的语调、连读与节奏对比；
     - 在 `guided-follow`（原文跟读）档位下点击录音时，若存在原生句音频则自动同步触发本句播放（边听原声领读边录音），转写完成后直接自动执行 `diagnose` 在原位标亮漏词 `<mark>`，无需用户再多余点一次“对齐漏词”。
- **Worker 工程内环门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增单测与浏览器回归覆盖：1) `.pith-cue` 原位打开影子跟读后，点击 `[▶ 播放本句]` 与 `[🔁 单句循环]` 精确控制音频在 `start..end` 区间播放与停止（`listen-decompose` 下为 `0.75x`）；2) 合成 WebAudio `MediaStream` 录音完成后，自动完成漏词对齐且 `[🔊 听我的录音]` 按钮可用并能回放录音；完成手动破壁验证并截屏存入 `.tmp/evidence/task-34/`。
