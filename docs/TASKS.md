# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；**每完成一单必须在进入下一单前立即将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #36] 渐进式课程拆解（Just-in-Time 逐章推进）、大纲融入左侧目录树（Curriculum TOC）与点击未生成章节即点即写

- **Status**: verified
- **Verified-Commit**: daeeb44fc82379c094171e29fec805bfb64854bd
- **Updated**: 2026-11-10
- **Scope**: `src/plugins/guide-acp/**`, `src/plugins/stage-reader/**`, `src/workbench/view.ts`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **验收摘要**：渐进课程解析、按需生成、目录状态与草稿保持已独立复验；Web 窄屏生成反馈及 Obsidian 长标题目录修复通过。最终报告：`.tmp/evidence/task-36/final-directory-retest-report.md`；截图：`.tmp/evidence/task-36/final-directory-native-700-light.png`、`.tmp/evidence/task-36/final-directory-native-700-dark.png`、`.tmp/evidence/task-36/final-directory-web-390.png`。

---

## [Task #37] 影子跟读（`shadowing`）聚光灯级交互重设计 & 砍掉通用打字框“语音输入”按钮（麦克风仅归属声学实训） & 内嵌托管 `yt-dlp` 声学语料搜索与拉取工具

- **Status**: verified
- **Verified-Commit**: 59d285e813bd7eb97f6e294cd5b2d72bf071d48c
- **Updated**: 2026-11-10
- **Scope**: `src/plugins/dojo-shadowing/**`, `src/plugins/guide-acp/**`, `src/workbench/view.ts`, `src/workbench/voiceInput.ts`, `src/shells/web/nodeMediaCorpus.ts`, `src/shells/web/server.ts`, `src/shells/obsidian/index.ts`, `tests/**`
- **验收摘要**：独立 Tester 在 Web 与隔离 Obsidian 按原契约验证四镜头、录音转写与漏词反馈、回听保存、原声慢放循环、搜索、已有材料追加和新材料绑定；实际打开字幕并播放新增音轨，保留原材料身份与讲义。报告：`.tmp/evidence/task-37/final-report.md`；截图：`.tmp/evidence/task-37/final-native-shadowing-light.png`、`.tmp/evidence/task-37/final-web-narrow-dark.png`、`.tmp/evidence/task-37/final-native-import-audio.png`。磁盘字节断言审计整改 `a0f6442` 已独立闭环。

---

## [Task #38] Web 端系统主题对齐（干掉绿底色与卡片折行微瑕） & 统一播放控制底座（Unified Transport Dock：砍掉正文原生 `<audio>` 与 `A-B` 冗余、视频/音频/跟读单一进度条联动）

- **Status**: pending
- **Scope**: `src/shells/web/server.ts`, `src/plugins/stage-timeline/index.ts`, `src/workbench/view.ts`, `src/workbench/compass.ts`, `src/workbench/mediaAssets.ts`, `tests/**`
- **授权范围**：允许修改 `src/shells/web/server.ts`、`src/plugins/stage-timeline/index.ts`、`src/workbench/view.ts`、`src/workbench/compass.ts`、`src/workbench/mediaAssets.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/`；严禁在音频时间轴舞台的正文中再渲染第二个 `<audio controls>` 播放器或 `"A-B 循环未设置"` 文本；严禁在底部播放底座保留晦涩的手动 `A-B` 按钮。
- **背景与参考代码**：开工前请阅读 [`docs/subsystems/2-stages.md`](subsystems/2-stages.md) 第 5 节与 [`docs/subsystems/5-spatial-ui-and-slots.md`](subsystems/5-spatial-ui-and-slots.md) 第 1.2 节、第 3 节。
- **接口与行为契约**：
  1. **Web 端视觉对齐系统/Obsidian/DSH 原生中性色 & 修复课题卡片日期折行（`src/shells/web/server.ts` & `src/workbench/view.ts` & `src/workbench/compass.ts`）**：
     - 在 `src/shells/web/server.ts` 的 `APP` 样式中，**彻底删除第 431~432 行覆写的发绿背景色**（`#f7f8f6 / #edf0ed` 与 `#202622 / #2a322d`），使独立 Web 端 100% 跟随纯净的系统/宿主中性色（Light 模式：`--background-primary: #ffffff; --background-secondary: #f6f6f7; --background-modifier-border: #e4e4e7; --background-modifier-hover: #ececef; --text-normal: #18181b; --text-muted: #71717a; --text-faint: #a1a1aa`；Dark 模式：`--background-primary: #18181b; --background-secondary: #202024; --background-modifier-border: #34343a; --background-modifier-hover: #2c2c32; --text-normal: #e4e4e7; --text-muted: #a1a1aa; --text-faint: #71717a`），并在 `workbenchStyles` 中支持优先读取 `--dsh-bg / --dsh-fg` 等宿主变量回退至 `--background-primary / --text-normal`；
     - 在 `.pith-card-top time` 上增加 `white-space: nowrap; flex-shrink: 0`，确保当课题挂载了 3 个工具标签时，右侧日期（如 `2026/11/10`）永远一行完整展示，绝不被挤断成两行。
  2. **砍掉正文原生 `<audio controls>` 与 `A-B 循环未设置` 冗余，收敛为全系统唯一的底部播放控制底座（`src/plugins/stage-timeline/index.ts` & `src/workbench/view.ts` & `src/workbench/mediaAssets.ts`）**：
     - 在 `stage-timeline/index.ts` 的 `renderTimelineView`（以及 `server.ts` 的回退渲染）中：
       - **彻底移除 `.pith-loop-status`（`"A-B 循环未设置"`）节点**；
       - 当 `mediaKind === "audio"` 时，**不在正文顶部渲染 `<audio controls>` 标签**（音频统一由底部 `.pith-media-deck` 控制，消除页面上下两个播放器的丑陋重复）；
       - 当 `mediaKind === "video"` 时，在正文顶部渲染无原生控制条的纯净视频画面 `<video class="pith-timeline-video" playsinline preload="metadata" src="..."></video>`，且 `view.ts` 在检测到页面存在 `.pith-timeline-video`（或视频媒体文件 `videoContentType`）时，将底部 `.pith-media-deck` 直接绑定驱动该 `<video>` 元素（使视频、音频、TTS 伴读与跟读 100% 共用底部同一个 `.pith-media-deck` 控制底座和同一条进度条）！
  3. **重做底部统一播放控制底座（`.pith-media-deck`）的视觉设计与进度条字幕联动（`src/workbench/view.ts`）**：
     - **砍掉底部底座上的 `[A-B]` 按钮**（句段循环已由影子跟读聚光灯坞的 `[循环]` 与语义切片自然承担）；
     - 升级 `.pith-media-deck` 为现代克制的播放控制栏（高 `48px`，内边距 `8px 16px`，左侧为圆润的播放/暂停主按钮 + 等宽数字时间 `00:01 / 00:12` `font-variant-numeric: tabular-nums`，中间为带语义切片/字幕句刻度点容器 `.pith-deck-track` 的自定义外观进度条 `.pith-media-seek`，右侧为 `-15s`、`+15s`、`1.0x` 倍速胶囊与关闭按钮）；
     - **进度条刻度与字幕/聚光灯双向同步（影视字幕级体验）**：
       - 当时间轴包含 `.pith-cue[data-locator^="time:"]` 时，在底部进度条轨道 `.pith-deck-track` 上按每段字幕/切片的 `startSec / duration` 百分比渲染轻量刻度锚点（`.pith-deck-marker[data-cue-start]`）；
       - **点击或拖动底部进度条（或点击进度条上的刻度点）到任意时间点时**：不仅媒体 `currentTime` 跳转到该位置，主舞台自动定位高亮对应的 `.pith-cue.pith-speech-active`；**若当前正处于 `shadowing` 影子跟读激活态，聚光灯卡片自动无缝切换到该时间点对应的字幕句**！
- **Worker 工程内环门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；更新旧单测中对 `renderTimelineView` 里 `<audio controls` / `A-B 循环未设置` / `[data-media="loop"]` 的过时断言；新增单测与浏览器回归验证：1) Web 端亮暗背景为纯净中性色且卡片日期不折行；2) 音频时间轴无顶部 `<audio controls>` 与 `A-B` 文字，视频时间轴画面由底部统一底座控制；3) 拖动/点击底部唯一进度条（或刻度点）时，自动聚焦对应字幕句并同步切换影子跟读聚光灯目标句；截屏存入 `.tmp/evidence/task-38/` 自检。

---

## [Task #39] 长音视频跟读旅程闭环：`yt-dlp` 视频/音频双模态拉取 + 无字幕自动本地 ASR 转写生成 `.vtt` + 语义切片（`MediaCorpusSlice`）自动编排

- **Status**: blocked
- **阻塞证据**：所需 `MediaCorpusSlice` 与 `MediaCorpusBundle.slices` 尚未出现在已提交核心接口中，仅存在于上游未提交改动；本单禁止修改 `src/core/`。详见 `.tmp/evidence/task-39/blocker-report.md`。上游提交接口与相关契约并重新置 pending 后恢复。
- **Scope**: `src/shells/web/nodeMediaCorpus.ts`, `src/plugins/guide-acp/tools.ts`, `src/plugins/guide-acp/index.ts`, `src/shells/web/server.ts`, `src/shells/obsidian/index.ts`, `tests/**`
- **授权范围**：允许修改 `src/shells/web/nodeMediaCorpus.ts`、`src/plugins/guide-acp/tools.ts`、`src/plugins/guide-acp/index.ts`、`src/shells/web/server.ts`、`src/shells/obsidian/index.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/`。
- **背景与参考代码**：开工前请阅读 [`docs/subsystems/4-guide-speech-shells.md`](subsystems/4-guide-speech-shells.md) 第 2.4 节与 `src/core/host.ts` 中的 `MediaCorpusSlice`、`MediaCorpusBundle` 接口定义。
- **接口与行为契约**：
  1. **支持视频流（`.mp4/.webm`）与音频流拉取 + 无外挂字幕时自动调用 ASR 生成 `.vtt` 字幕（`src/shells/web/nodeMediaCorpus.ts` & 各 Shell）**：
     - 升级 `NodeMediaCorpusPort`：
       - 在 `fetchMediaCorpus` 中支持提取轻量视频（如 `mp4/webm` $\le 25\text{MB}$）或音频轨（`m4a/mp3/webm/opus`）及 `.vtt` 字幕；
       - **无字幕自动 ASR 补齐**：允许在构造 `NodeMediaCorpusPort` 时注入可选的 `transcribeAudio?: (bytes: Uint8Array, mimeType: string, signal?: AbortSignal) => Promise<{ readonly text: string; readonly durationSec?: number }>` 回调（在 `server.ts` 与 `obsidian/index.ts` 中接入当前配置的 `speech.asr` 服务）；当 `yt-dlp` 下载了音视频文件但未能获取到 `.vtt` 字幕文件、且 `transcribeAudio` 可用时，自动调用 `transcribeAudio` 将音频转写为文本，并按自然句读切分生成带时间戳的标准 WebVTT 字幕文件（`<stem>.auto.vtt`）一并收入 `bundle.files`！
  2. **自动按自然语义与时长（30~60s）生成原子跟读切片 `slices: MediaCorpusSlice[]`（`src/shells/web/nodeMediaCorpus.ts` & `src/plugins/guide-acp/tools.ts`）**：
     - 新增导出纯函数 `buildMediaCorpusSlices(vttText: string, targetSliceSec = 45): MediaCorpusSlice[]`：
       - 解析 `.vtt` 中的时间轴字幕句，按自然句末标点与时长阈值（每段约 `25s ~ 60s`）将长音视频切分为有序的 `MediaCorpusSlice[]`（每项含 `id: "slice-1"`, `title: "片段 1 (00:00 - 00:42)"`, `startSec`, `endSec`, `cueCount`, `text`）；
     - `fetchMediaCorpus` 在拿到或生成 `.vtt` 后，自动调用 `buildMediaCorpusSlices` 计算并填充 `bundle.slices`；
     - 在 `pith_fetch_media_corpus`（`src/plugins/guide-acp/tools.ts`）执行时：
       - 除了将音视频与 `.vtt` 写入课题 `Material` 并自动挂载 `["shadowing"]` 外，若 `bundle.slices?.length` 非空，自动生成一份《`00-跟读切片导读.md`》（列出所有语义切片的时间区间、核心台词预览与跟读建议）写入该 `Material`；
       - 工具返回值中包含 `slices` 摘要，且在 `server.ts` / `obsidian/index.ts` 处理向导工具完成后，前端若检测到当前课题新增了 `.vtt` 字幕材料，自动打开该时间轴视图，让用户零摩擦开启影子跟读旅程！
- **Worker 工程内环门禁**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增单测与回归验证：1) `buildMediaCorpusSlices` 将长 VTT 字幕按语义与时长切分为 `MediaCorpusSlice[]`；2) 当 `yt-dlp` 仅返回音频无字幕时，自动通过注入的 `transcribeAudio`（ASR）生成 `.vtt` 字幕并切出 `slices`；3) `pith_fetch_media_corpus` 自动生成《`00-跟读切片导读.md`》、保存音视频+VTT 并挂载 `shadowing`；完成手动破壁验证并归档证据至 `.tmp/evidence/task-39/`。
