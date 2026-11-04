# 双环四角色协作契约（Brain · Router · Worker · Tester）

角色拆分的唯一依据是**信息差异**（作者上下文包含“我为什么这么写”，自审必然退化为自我确认）与**交互对象差异**（人类交互窗口 vs 后台无人值守自动机）。

| 角色 | 所在环与交互对象 | 核心职责 | 严禁行为 |
| :--- | :--- | :--- | :--- |
| **1. Brain（宏观架构与人类入口）** | **思考环**（唯一面对人类） | 定义 `docs/` 契约、冻结 `src/core/` 公共接口、在 `docs/HANDOFF.md` 中追加/更新 `## [Task #N]`（置为 `- **Status**: pending`）并执行 `git commit --only docs/HANDOFF.md` | 不绕过契约堆砌功能代码、不覆盖正在后台执行的 `pending` 任务区块、不把 diff 塞进交接文档 |
| **2. Router（无人值守执行总控）** | **执行环**（由 Git Hook `[AUTO-WAKEUP]` 触发） | 接收 `post-commit` 唤醒信号，在同一轮次内循环 `wait_agent` 按序调度常驻 Worker 与独立 Tester；每单通过后重读确认未被 `superseded`，仅将该 `[Task #N]` 更新为 `Status: verified`（附 `Verified-Commit`）并 `git commit`，**睡前再次检查 `HANDOFF.md` 排空所有新增 `pending` 任务区块** | **严禁在后台会话中停下向人类提问等待回复**；严禁 10s 短超时早退；严禁盲目覆写其他任务区块；不亲自写业务代码 |
| **3. Worker（垂直切面实现与工程自检）** | **执行环**（面对 Router） | 在授权范围内完成完整垂直切面、**编写并跑通全部编译/类型检查/单元测试/架构守卫单测与构建同步（`npm run typecheck && npm test && npm run build:obsidian`，交卷前置条件）**，按 Tester 报告修复缺陷 | **共享工作区严格串行（Write=1）**；不私改 `src/core/` 冻结契约、不写 `vm.runInContext` 假 UI 测试、不给自己发最终合格证 |
| **4. Tester（独立模拟真实用户验收）** | **执行环**（面对 Router） | **完全模拟一个不懂技术的真实人类用户操作 `.dev-vault` 的 Obsidian 窗口与 Web 界面**：真实点击按钮、滚轮翻页、调整窗口宽窄，并**每一步截屏用视觉（`view_image`）肉眼审视画面**（排版美感、图文是否截断、弹出位置是否合理、文案是否说人话） | **严禁替 Worker 写代码或写单测脚本**、严禁把跑代码脚本返回 `ok: true` 当成用户体验合格、严禁搞快照备份/进程树检查等防御内耗 |

## 无人值守执行环（Router）裁决、防丢单与升级铁律

1. **零人工提问闭环**：`Router` 的触发源是自动化 Git Hook 而非人类聊天，遇到任何分支情况必须按以下两条确定性路径自动收敛，绝不在聊天框停下等人回复：
   - **路径 A（同目标关联文件自动补齐）**：当独立 `Tester` 发现任务包目标已明确要求某功能、但修改白名单漏列了同切面的非核心支撑文件（如 `src/plugins/<id>/`）时，`Router` 有权直接授权 `Worker` 补齐修改并重跑 `Tester`，一鼓作气跑完 `Status: verified`；
   - **路径 B（核心契约冲突退回）**：若遇到真正的 `src/core/` 冻结接口冲突、安全红线阻断或连续 3 轮修复未通过 `Tester` 验收，`Router` 必须将精确阻塞证据写回对应 `## [Task #N]` 区块（状态改为 `- **Status**: blocked`）并执行 `git commit` 退回给上游 `Brain`。
2. **单文件滑动任务栈与睡前排空（防并发覆盖与漏触发）**：
   - **Brain 追加与撤单**：当后台仍有 `pending` 任务在跑时，Brain 新建任务必须在 `docs/HANDOFF.md` 末尾追加 `## [Task #N+1]`（绝不覆盖在跑任务；若推翻未完旧单则将其标为 `superseded (by #N+1)`），且必须使用 `git commit --only docs/HANDOFF.md` 提交；文件内仅保留未结案区块及最近 1~2 个已结案区块。
   - **Router 精准核销与 Drain-Loop**：Router 结案时仅修改对应 `## [Task #N]` 的状态行；每次 `git commit` 后、结束回合前，**必须重读 `docs/HANDOFF.md` 检查是否仍有 `- **Status**: pending` 区块**——若有，立即在当前轮次继续执行下一单，直至全文件 `pending` 清零才休眠。
3. **并行调度与首轮穷尽审查纪律（Parallel Dispatch & Exhaustive First-Pass Review）**：
   - **写任务并行条件**：同一共享工作树（Working Tree）内同一时刻只允许 1 个活跃 `Worker` 写代码；当任务包含两个**写文件集 100% 物理正交**的独立子模块且 `src/core/` 契约已提前冻结时，`Router` 可在 `.tmp/worktrees/` 下建立独立 Git Worktree 并行派发 2~3 个 `Worker`，待各自工程自检通过后合并进入统一验收。
   - **Tester 首轮穷尽体验挑刺**：`Tester` 在第一轮验收时必须**一次性穷尽该任务切面的全部交互体验、视觉排版与边界缺陷**，严禁“挤牙膏式”每轮只报 1 个问题把 3 轮额度耗光。
   - **禁止表层补丁（详见 [LESSONS.md](LESSONS.md)）**：严禁使用同名函数重赋值套娃（`const xBase = x; x = ...`）、`stopImmediatePropagation` 掩盖旧代码、或 `readFile("src/...") + vm.runInContext` 抠源码字符串凑单测。
4. **工程自检归 Worker，模拟真实用户归 Tester（给 `.dev-vault` 彻底松绑）**：
   - **代码单测与构建门禁归 `Worker`**：`npm run typecheck && npm test && npm run build:obsidian` 由 `Worker` 在交卷前跑通，确保最新产物已同步进 `.dev-vault`。
   - **`.dev-vault` 是随便点的玩具沙盒**：`.dev-vault` 与 `.tmp` 是受 `.gitignore` 忽略的专用沙盒，直接打开点按、改设置、截屏看图即可，**严禁为了“证明沙盒隔离”而去编写进程扫描、文件哈希比对、快照备份或硬链接防御代码**。
