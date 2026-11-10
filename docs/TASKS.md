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
- **验收摘要**：独立 Tester 在 Web 与隔离 Obsidian 验证统一立项、仓库及无材料向导生成、材料刷新、普通聊天保持阅读、源码逐行锚点与转义、二进制拒绝、默认及显式空工具和工具增删启动持久化。原生 `.ts` 的 `video/mp2t` 冲突已修复；332px 内容区与 Web 390px 中标题、工具图标和菜单完整，宽幅恢复名称。源码以非正文标记保留行锚点、高亮、费曼及向导引用；双端章节听读不发送源码，`.txt`/`.abc` 自然正文仍实际合成。标准 ACP 可完整读取 `.ts/video/mp2t` 与 `.py/application/octet-stream`，二进制与非法 UTF-8 拒绝。最终工程门禁 254 通过、61 跳过，类型与构建通过；独立终验报告及截图：`.tmp/evidence/task-33/final-header-report.md`、`.tmp/evidence/audit-fix/final-report.md`、`.tmp/evidence/audit-fix/final-web-guide-ts.png`、`.tmp/evidence/audit-fix/final-native-guide-ts.png`。

---

## [Task #34] 影子跟读（`shadowing`）Stage 原位声学闭环升级：单句定点播放、0.75x 慢听、单句循环与个人录音回放对比

- **Status**: verified
- **Verified-Commit**: ae10fa7d27b0f86518b728d04a3ea26f46c7a3fd
- **Updated**: 2026-11-10
- **Scope**: `src/workbench/view.ts`, `src/workbench/voiceInput.ts`, `src/plugins/stage-timeline/index.ts`, `tests/**`
- **验收摘要**：独立 Tester 在 Web 与隔离 Obsidian 实测句段原声播放/停止/循环、0.75x 精听与用户倍速、切句切文件停止、开录同步领读、ASR pending/失败期间回放、成功自动漏词标记与重录 URL 释放。正文目标错位已修复；单击第二段、局部选区及可见正文兜底的显示文本与受控 HTTP 合成输入一致，费曼及行间锚点通过。Worker 全仓测试 253 通过、61 跳过，23 项定向检查、类型与构建通过，并有有效破壁。终验截图与报告：`.tmp/evidence/task-34/final-native-diagnosis.png`、`.tmp/evidence/task-34/final-web-diagnosis.png`、`.tmp/evidence/task-34/final-retest-native-second.png`、`.tmp/evidence/task-34/final-retest-web-second.png`、`.tmp/evidence/task-34/final-retest-report.md`。
