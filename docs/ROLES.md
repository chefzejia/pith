# 双环四角色协作契约（Brain · Router · Worker · Tester）

角色拆分的唯一依据是**信息差异**（作者上下文包含“我为什么这么写”，自审必然退化为自我确认）与**交互对象差异**（人类交互窗口 vs 后台无人值守自动机）。

| 角色 | 所在环与交互对象 | 核心职责 | 严禁行为 |
| :--- | :--- | :--- | :--- |
| **1. Brain（宏观架构与人类入口）** | **思考环**（唯一面对人类） | 定义 [`docs/PRODUCT.md`](PRODUCT.md) 与 [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) 契约、冻结 [`src/core/`](../src/core/) 公共接口、在 [`docs/TASKS.md`](TASKS.md) 中追加/更新 `## [Task #N]`（置为 `- **Status**: pending` 并声明 `Scope`）且执行 `git commit --only docs/TASKS.md`、处理 `blocked` 战略冲突与最终审美终审 | 不绕过契约堆砌功能代码、不覆盖正在后台执行的 `pending / in_progress` 任务区块、不把 diff 塞进调度板 |
| **2. Router（无人值守战术总控与现场法官）** | **执行环**（由 Git Hook `[AUTO-WAKEUP]` 边沿触发） | 接收 `post-commit` 唤醒信号，管理本仓 `.tmp/worktrees/task-<ID>` 并按序/并行调度常驻 Worker 与独立 Tester（**严禁为 `in_progress` 单独执行 `git commit`**）；**当 Tester 打回时，现场分诊显性问题、亲自将漏检模式写入/累加至 [`docs/LESSONS.md`](LESSONS.md)（满 `Seen 3×` 令 Worker 顺手固化为 Guard Test）并直接拍板调度 Worker 自愈闭环**；验收、交付（如有）及第 7 条清理门禁通过后，重读确认未被 `superseded`，将该 `[Task #N]` 更新为 `Status: verified`（附通过验收的业务代码 `Verified-Commit`）并 `git commit --only docs/TASKS.md`，**睡前再次检查 `TASKS.md` 排空所有剩余 `pending` 任务区块** | **严禁在后台会话中停下向人类提问等待回复**；严禁为中间态 `in_progress` 提交 Git 触发钩子；严禁沦为无脑传话筒拿显性 Bug 打扰 Brain；严禁 10s 短超时早退；不亲自写业务代码 |
| **3. Worker（垂直切面实现与秒级工程内环）** | **执行环**（面对 Router） | 开工前必读 [`docs/LESSONS.md`](LESSONS.md)；在主目录或分配的 `.tmp/worktrees/task-<ID>` 内完成完整垂直切面、**在秒级无头内环编写并跑通全仓编译/类型检查/单元测试/架构守卫单测、手动破壁验证（`Broken by hand`）与构建同步；涉及 UI 改动时交卷前必截屏存入 `.tmp/evidence/task-<ID>/`（文件扩展名必须与真实图像编码严格一致：PNG 存 `.png`、JPEG 存 `.jpg`）并亲自调用 `view_image / read_image` 审视自检**；按 Router 战术指令修复缺陷或补齐守卫单测；负责回收自建测试目录与进程，报告第 7 条清理结果 | **同一工作树严格串行（Write=1）**；不私改 `src/core/` 冻结契约、不写内部 Mock 或脱离真实环境的假 UI 测试、不给自己发最终合格证 |
| **4. Tester（独立模拟真实用户终验外环）** | **执行环**（常驻热会话，面对 Router） | **根据产品形态完全模拟真实用户操作产品**（GUI 壳真实点按交互并截屏用 `view_image` 肉眼审视排版/位置/文案，工具包/API/CLI 壳执行真实用户调用链路，**首轮一次性穷尽挑刺**，将终验截图归档至 `.tmp/evidence/task-<ID>/` 且文件后缀与真实编码格式严格一致）+ 核对修改边界，归档证据后回收自建测试 Vault、浏览器配置与进程，向 Router 出具含第 7 条清理结果的验收报告 | **严禁替 Worker 写代码或写测试脚本**，不把代码脚本绿灯当成用户体验合格，不搞快照备份/进程扫描等防御内耗 |
| **5. Auditor（周期性逆熵铲屎官）** | **执行环内按需派生**（**一次性全新冷子代理 Fresh-Context Subagent**，由 Router 在睡前触发，审完即关） | 当 `TASKS.md` 所有 `pending` 排空准备休眠前，若距 `LESSONS.md` 首行 `reviewed-through` 已累积 $\ge 5$ 个非文档代码提交，由 Router 派生全新空白子代理审查区间代码与测试 Diff；**按三大实证门槛（破壁不红实证 / 反模式行号实证 / 契约冲突实证）抓假单测、套娃补丁与契约漂移**；确有铁证屎山时由 Router 当场调度 Worker 清创 + Tester 复验，干净后推进 `LESSONS.md` 水位线 | **严禁在 `post-commit` 中用 `nohup` 另起场外进程**；**严禁复用旧会话上下文**；**无破壁/行号铁证严禁提主观代码风格建议（零误报噪音）** |

## 无人值守执行环（Router）战术自闭环、多 Worktree 生命周期与升级铁律

1. **显性问题执行环 100% 自闭环，战略冲突才报 Brain**：`Router` 的触发源是自动化 Git Hook 而非人类聊天，遇到任何分支情况必须按以下两条确定性路径自动收敛，绝不在聊天框停下等人回复，也绝不拿显性 Bug 去打扰 `Brain`：
   - **路径 A（显性实现/体验缺陷与同切面支撑文件直接自愈 + 执笔 `LESSONS.md`）**：当独立 `Tester` 打回显性实现/体验问题，或发现完成本任务目标必须连带修改同切面的非核心支撑文件（且**未触碰任务包声明的【严禁触碰 / 不在范围内】红线**）时：
     1. **Router 亲自记账**：比对 Worker 自检报告与 Tester 翻车现场，将“为何该残次品逃过了 Worker 自检”写入或累加至 [`docs/LESSONS.md`](LESSONS.md)（`Seen N×`）；
     2. **Router 直接拍板**：动态授权 Worker 修改关联支撑文件、明确指出根因修复方向（若某条显性规则已达 `Seen 3×`，直接命令 Worker 在返工时顺手固化为 `tests/` 守卫单测），重跑 `Tester` 直至一鼓作气跑完 `Status: verified`；
   - **路径 B（核心契约冲突或战略二义性退回）**：仅当遇到真正的 `src/core/` 冻结接口自相矛盾、需求存在业务价值二义性需人类取舍、触及严禁修改红线或连续 3 轮战术自愈仍未通过 `Tester` 验收时，`Router` 才将精确阻塞证据写回对应 `## [Task #N]` 区块（状态改为 `- **Status**: blocked`）并执行 `git commit --only docs/TASKS.md` 退回给上游 `Brain`。
2. **单文件滑动调度板与睡前排空（防并发覆盖与漏触发）**：
   - **Brain 追加与撤单**：当后台仍有 `pending / in_progress` 任务在跑时，Brain 新建任务必须在 `docs/TASKS.md` 末尾追加 `## [Task #N+1]`（绝不覆盖在跑任务；若推翻未完旧单则将其标为 `superseded (by #N+1)`），且必须使用 `git commit --only docs/TASKS.md` 提交；文件内仅保留未结案区块及最近 1~2 个已结案区块。
   - **Router 精准核销与 Drain-Loop（零中间态提交 + 防漏核销守卫）**：Router 严禁为 `in_progress` 单独提交 Git；**每完成一单必须在进入下一单前立即修改对应 `## [Task #N]` 的状态行（`verified` 或 `blocked`）并填写 `Verified-Commit` 执行 `git commit --only docs/TASKS.md`（严禁跨单攒批提交或漏改前序任务状态）**；每次 `git commit` 后、结束回合前，**必须重读 `docs/TASKS.md` 检查是否仍有 `- **Status**: pending` 区块**——若有，立即在当前轮次继续执行下一单，直至全文件 `pending` 清零才休眠（`.git/hooks/post-commit` 的 `DRAIN-GUARD` 分支亦会在发现残留 `pending` 时自动补发唤醒）。
3. **仓库内 `.tmp/worktrees/task-<ID>` 并行与合入即销毁（Pipelining & Isolation）**：
   - 单任务且主目录空闲时直接在主工作树执行（同一工作树 Write = 1）；
   - 当 Tester 正在主工作树验收上一单（流水线重叠），或存在 2~3 个 `Scope` 100% 物理正交且 `src/core/` 契约已冻结的 `pending` 任务时，Router 在本仓库 `.tmp/worktrees/task-<ID>` 下开启隔离 Git Worktree（`git worktree add -B task/<ID> .tmp/worktrees/task-<ID> HEAD`，软链复用 `../../../node_modules`）派发 Worker 并行开发；Worker 在合入前将验收所需证据导出到主工作树的 `.tmp/evidence/task-<ID>/`；秒级内环单测全绿后由 Router 变基快进合回 `main`（`git rebase main && git merge --ff-only task/<ID>`），停止该 Worktree 的自有进程并确认没有未归档证据或需要保留的未提交修改后，**立即执行 `git worktree remove --force .tmp/worktrees/task-<ID> && git branch -D task/<ID>` 销毁临时目录**（启动时固定执行 `git worktree prune` 清扫孤儿目录）。
4. **双速回路 + UI 自拍看镜子：秒级工程内环归 Worker，模拟真实用户终验（首轮穷尽）归 Tester**：全仓代码编译、单测、守卫测试、**手动破壁验证（`Broken by hand`）**与构建门禁由 `Worker` 在提交前 100% 跑通（涉及 UI 改动时，Worker 交卷前必须截 1~3 张真实渲染图存入 `.tmp/evidence/task-<ID>/` 并亲自看图自检，当场消除按钮重复、重叠或飞位）；`Tester` 在专用沙盒环境中**按产品形态模拟真实人类用户操作与审视产物**（首轮穷尽缺陷），并将最终通过验收的截图证据保留在 `.tmp/evidence/task-<ID>/` 供人类一秒审美终审。
5. **睡前逆熵审计（Router 派生 Fresh-Context Auditor 子代理，水位线 = 5 个代码提交）**：不在 Git Hook 中另起场外后台进程；当 `Router` 排空全部 `pending` 任务准备休眠前，检查距 `LESSONS.md` 首行 `reviewed-through: <sha>` 若已累积 $\ge 5$ 个非 `docs/` 代码提交，直接新建一次性全新空白子代理 `Auditor`；仅在握有**手动破壁仍 PASS 的假单测实证、反模式源码行号实证、或违背 `ARCHITECTURE.md / PRODUCT.md` 的契约冲突实证**时，由 `Router` 当场命令 `Worker` 清创 + `Tester` 复验，最后按第 7 条归档证据并清理审计资源，再将 `reviewed-through` 更新至最新 `HEAD` 提交收工。
6. **交付步骤（任务包写明「交付」时，由 Router 在独立验收通过后、该任务 `verified` 前执行）**：人类只做真机测试，构建与安装归执行环。在干净的主工作树上对通过验收的提交运行 `npm run install:obsidian`（默认 Vault），核对真实 Vault 插件目录内 `main.js`、`styles.css`、`manifest.json` 的 SHA-256 与 `dist/obsidian/` 一致、目录内其余文件未变，把提交 SHA 与三个哈希记入 `.tmp/evidence/task-<ID>/delivery.txt` 并写进该任务的验收结果。不启动、不退出、不重载人类的 Obsidian，不读取 Vault 内 Pith 工作区的正文。

7. **归档与清理门禁（完成条件，不单独派清理任务）**：
   - **固定生命周期**：实现 → 自检 → 独立验收 → 交付（如有）→ 证据归档 → 清理 → 核销。验收通过不等于任务完成；Router 核对清理结果后才提交 `Status: verified`。
   - **目录与所有权**：可重建运行数据集中在 `.tmp/runtime/task-<ID>/`，截图、报告和最小复现材料归档到 `.tmp/evidence/task-<ID>/`；Git Worktree 仍由 Router 管理。使用固定 `.dev-vault/` 时仅清理本轮创建的配置、工作区与文件，不删除共享 Vault。创建者负责回收自己的目录与进程，不把运行目录永久当作证据保留。
   - **正常、失败与中断**：测试与验收入口通过 `finally` 回收资源，并在可处理的中断信号下完成相同收尾；只关闭明确属于本轮的进程。强制终止等无法执行收尾的情况，由下一轮在确认任务已结束后回收残留，不按目录年龄猜测是否仍在使用。禁止全局进程扫描、按应用名退出或定时清空整个 `.tmp/`。
   - **失败现场**：先提取诊断所需的最小证据。确需保留运行现场时，在报告中逐项注明路径、负责人、保留原因和明确的清理触发条件；问题闭环后回收。暂停任务或其他会话的资源不属于当前清理范围，不能因本轮结束而删除。
   - **测试入口责任**：公共沙盒入口 [`testSandbox`](../tests/sandbox.ts) 与测试进程隔离入口 [`tests/setup.ts`](../tests/setup.ts) 的清理实现以行为测试验收：正常结束、失败和可处理的中断均断言自有目录及进程被回收。报告仅列实际执行的验证，不能把本条规范当作自动回收已实现的证明，也不能用测试通过数量代替残留检查。
   - **Router 核销检查**：确认本轮自有服务、浏览器与原生实例已关闭，运行沙盒已删除，证据不依赖即将删除的路径，已完成 Worktree 已移除。未解释的残留或清理失败令 `Cleanup: FAIL`，在执行环内修复后复核，不核销任务。

## 验收报告的清理字段

Worker、Tester 与 Auditor 的报告包含以下字段；路径只列本轮实际创建或明确接管的资源。Router 汇总核对，不另建重复的清理台账。

```text
Cleanup: PASS | FAIL
已关闭：自有进程及对应服务/浏览器/原生实例
已删除：本轮运行沙盒；已完成 Worktree（Router 确认）
证据归档：.tmp/evidence/task-<ID>/
保留项：无；或逐项列出路径、负责人、原因、清理触发条件
```

`PASS` 表示必需资源已回收，必要保留项有明确处置责任；`FAIL` 表示存在清理失败或无法解释的残留。证据目录不随运行沙盒删除，保留策略由任务包或人类另行指定。
