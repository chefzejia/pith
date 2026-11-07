# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；**每完成一单必须在进入下一单前立即将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #23] 四层架构根本手术：清空 `src/shells/` 根目录残余散装文件 & 建立全 Shell 共享图形工作台层（`src/workbench/`）

- **Status**: verified
- **Scope**: `src/core/**`, `src/plugins/**`, `src/workbench/**`, `src/shells/**`, `scripts/**`, `tests/**`, `docs/subsystems/**`
- **Verified-Commit**: df3806d
- **Updated**: 2026-11-07
- **验收摘要**：已由 `8e411ca`、`9dd536d`、`df3806d` 完成四层单向架构 `src/workbench/` 抽离、`src/shells/` 根目录散装 `.ts` 清零与 `src/shells/web/client.ts` 强类型前端包改造，并通过双壳真机验收（截图归档于 `.tmp/evidence/task-23/`）。

---

## [Task #24] 将 Dojo 实训彻底原位映射到 Stage 画布段落/字幕块上（废除右上角大弹窗与费曼假四阶按钮）

- **Status**: verified
- **Scope**: `src/plugins/dojo-feynman/**`, `src/plugins/dojo-shadowing/**`, `src/workbench/**`, `src/shells/**`, `tests/**`, `docs/subsystems/**`
- **Verified-Commit**: b5be043
- **Updated**: 2026-11-07
- **验收摘要**：已由 `2b8acbe`、`cbacf8b`、`b5be043` 落地 Stage 原位费曼与跟读实训卡，修复记账误标原文高亮与选区浮动菜单残留，通过 Web 与隔离 Obsidian 终验（截图归档于 `.tmp/evidence/task-24/`）。

---

## [Task #25] 课题看板（Topic Board）视觉打磨、时间轴 `.pith-cue` 时间戳原位保留与右上角轻菜单收口

- **Status**: verified
- **Scope**: `src/workbench/**`, `src/plugins/stage-timeline/**`, `tests/**`
- **Verified-Commit**: 2daebd8
- **Updated**: 2026-11-07
- **验收摘要**：Worker 通过类型检查、全仓测试（218 通过、44 跳过）、构建与手动破壁；Tester 在 Web 与隔离 Obsidian 复验看板、悬停对比、设置入口、工具菜单及字幕时间戳，截图归档于 `.tmp/evidence/task-25/`。未重测实际语音或设置项持久化。
- **授权范围**：允许修改 `src/workbench/compass.ts`、`src/workbench/view.ts`、`src/plugins/stage-timeline/index.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/` 冻结契约；严禁在 `.tmp/evidence/` 中将 JPEG 字节保存为 `.png` 后缀（截图文件扩展名必须与真实图像编码格式严格一致）。
- **接口与行为契约**：
  1. **课题看板（`Topic Board`）顶栏与操作控件书卷级打磨（`src/workbench/compass.ts` & `src/workbench/view.ts`）**：
     - 顶栏 `.pith-view-header` 中的设置按钮（`[data-home-settings]`）添加 `.pith-icon` 类并靠右对齐（`margin-left: auto`），消除紧贴 `Pith` 标题左侧的原生灰色直角按钮外观；
     - 为 `.pith-home-actions button`、`.pith-focus button` 与 `.pith-home-form` 补齐书卷风圆角边框、内边距、悬停态与主强调态（`[data-home-new]`、`[data-topic]` 焦点继续按钮及表单提交按钮采用 `--pith-sage` 强调色或精致胶囊样式；输入框与下拉框带统一边框、圆角与内边距），彻底消灭浏览器默认裸 `<button>` / `<input>` 毛坯感。
  2. **时间轴字幕（`.pith-cue`）时间戳隔离与原位实训期间常驻显示（`src/plugins/stage-timeline/index.ts` & `src/workbench/view.ts`）**：
     - 在 `renderTimelineView`（及 `server.ts` 兜底模板如有）中，将 `.pith-cue` 内的 `<time>` 标记为 `<time data-prose="false">`，确保 `proseTextNodes` 与 TTS 伴读绝不把时间戳当成正文朗读；
     - 在 `PithWorkbenchView.mountInlineDojo` 中，当目标块 `target` 为含 `<time>` 的 `.pith-cue` 时，**保持 `<time>` 留在 `target` 最前面常驻可见**（仅将 `<time>` 之后的台词文本节点移入 `.pith-dojo-source`），使得展开原位影子跟读（意群拆解 / 原文 / 骨干词 / 盲听）或费曼复述时，该句左侧的时间戳（如 `00:00`）始终清晰可见，收起后无损还原。
  3. **清理 `.pith-dojo-panel` 旧弹窗宽大样式残留（`src/workbench/view.ts`）**：
     - 移除 `workbenchStyles` 中 `.pith-dojo-panel` 旧时代的 `width: min(480px, calc(100% - 32px))`、`.pith-dojo-panel textarea`、`.pith-dojo-panel label`、`.pith-dojo-panel pre` 残留规则，使其作为顶栏右下方近源多工具/行间模式切换气泡紧凑自适应（`width: max-content; max-width: calc(100% - 16px); display: flex; align-items: center; gap: 6px; padding: 8px 10px`）。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿；新增/更新浏览器回归测试验证：1) 课题看板首页设置按钮靠右且操作按钮具备非默认边框/内边距样式；2) 点击 `.pith-cue` 展开原位跟读切换四阶镜头时 `<time>` 始终可见（`offsetWidth > 0`）且收起后 DOM 完整恢复；3) 完成手动破壁验证（`Broken by hand`）并将真实 PNG 截图存入 `.tmp/evidence/task-25/` 调用 `view_image / read_image` 自检。
- **Tester 模拟用户终验要求**：在真实 Web 桌面壳与 `.dev-vault` Obsidian 中检查课题看板首页排版质感、多工具近源菜单宽度以及时间轴字幕展开原位跟读时左侧时间戳常驻显示，截图（扩展名与真实编码一致）归档至 `.tmp/evidence/task-25/`。

---

## [Task #Audit] 修复 `tests/task23-shared-web-browser.test.ts` 无硬件麦克风环境下的 `getUserMedia` 假阴性超时

- **Status**: verified
- **Scope**: `tests/task23-shared-web-browser.test.ts`
- **Verified-Commit**: ce4727a69791a97c9983663deefc0c3e6f2e1978
- **Updated**: 2026-11-07
- **验收摘要**：指定 Chromium 测试实际运行通过；Worker 完成全仓检查与转写断言破壁，Tester 独立观察合成录音、受控转写回填及音轨释放。证据见 `.tmp/evidence/task-Audit/`；未验证实体麦克风或真实 ASR。
- **授权范围**：仅允许修改 `tests/task23-shared-web-browser.test.ts`。
- **不在范围内**：严禁修改 `src/**` 业务代码。
- **实证与重构契约**：
  - **实证（行号 `tests/task23-shared-web-browser.test.ts:17, 25, 47-52`）**：该测试仅依赖 Chromium `--use-fake-device-for-media-stream` 启动参数而未像 `tests/task17-voice-browser.test.ts:24-27` 那样通过 `page.addInitScript` 注入基于 `AudioContext.createMediaStreamDestination()` 的合成 `MediaStream`，导致在无实体音频输入设备的无头环境中点击 `.pith-guide [data-voice="guide"]` 时 `getUserMedia({ audio: true })` 直接失败回退为 `idle`，第 48 行 `waitForFunction` 5000ms 超时报错。
  - **修复要求**：参照 `tests/task17-voice-browser.test.ts:24-27`，在 `tests/task23-shared-web-browser.test.ts` 的 `page.goto(base)` 之前通过 `page.addInitScript` 注入合成振荡器 `MediaStream`，确保 `PITH_PLAYWRIGHT_MODULE` + `PITH_CHROME_PATH` 下 `tests/task23-shared-web-browser.test.ts` 100% 稳定通过；同时通过手动破壁验证（临时移除 `addInitScript` 或破坏转写路由确认断言报红后恢复）。
