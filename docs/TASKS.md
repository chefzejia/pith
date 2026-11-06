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
- **验收摘要**：通过标准 ACP `session/new` 的 `configOptions` 与 `session/set_config_option` 动态发现并切换本机 Agent 模型与推理强度；通过 `NodeManagedSpeechRuntime` 管理 Vault 外 `sherpa-onnx` + `Kokoro-82M v1.1-zh` / `SenseVoice` 按需语音网关（契约见 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md)）。

---

## [Task #16] 修复分页阅读器横向滚动条泄露与超宽屏单栏行宽失控/大片留白

- **Status**: verified
- **Scope**: `src/plugins/stage-reader/pagination.ts`, `src/shells/obsidian/plugin.ts`, `src/shells/web/server.ts`, `tests/**`
- **Verified-Commit**: 3441c988aab6e1cfe80fdd5c4b516df557bde80d
- **Updated**: 2026-11-05
- **验收摘要**：分页视口隐藏原生横向滚动条并将 `::after` 撑宽伪元素改为绝对定位；`computePagination` 按 `1 / 2 / 3` 栏黄金最大列宽（`820 / 680 / 580px`）自动扩大两侧水平留白并保持多屏翻页步长恒等式（契约见 [2-stages.md](subsystems/2-stages.md)）。
