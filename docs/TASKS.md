# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；**每完成一单必须在进入下一单前立即将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #35] 全仓统一线性 SVG 图标系统（干掉 Emoji/散装符号） & 首页极简无感 Omnibox 立项台 & 向导动作胶囊去重

- **Status**: verified
- **Verified-Commit**: 093613baa44d5a863ddc236f31f466e0c243a7c0
- **Updated**: 2026-11-10
- **Scope**: `src/workbench/**`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **验收摘要**：独立 Tester 在真实 Web 与隔离 Obsidian 完成首轮及修复复验；四项仓库路径/目标/空态/动作缺陷修复通过，两轮不同 choices 仅保留最新组，无选项后恢复固定动作，文件单独导入直接阅读。终验报告及截图：`.tmp/evidence/task-35/final-retest-report.md`、`.tmp/evidence/task-35/final-retest-web-repo.png`、`.tmp/evidence/task-35/final-retest-native-lesson-actions.png`。

---

## [Task #36] 渐进式课程拆解（Just-in-Time 逐章推进）、大纲融入左侧目录树（Curriculum TOC）与点击未生成章节即点即写

- **Status**: in_progress
- **Scope**: `src/plugins/guide-acp/**`, `src/plugins/stage-reader/**`, `src/workbench/view.ts`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **授权范围**：允许修改 `src/plugins/guide-acp/index.ts`、`src/plugins/guide-acp/tools.ts`、`src/plugins/stage-reader/pagination.ts`、`src/workbench/view.ts`、`src/shells/obsidian/index.ts`、`src/shells/web/server.ts`、`src/shells/web/workbench.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/`；严禁在首轮一次性生成全部章节的正文（必须逐章按需推进）。
- **接口与行为契约**：
  1. **渐进式课程大纲格式契约与 Prompt 升级（`src/plugins/guide-acp/index.ts`）**：
     - 升级 `buildScenePrompt` 中的课程拆解规则：要求向导在拆解庞大课题或代码仓库时，**严禁一次性写完所有章节**，而是采用**渐进式拆解（Progressive Curriculum）**：
       - 第一步：写入《`00-课程大纲.md`》，其中用标准 Markdown 任务/章节列表明确列出 3~6 讲的文件名与标题及一句话目标，标准格式为：
         `- [01-xxx.md] 第 1 讲标题：核心目标说明`
         `- [02-xxx.md] 第 2 讲标题：核心目标说明`
       - 第二步：首轮仅生成第一讲（如 `01-xxx.md`），后续章节在用户学完上一讲或点击目录中的待生成章节时按需生成。
  2. **课程大纲与左侧目录抽屉（`.pith-left-drawer`）合二为一（`src/plugins/stage-reader/pagination.ts` & `src/workbench/view.ts` & 各 Shell）**：
     - 新增辅助解析函数 `parseCurriculumOutline(outlineMarkdown: string, existingFiles: readonly string[]): CurriculumItem[]`，从材料包中的 `00-课程大纲.md` 解析出规划的课程章节列表（识别 `- [02-xxx.md] 标题`、`1. 02-xxx.md 标题` 或指向 `.md` 讲义文件名的标准章节链接等常见大纲格式），并与 `material.files` 比对标记每讲是 **`status: "ready"`（已生成）** 还是 **`status: "planned"`（待生成）**；
     - 在左侧导航抽屉（`.pith-left-drawer`）中：
       - 当材料包存在课程大纲（`00-课程大纲.md`）时，将课程章节与当前章内小节树（TOC）融合展示为清晰的 **「课程目录」**：
         - 已生成的章节（`ready`）正常显示标题（当前正在阅读的章节自动高亮并展开其内部 `h2/h3` 小节目录树）；
         - 尚未生成的章节（`planned`）以柔和虚线/半透明样式展示，右侧带有轻量胶囊标签 **`待生成`**（`data-planned-lesson="<fileName>"`、`data-planned-title="<title>"`）。
  3. **点击未生成章节时“即点即写（On-Demand Lesson Generation）”**：
     - 当用户在左侧抽屉直接点击某个标记为 `待生成` 的后续章节（如点击 `03-runtime.md · 插件运行时`）时：
       1. 自动收起左侧导航抽屉；
       2. 主舞台（`.pith-article`）立即切换为优雅的**课程生成过渡态**（展示章节标题 + `"向导正在结合课程大纲与源码为你撰写本讲讲义…"` 状态提示）；
       3. 自动展开右侧向导并调用向导发送精确生成指令（如 `"请按照《00-课程大纲.md》的规划，结合我的学习者画像与源码/材料依据，撰写《03-runtime.md》（插件运行时）的完整讲义并调用 pith_write_lesson 保存。"`）；
       4. 向导完成 `pith_write_lesson` 落盘后，前端自动切换到刚生成的 `03-runtime.md` 并渲染其正文，同时左侧目录抽屉中该章状态自动变为已生成（`ready`）！
- **Worker 工程内环门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增单测与浏览器回归覆盖：1) `parseCurriculumOutline` 准确解析《`00-课程大纲.md`》并区分 `ready` 与 `planned` 章节；2) 在 Web 与 Obsidian 中打开含大纲的课题，左侧目录抽屉融合展示已生成章节与 `待生成` 章节；3) 点击 `待生成` 的第 2/3 讲时，触发向导生成对应 `.md` 文件并自动在 Stage 打开渲染；截屏存入 `.tmp/evidence/task-36/` 自检。

---

## [Task #37] 影子跟读（`shadowing`）聚光灯级交互重设计 & 砍掉通用打字框“语音输入”按钮（麦克风仅归属声学实训） & 内嵌托管 `yt-dlp` 声学语料搜索与拉取工具

- **Status**: pending
- **Updated**: 2026-11-10
- **上游阻塞已解除说明**：`src/core/store/contract.ts` 与 `WorkspaceStore.ts` 已新增并冻结 `store.appendMaterialFiles(materialId, files)`，支持向当前已有 `Material` 安全追加音轨与 `.vtt` 字幕文件并一致更新清单（同名冲突直接拒绝覆盖原始文件）。
- **Scope**: `src/plugins/dojo-shadowing/**`, `src/plugins/guide-acp/**`, `src/workbench/view.ts`, `src/workbench/voiceInput.ts`, `src/shells/web/nodeMediaCorpus.ts`, `src/shells/web/server.ts`, `src/shells/obsidian/index.ts`, `tests/**`
- **授权范围**：允许新建 `src/shells/web/nodeMediaCorpus.ts`（实现 `MediaCorpusPort`），允许修改 `src/plugins/dojo-shadowing/index.ts`、`src/plugins/guide-acp/tools.ts`、`src/plugins/guide-acp/index.ts`、`src/workbench/view.ts`、`src/workbench/voiceInput.ts`、`src/shells/web/server.ts`、`src/shells/obsidian/index.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/`；**严禁在右侧向导侧边栏（`.pith-guide-compose`）或费曼复述（`feynman`）的文本输入框旁保留通用的“语音输入”麦克风按钮**；严禁在影子跟读界面保留 `<textarea>` 复述文本框、多余的“对齐漏词”按钮或死板的 `"••••••••"` 黑点字符串。
- **背景与参考代码**：开工前请阅读 [`docs/subsystems/3-dojos.md`](subsystems/3-dojos.md) 第 3 节、[`docs/subsystems/4-guide-speech-shells.md`](subsystems/4-guide-speech-shells.md) 第 2.4 节、[`docs/subsystems/5-spatial-ui-and-slots.md`](subsystems/5-spatial-ui-and-slots.md) 第 1.2 节与第 2 节，以及 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/docs/product/prototype/interaction.html`（第 450~603 行与 1044~1101 行）。
- **接口与行为契约**：
  1. **彻底砍掉通用打字框的“语音输入”按钮，将麦克风收敛为专属声学训练传感器（`src/workbench/view.ts` & `src/workbench/voiceInput.ts` & `tests/**`）**：
     - **核心产品原则**：普通文本输入（向导对话/记笔记、`feynman` 费曼阐述）用户可直接调用操作系统输入法，不需要 Pith 画蛇添足塞一个“语音输入”按钮；Pith 内的麦克风录制是**专属的具身声学训练动作**，**100% 仅存在于 `shadowing`（影子跟读）的原位声学坞中**！
     - 在 `view.ts` 的 `renderGuide()` 中：**彻底移除 `<button type="button" data-voice="guide">...语音输入</button>`**！将 `.pith-guide-compose` 排版优化为干净紧凑的底栏（上方可选引用预览 `blockquote` + 错误提示 + 文本框与右下角/右侧精致的发送按钮 `[ 发送 ]`）；
     - 在 `view.ts` 的 `renderDojo()` 中：当 `toolkit.id === "feynman"`（或 `toolkit.evalMode === "guide-rubric"`）时，仅渲染纯文本阐述 `<textarea data-dojo-produced>` 与 `[提交复述并请向导追问]` 按钮，**不渲染任何 `data-voice` 麦克风按钮**；
     - 同步更新 `tests/task17-voice-browser.test.ts` 与 `tests/task23-shared-web-browser.test.ts` 等旧单测中针对 `.pith-guide [data-voice="guide"]` 的断言，使其改为验证 `shadowing` 原位声学坞中的 `[data-voice="dojo"]` 麦克风跟读闭环（并断言 `.pith-guide [data-voice]` 数量为 `0`）。
  2. **重做影子跟读（`shadowing`）聚光灯级 UI 与原位动效（`src/workbench/view.ts` & `src/plugins/dojo-shadowing/index.ts`）**：
     - **彻底砍掉影子跟读里的 `<textarea>` 复述打字框与“对齐漏词”按钮**（`shadowing` 影子跟读完全走声学跟读闭环）！
     - **聚光灯目标句渲染与原位四阶视觉变形**：
       - 当激活某句跟读时，当前目标块升级为有呼吸感的**聚光灯卡片（`.pith-shadowing-spotlight`）**，台词字号放大至 `21px~22px`（衬线字体 `var(--pith-serif)`，行高 `1.85`），其余非激活时间轴台词柔和退暗（`opacity: 0.55`）；
       - **顶部极简分段滑块（Segmented Lens Bar）**：左侧胶囊滑块切换 `[ 韵律 | 原文 | 骨干 | 盲听 ]`（`data-dojo-stage`），右侧仅一个无边框关闭图标按钮 `×`（`data-dojo-close`）：
         - `listen-decompose`（韵律）：意群分隔符 `/` 渲染为柔和陶土色视觉斜杠 `<span class="pith-chunk-slash">/</span>`；
         - `scaffold-cloze`（骨干）：弱读功能词渲染为精致虚线槽位 `<span class="pith-cloze-slot">___</span>`；
         - `blind-produce`（盲听）：**保留真实原句文本但施加毛玻璃高斯模糊 CSS 动效**（`.pith-blind-mask { filter: blur(6px); user-select: none; transition: filter .25s ease }`，悬停或完成录音后平滑散开雾气 `filter: none`）；
         - **录完音自动原位染色反馈**：录音转写完成后自动执行 `diagnose`，直接在聚光灯大号原句上将匹配的词保持清晰、漏读词（`missedTokens`）以柔和陶土底色 + 波浪下划线（`.pith-diff-miss` / `<mark>`）原位高亮，并在底部展示简短转写识别结果与准确度贴合提示。
       - **底部极简三区声学控制坞（`.pith-shadowing-dock`）**：
         - 左区：线性图标按钮 **`[ 原声 ]`**（`data-dojo-play-cue`，`listen-decompose` 下自动带 `0.75x` 慢听标记）+ **`[ 循环 ]`**（`data-dojo-loop-cue`）；
         - 中区（视觉焦点 · 全工作台唯一的麦克风训练入口）：圆润鼠尾草绿主胶囊按钮 **`[ 开口跟读 ]`**（`data-voice="dojo"`，录音中变为律动声波条动画 `.pith-mic-wave` + `"停止跟读"`）；
         - 右区：录完音后平滑显现 **`[ 回听对比 ]`**（`data-dojo-play-recorded`）与 **`[ 记入账本 ]`**（`data-dojo-save`）。
  3. **内嵌托管 `yt-dlp` 媒体语料搜索与拉取能力（`src/shells/web/nodeMediaCorpus.ts` & `src/plugins/guide-acp/tools.ts`）**：
     - 实现 `NodeMediaCorpusPort`（`src/shells/web/nodeMediaCorpus.ts`）：
       - 自动探测宿主机 PATH（如 `/opt/homebrew/bin/yt-dlp`、`/usr/local/bin/yt-dlp`）或 `~/Library/Application Support/pith/bin/yt-dlp`（或 `PITH_YTDLP_PATH` 环境变量覆盖）；若未安装且需要执行时，支持按平台从 GitHub Releases 官方地址按需下载独立二进制至 `~/Library/Application Support/pith/bin/yt-dlp`（允许跟随 GitHub Releases 下载重定向，带超时与权限设置 `0o755`）；
       - `searchMedia(query, limit = 5)`：调用 `yt-dlp "ytsearch<limit>:<query>" --dump-json --flat-playlist --no-warnings` 解析候选音视频列表（`id, title, url, durationSec, uploader`）；
       - `fetchMediaCorpus(url, options)`：经公网 URL 校验后，在临时目录调用 `yt-dlp` 提取轻量音频（如 `-f "ba[filesize<25M]/ba" -x --audio-format mp3` 或直接下载小体积音轨）及字幕（`--write-subs --write-auto-subs --sub-langs "en.*,zh.*" --sub-format vtt`），组装为 `MediaCorpusBundle`；
     - 在 `createGuideWorkspaceTools`（`src/plugins/guide-acp/tools.ts`）中向 Agent 暴露两个新工具（当 `host.mediaCorpus` 可用时注册）：
       - **`pith_search_media`**：参数 `{ query, limit? }`，供向导在用户想练外语听说但没有现成材料时，主动搜索 3~5 个演讲/播客候选；
       - **`pith_fetch_media_corpus`**：参数 `{ topicId, url, lang? }`，若该 Topic 已有 `materialId` 则调用 `store.appendMaterialFiles(topic.materialId, bundle.files)` 追加音轨与时间轴字幕，若尚无 `materialId` 则调用 `store.importMaterial` 创建并绑定，同时自动为该 Topic 挂载 `["shadowing"]` 工具；
     - 在 `buildScenePrompt` 中补充说明：当课题涉及外语听力/口语跟读且尚无音视频材料时，向导可使用 `pith_search_media` 搜索语料或用 `pith_fetch_media_corpus` 将用户提供的视频/播客链接拉取为带时间轴字幕的跟读材料。
- **Worker 工程内环门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增单测与浏览器回归验证：1) 向导栏与费曼复述框中彻底无 `语音输入` 麦克风按钮，麦克风仅存在于 `shadowing` 聚光灯声学坞中；2) 影子跟读展开后无 `<textarea>` 打字框，呈现 21px+ 大字号聚光灯台词、分段镜头滑块、毛玻璃盲听遮罩、录音律动胶囊与录完自动原位漏词高亮；3) `NodeMediaCorpusPort` 与 `pith_search_media` / `pith_fetch_media_corpus` 工具（含对已有 Material 调用 `appendMaterialFiles` 与无 Material 新建）验证通过；截屏存入 `.tmp/evidence/task-37/` 自检。
