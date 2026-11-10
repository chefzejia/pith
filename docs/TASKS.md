# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；**每完成一单必须在进入下一单前立即将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #33] 显式材料启发式默认 Toolkit 挂载、首页唯一统一立项台（Unified Intake）与顶栏 Toolkit CRUD

- **Status**: verified
- **Verified-Commit**: 49215555f21870a08fcfe8ac783ff79d51be5c2f
- **Updated**: 2026-11-10
- **Scope**: `src/workbench/**`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **验收摘要**：独立 Tester 在 Web 与隔离 Obsidian 验证统一立项、仓库及无材料向导生成、材料刷新、普通聊天保持阅读、源码逐行锚点与转义、二进制拒绝、默认及显式空工具和工具增删启动持久化。最终工程门禁 254 通过、61 跳过，类型与构建通过；独立终验报告及截图：`.tmp/evidence/task-33/final-header-report.md`、`.tmp/evidence/audit-fix/final-report.md`、`.tmp/evidence/audit-fix/final-web-guide-ts.png`、`.tmp/evidence/audit-fix/final-native-guide-ts.png`。

---

## [Task #34] 影子跟读（`shadowing`）Stage 原位声学闭环升级：单句定点播放、0.75x 慢听、单句循环与个人录音回放对比

- **Status**: verified
- **Verified-Commit**: ae10fa7d27b0f86518b728d04a3ea26f46c7a3fd
- **Updated**: 2026-11-10
- **Scope**: `src/workbench/view.ts`, `src/workbench/voiceInput.ts`, `src/plugins/stage-timeline/index.ts`, `tests/**`
- **验收摘要**：独立 Tester 在 Web 与隔离 Obsidian 实测句段原声播放/停止/循环、0.75x 精听与用户倍速、切句切文件停止、开录同步领读、ASR pending/失败期间回放、成功自动漏词标记与重录 URL 释放。终验截图与报告：`.tmp/evidence/task-34/final-native-diagnosis.png`、`.tmp/evidence/task-34/final-web-diagnosis.png`、`.tmp/evidence/task-34/final-retest-native-second.png`、`.tmp/evidence/task-34/final-retest-web-second.png`、`.tmp/evidence/task-34/final-retest-report.md`。

---

## [Task #35] 全仓统一线性 SVG 图标系统（干掉 Emoji/散装符号） & 首页极简无感 Omnibox 立项台 & 向导动作胶囊去重

- **Status**: verified
- **Verified-Commit**: 093613baa44d5a863ddc236f31f466e0c243a7c0
- **Updated**: 2026-11-10
- **验收摘要**：独立 Tester 在真实 Web 与隔离 Obsidian 完成首轮及修复复验；四项仓库路径/目标/空态/动作缺陷修复通过，两轮不同 choices 仅保留最新组，无选项后恢复固定动作，文件单独导入直接阅读。终验报告及截图：`.tmp/evidence/task-35/final-retest-report.md`、`.tmp/evidence/task-35/final-retest-web-repo.png`、`.tmp/evidence/task-35/final-retest-native-lesson-actions.png`。
- **Scope**: `src/workbench/**`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **授权范围**：允许新建 `src/workbench/icons.ts`，允许修改 `src/workbench/compass.ts`、`src/workbench/view.ts`、`src/workbench/toolkitSlot.ts`、`src/shells/obsidian/index.ts`、`src/shells/web/client.ts`、`src/shells/web/server.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/`；严禁在工作台按钮中残留 `🛠`、`🎧`、`🎙️`、`📁`、`✨`、`🔁`、`🔊`、`☰`、`⚙` 等 Emoji 或散装字符图标。
- **背景与参考代码**：开工前请阅读 [`docs/subsystems/5-spatial-ui-and-slots.md`](subsystems/5-spatial-ui-and-slots.md) 第 1.1 节与 1.2 节，以及 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/docs/product/prototype/interaction.html`。
- **接口与行为契约**：
  1. **新建全仓唯一线性 SVG 图标库（`src/workbench/icons.ts`）并彻底替换 Emoji/字符图标**：
     - 创建 `src/workbench/icons.ts`，导出统一规格（`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"`）的纯净线性 SVG 图标辅助函数 `pithIcon(name: PithIconName): string`，覆盖：`menu`（左侧目录抽屉）、`chevron-left`、`chevron-right`、`sliders`（工具槽，替代 `🛠`）、`headphones`（听读，替代 `🎧`）、`type`（排版）、`compass` 或 `sparkles`（向导开关）、`plus`（添加）、`arrow-up`（发送/开启）、`settings`（设置，替代 `⚙`）、`play`、`pause`、`stop`、`repeat`（循环，替代 `🔁`）、`mic`（语音，替代 `🎙️`）、`volume`（回听录音，替代 `🔊`）、`rotate-ccw`、`rotate-cw`、`check`、`close`；
     - `toolkitSlot.ts` 的 `text` 不再拼接 Emoji `"🛠 "`（由按钮内的 `pithIcon("sliders")` + 文本呈现，保持 `toolkitSlot` 纯文本标签干净整洁，同步更新相关断言）。
  2. **重构首页「极简无感 Omnibox 立项台」（`src/workbench/compass.ts` & `obsidian/index.ts` & `web/client.ts`）**：
     - **砍掉原本分裂的 4 个按钮**（移除独立的 `📁 绑定本地 Git 仓库`、`直接开启 →`、`✨ 请向导拆解立项` 按钮及隐藏的 `repoPath` 副输入框）！
     - 将 `.pith-intake-box` 重构为优雅圆润的单一胶囊输入行（类似 Claude / Raycast 输入栏）：
       - **左侧**：一个精致的 **`[ + ]`** 图标按钮（`data-intake-files`，附带 SVG `plus` 图标，点击选择文件；同时整个 `.pith-intake-box` 支持 `dragover / drop` **拖拉拽文件直接暂存**，已暂存文件在框内显示为可移除的小胶囊标签）；
       - **中间**：自适应主输入框 `input[name="title"]`（占位符：`"输入想探索的课题、贴入本地 Git 仓库路径，或直接拖入文件…"`）；
       - **右侧**：唯一的主提交按钮 **`[ ↑ ]`**（`type="submit"`，带 `data-intake-open` 兼容属性与 SVG `arrow-up` 图标，回车或点击即提交）；
     - **后台 100% 自动嗅探与分流**：
       - **自动识别本地 Git 仓库路径**：若用户未上传文件，且输入框文本是本地文件系统路径（匹配 `/^(\/|~\/|[a-zA-Z]:[\\/])/`），自动将该文本作为 `repoPath` 调用仓库绑定接口（若路径包含 `" — "` 或空格后的课题说明也智能提取或直接将仓库路径作为 `repoPath` 检验），绑定为 `kind: "repo"` 材料，预挂载 `["feynman"]`，创建课题后自动开启向导拆课（若向导未配置则静默打开课题工作台，绝不报错阻断）；
       - **自动识别显式文件 vs 拆课意图**：若用户添加了文件且未输入额外问题，零等待直接导入文件（自动用文件名/OPF 净化标题、应用 `defaultToolkitsForMaterial`）并进入 Stage 纯净阅读（`guide: false`）；若用户仅输入了一句话课题意图（无文件、非本地路径），创建课题并当向导已配置时自动触发向导拆解课程（`guide: true`；若向导未配置则静默进入工作台）。
  3. **修复右侧向导栏“四个灰框按钮打架”与过期动作残留（`src/workbench/view.ts` & `src/plugins/guide-acp/index.ts`）**：
     - 在 `quickActionsForTopic` 中：若 `topic.material?.files` 中已经存在 `00-课程大纲.md` 或已有任何可读讲义文件，不再返回 `"规划课程大纲与第一讲"`，改为返回 `"导读这一节"` 与 `"下一讲 / 考考我"`；
     - 在 `view.ts` 的 `renderGuide()` 中：
       - **动态选项与固定动作严格去重**：当对话流最新一条向导消息已经带有非空的 `choices`（`pith-choices`）时，只将该最新消息的 `choices` 渲染为优雅的编号选项卡片列表（`.pith-choice-btn`），**此时隐藏下方的固定 `guideData.actions` 按钮组**（彻底消灭截图中 4 个灰按钮叠罗汉的乱象）；
       - 仅当当前没有活跃 `choices` 时，才将 `guideData.actions` 渲染在顶部或输入区上方的轻量胶囊栏（`.pith-quick-actions`）中，且历史旧回合的 `choices` 不再重复堆在半空中。
- **Worker 工程内环门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增单测与浏览器回归验证：1) 全仓工作台 DOM 零 Emoji 图标且 SVG 图标正常渲染；2) 首页 Omnibox 支持点击 `+`、拖拽文件、直接输入本地 Git 仓库路径自动识别绑定、输入课题自动触发拆课；3) 向导回复含 `pith-choices` 时不再重复显示底部 `quickActions`；截屏存入 `.tmp/evidence/task-35/` 自检。

---

## [Task #36] 渐进式课程拆解（Just-in-Time 逐章推进）、大纲融入左侧目录树（Curriculum TOC）与点击未生成章节即点即写

- **Status**: pending
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

## [Task #37] 影子跟读（`shadowing`）聚光灯级交互重设计（砍掉打字框/毛玻璃盲听/声波律动） & 内嵌托管 `yt-dlp` 声学语料搜索与拉取工具

- **Status**: pending
- **Scope**: `src/plugins/dojo-shadowing/**`, `src/plugins/guide-acp/**`, `src/workbench/view.ts`, `src/workbench/voiceInput.ts`, `src/shells/web/nodeMediaCorpus.ts`, `src/shells/web/server.ts`, `src/shells/obsidian/index.ts`, `tests/**`
- **授权范围**：允许新建 `src/shells/web/nodeMediaCorpus.ts`（实现 `MediaCorpusPort`），允许修改 `src/plugins/dojo-shadowing/index.ts`、`src/plugins/guide-acp/tools.ts`、`src/plugins/guide-acp/index.ts`、`src/workbench/view.ts`、`src/workbench/voiceInput.ts`、`src/shells/web/server.ts`、`src/shells/obsidian/index.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/`；严禁在影子跟读界面保留丑陋的 `<textarea>` 复述文本框、多余的“对齐漏词”按钮或死板的 `"••••••••"` 黑点字符串。
- **背景与参考代码**：开工前请阅读 [`docs/subsystems/3-dojos.md`](subsystems/3-dojos.md) 第 3 节、[`docs/subsystems/4-guide-speech-shells.md`](subsystems/4-guide-speech-shells.md) 第 2.4 节，以及 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/docs/product/prototype/interaction.html`（第 450~603 行与 1044~1101 行）。
- **接口与行为契约**：
  1. **重做影子跟读（`shadowing`）聚光灯级 UI 与原位动效（`src/workbench/view.ts` & `src/plugins/dojo-shadowing/index.ts`）**：
     - **彻底砍掉影子跟读里的 `<textarea>` 复述打字框与“对齐漏词”按钮**（注意：`feynman` 费曼复述仍然保留阐述输入框；`shadowing` 影子跟读完全走声学跟读闭环）！
     - **聚光灯目标句渲染与原位四阶视觉变形**：
       - 当激活某句跟读时，当前目标块升级为有呼吸感的**聚光灯卡片（`.pith-shadowing-spotlight`）**，台词字号放大至 `21px~22px`（衬线字体 `var(--pith-serif)`，行高 `1.85`），其余非激活时间轴台词柔和退暗（`opacity: 0.55`）；
       - **顶部极简分段滑块（Segmented Lens Bar）**：左侧胶囊滑块切换 `[ 韵律 | 原文 | 骨干 | 盲听 ]`（`data-dojo-stage`），右侧仅一个无边框关闭图标按钮 `×`（`data-dojo-close`）：
         - `listen-decompose`（韵律）：意群分隔符 `/` 渲染为柔和陶土色视觉斜杠 `<span class="pith-chunk-slash">/</span>`；
         - `scaffold-cloze`（骨干）：弱读功能词渲染为精致虚线槽位 `<span class="pith-cloze-slot">___</span>`；
         - `blind-produce`（盲听）：**保留真实原句文本但施加毛玻璃高斯模糊 CSS 动效**（`.pith-blind-mask { filter: blur(6px); user-select: none; transition: filter .25s ease }`，悬停或完成录音后平滑散开雾气 `filter: none`），同时确保 `transformCue(text, "blind-produce")` 或 DOM 渲染既满足无剧透盲听，又充满设计质感；
         - **录完音自动原位染色反馈**：录音转写完成后自动执行 `diagnose`，直接在聚光灯大号原句上将匹配的词保持清晰、漏读词（`missedTokens`）以柔和陶土底色 + 波浪下划线（`.pith-diff-miss` / `<mark>`）原位高亮，并在底部展示简短转写识别结果与准确度贴合提示。
       - **底部极简三区声学控制坞（`.pith-shadowing-dock`）**：
         - 左区：线性图标按钮 **`[ ▶ 原声 ]`**（`data-dojo-play-cue`，`listen-decompose` 下自动带 `0.75x` 慢听标记）+ **`[ 🔁 循环 ]`**（`data-dojo-loop-cue`）；
         - 中区（视觉焦点）：圆润鼠尾草绿主胶囊按钮 **`[ ● 开口跟读 ]`**（`data-voice="dojo"`，录音中变为律动声波条动画 `.pith-mic-wave` + `"停止跟读"`）；
         - 右区：录完音后平滑显现 **`[ 🔊 回听对比 ]`**（`data-dojo-play-recorded`）与 **`[ ✓ 记入账本 ]`**（`data-dojo-save`）。
  2. **内嵌托管 `yt-dlp` 媒体语料搜索与拉取能力（`src/shells/web/nodeMediaCorpus.ts` & `src/plugins/guide-acp/tools.ts`）**：
     - 实现 `NodeMediaCorpusPort`（`src/shells/web/nodeMediaCorpus.ts`）：
       - 自动探测宿主机 PATH（如 `/opt/homebrew/bin/yt-dlp`、`/usr/local/bin/yt-dlp`）或 `~/Library/Application Support/pith/bin/yt-dlp`（或 `PITH_YTDLP_PATH` 环境变量覆盖）；若未安装且需要执行时，支持按平台从 GitHub Releases 官方地址按需下载独立二进制至 `~/Library/Application Support/pith/bin/yt-dlp`（带超时与权限设置 `0o755`）；
       - `searchMedia(query, limit = 5)`：调用 `yt-dlp "ytsearch<limit>:<query>" --dump-json --flat-playlist --no-warnings` 解析候选音视频列表（`id, title, url, durationSec, uploader`）；
       - `fetchMediaCorpus(url, options)`：经公网 URL 校验后，在临时目录调用 `yt-dlp` 提取轻量音频（如 `-f "ba[filesize<25M]/ba" -x --audio-format mp3` 或直接下载小体积音轨）及字幕（`--write-subs --write-auto-subs --sub-langs "en.*,zh.*" --sub-format vtt`），组装为 `MediaCorpusBundle`（含音频文件与 `.vtt` 字幕文件；若目标视频仅提取到字幕或仅提取到音频也优雅返回对应文件与 `warnings`）；
     - 在 `createGuideWorkspaceTools`（`src/plugins/guide-acp/tools.ts`）中向 Agent 暴露两个新工具（当 `host.mediaCorpus` 可用时注册）：
       - **`pith_search_media`**：参数 `{ query, limit? }`，供向导在用户想练外语听说但没有现成材料时，主动搜索 3~5 个演讲/播客候选；
       - **`pith_fetch_media_corpus`**：参数 `{ topicId, url, lang? }`，拉取音轨与时间轴字幕导入当前 Topic 的 `Material` 包，并自动为该 Topic 挂载 `["shadowing"]` 工具；
     - 在 `buildScenePrompt` 中补充说明：当课题涉及外语听力/口语跟读且尚无音视频材料时，向导可使用 `pith_search_media` 搜索语料或用 `pith_fetch_media_corpus` 将用户提供的视频/播客链接拉取为带时间轴字幕的跟读材料。
- **Worker 工程内环门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增单测与浏览器回归验证：1) 影子跟读展开后无 `<textarea>` 打字框，呈现 21px+ 大字号聚光灯台词、分段镜头滑块、毛玻璃盲听遮罩、录音律动胶囊与录完自动原位漏词高亮；2) `NodeMediaCorpusPort` 与 `pith_search_media` / `pith_fetch_media_corpus` 工具契约验证（使用受控本地 `PITH_YTDLP_PATH` 模拟脚本验证搜索 JSON 解析、音频+VTT 字幕提取入库及自动挂载 `shadowing`）；截屏存入 `.tmp/evidence/task-37/` 自检。
