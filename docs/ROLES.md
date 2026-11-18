# 双环协作角色契约（Brain · Router · Worker · Tester · Auditor）

角色拆分只看两种差异：**信息差异**（作者自审会退化为自我确认，所以 Worker 与 Tester 分开）与**交互对象差异**（面对人类的会话与被自动化唤醒的后台会话阻塞语义不同，所以 Router 独立）。本文件是 Router 被唤醒后读取的完整协议，与 `multi-agent-collab` Skill v1.4.0 保持一致；Pith 特有的规则集中在文末“项目专有规则”，其他文档按小节名引用。

调度单位是**里程碑**：一条真实用户路径能端到端走通、Tester 一轮就能判定的可观测增量。里程碑内分若干**切片**，切片是 Worker 的工作单位：Scope 重叠或有串行依赖的并成同一个切片，Scope 正交才分开并行；只有一个切片的里程碑直接在区块里写 `Scope`。里程碑编号沿用项目现有序列。

| 角色 | 所在环与生命周期 | 职责 | 不做什么 |
| :--- | :--- | :--- | :--- |
| **Brain** | 思考环，唯一面对人类 | 定义 `docs/PRODUCT.md` 与 `docs/ARCHITECTURE.md` 契约，冻结 `src/core/` 公共接口；在 `docs/TASKS.md` 追加里程碑区块（`pending`，写明 `Scope`、`Features` 与 `Depends-On`）并只提交该文件（`git commit --only docs/TASKS.md`）；要改未完成的里程碑就标 `superseded` 再追加新的；增删 `docs/FEATURES.md` 的条目与提议；处理 `blocked` 与最终审美终审 | 不绕过契约堆砌功能代码；不覆盖或删除仍为 `pending` 的里程碑；不把 diff 塞进调度板 |
| **Router** | 执行环，由 `.git/hooks/post-commit` 唤醒，对面没有人；唯一常驻会话 | 取单、派生 Worker 与 Tester、管理 `.tmp/worktrees/` 下的 Worktree；Tester 打回时现场分诊、记 `docs/LESSONS.md` 并直接拍板返工；里程碑写明 `发布版本` 时按「发布步骤」发布；核对清理结果后结案，并按「功能台账同步」更新台账；排空队列、按条件派生 Auditor | **不停下向人类提问、不等待回复、不短超时早退**；不把显性问题转给 Brain；取单不改状态、不提交；不自己改切片代码，只派生不代做 |
| **Worker** | 执行环，面对 Router；从切片派出到所在里程碑结案，之后关闭 | 开工前读 `docs/LESSONS.md`；在主工作树或分配的 Worktree 内实现一个完整切片，跑通下文的默认门禁；UI 改动截图存入 `.tmp/evidence/milestone-<ID>/`（扩展名与真实编码一致：PNG 存 `.png`、JPEG 存 `.jpg`）并亲自看图；回收自建的测试目录与进程，报告里给出清理字段 | 同一工作树同一时刻只有一个 Worker 写；不改 `src/core/` 冻结契约；不写内部 Mock 或脱离真实环境的假 UI 测试；不给自己下验收结论 |
| **Tester** | 执行环，面对 Router；每个里程碑派生一个全新会话，同一里程碑内的返工复验沿用，结案后关闭 | 按下文的默认验收方式模拟真实用户验收整个里程碑，一轮穷尽缺陷，终验截图存入 `.tmp/evidence/milestone-<ID>/`（扩展名与真实编码一致）；里程碑列了 `Features` 时按条目逐行给出结论与未覆盖边界；回收自建的测试 Vault、浏览器配置与进程，向 Router 出具含清理字段的验收报告 | 不替 Worker 写代码或测试脚本；不拿脚本绿灯当体验验收；不做快照备份、进程扫描等防御性内耗；不分轮挤牙膏 |
| **Auditor** | 执行环内由 Router 按条件派生的一次性全新会话，审完即关 | 审查 `docs/LESSONS.md` 首行 `reviewed-through` 之后的提交区间，只报告三类实证：改坏被测代码测试仍通过、`文件:行号` 处的明文禁止写法、违背 `docs/ARCHITECTURE.md` 或 `docs/PRODUCT.md` 的具体条目 | 不由钩子或外部进程拉起；不复用旧会话上下文；不提没有实证的主观风格建议 |

## 会话生命周期

状态在文件和 Git 里，不在会话里。新 Worker 接不住上一个里程碑的工作，说明代码、Commit Body、契约文档或 `docs/LESSONS.md` 有缺口，补缺口，不靠留着会话。

## 里程碑状态、前置与唤醒

`Status` 只有 `pending | verified | blocked | superseded`，只存在于里程碑上，切片没有独立状态。`pending` 同时表示排队中和执行中；取单时不改状态、不提交。已提交的切片代码默认不回滚，新里程碑在当前 HEAD 上继续，要回滚由新里程碑明写。

里程碑之间的先后写在 `Depends-On` 字段（没有写“—”）：前置全部 `verified` 才可派发；前置被标 `superseded (by #M)` 时改看 #M；前置被标 `blocked` 时，依赖它的里程碑保持 `pending`、不派发，等 Brain 处理。

`.git/hooks/post-commit` 在一次提交新增 `pending` 状态行，或有里程碑新变为 `pending` 时唤醒 Router；Router 自己的结案提交不会自激。唤醒消息只要求重读本文件并执行前置已满足的 `pending` 里程碑，协议细节以本文件为准。

## 默认门禁与验收（里程碑里只写偏离项）

- **Worker 每个切片交卷前**：`npm run typecheck`、`npm test`；改到 `src/workbench/`、`src/shells/` 或舞台渲染的，还要 `npm run test:browser` 与 `npm run build:obsidian`。关键测试手动破坏后先红后绿（`Broken by hand`）；业务提交正文记录意图或根因与验证证据；UI 改动截图并亲自看图。
- **Tester 验收方式**：在 `.gitignore` 专用沙盒（`.dev-vault` / `.tmp`）中按产品形态模拟真实用户：GUI 壳真实点按并截屏，看排版、位置与文案；工具包、API 与 CLI 壳走真实用户调用链路。程序保证与模型产出分开验收，见「程序保证与模型产出分开验收」。
- **验收栏写“无”**：纯内部重构、测试、文档、工具不改变外部可观测表面，跳过 Tester。

## Router 执行规则

1. **取单与派发**：每次取单前重读本文件与 `docs/TASKS.md`，协议改动在下一个里程碑生效；按序取第一个前置已满足的 `pending` 里程碑（取单不改状态、不提交）；每次派切片前重读 `docs/TASKS.md`，被标 `superseded` 就停止派发、清理 Worktree 与分支，转去下一个。Scope 正交的切片可并行，有依赖的按序派。
2. **验收**：所有切片提交且门禁证据齐备后，里程碑改变了外部可观测表面就派全新 Tester 一轮验收；验收栏写“无”的跳过 Tester，靠 Commit Body 门禁证据与 Auditor 兜底。
3. **显性问题不出执行环**：实现漏项、交互或排版瑕疵、测试逃逸，以及完成目标所需、切片漏列但不在“不在范围内”或禁区里的同切面支撑文件，由 Router 当场授权补改、指明根因方向；按报告里的文件位置归因到切片，对应 Worker 返工、同一 Tester 复验。每次打回都对比 Worker 自检与 Tester 发现，把漏检模式记入 `docs/LESSONS.md`，`Seen N×` 按缺陷模式计，不按打回次数计；累计 `Seen 3×` 时，能写成测试的令 Worker 固化为 `tests/` 守卫测试，固化后把该条从正文移到文末已晋升列表，需要改契约文档或 Skill 的标 `blocked`。Worker 连续两轮在同一症状上打表层补丁时，Router 介入重判根因。
4. **升级到 Brain**：需要改动 `src/core/` 冻结接口或契约自相矛盾、需要触碰“不在范围内”或禁区里的文件、需求有业务价值二义性、涉及破坏性操作、同一里程碑连续 3 轮返工未通过时，把精确阻塞证据写回该里程碑区块、状态改为 `blocked`，只提交 `docs/TASKS.md`。模型产出的同一症状改了两轮提示词仍失败，同样标 `blocked`（见「程序保证与模型产出分开验收」）。
5. **结案与排空**：结案前重读 `docs/TASKS.md` 确认未被标为 `superseded`，并按「归档与清理门禁」核对清理结果；里程碑写明 `发布版本` 的，先按「发布步骤」发布。只改该区块状态为 `verified` 并填 `Verified-Commit`；列了 `Features` 的，在同一次提交里按「功能台账同步」更新台账并用 `git commit --only docs/TASKS.md docs/FEATURES.md` 提交，否则只提交 `docs/TASKS.md`。每个里程碑结案后立即提交，不跨里程碑攒批。然后关闭该里程碑的 Worker 与 Tester、删除 Worktree。每次提交后结束回合前重读 `docs/TASKS.md`，仍有前置已满足的 `pending` 就在当前回合继续；只剩前置未满足的 `pending` 时即可休眠。
6. **Worktree**：同一里程碑内 Scope 正交的切片，或下一个里程碑与当前 Scope 完全正交且 `src/core/` 契约已冻结时，才在 `.tmp/worktrees/m<ID>-s<K>` 开独立 Worktree 并行（复用仓库根的 `node_modules`，同时不超过 2~3 个）；Worker 合入前把验收所需证据导出到主工作树的 `.tmp/evidence/milestone-<ID>/`；合回 `main` 后停止该 Worktree 的自有进程，确认没有未归档证据或需要保留的未提交修改，再删除 Worktree 与分支；启动时清扫孤儿 Worktree。
7. **睡前审计**：队列排空后，自上次审计起已结案不少于 2 个里程碑，或其间有里程碑跳过了 Tester，就派生全新的 Auditor 审查 `docs/LESSONS.md` 首行 `reviewed-through` 之后的区间；有实证则派生新的 Worker 清理，并按第 2 条决定是否派 Tester 复验；按「归档与清理门禁」归档证据并回收审计资源；最后把 `reviewed-through` 更新为最新 `HEAD` 并单独提交（只含 `docs/LESSONS.md`），再休眠。

## 项目专有规则

### 功能台账同步

里程碑区块的 `Features` 字段列出它推进或动到的 `docs/FEATURES.md` 条目（没有就写 `—`）。

1. Tester 报告按这些条目逐行给出结论与未覆盖边界。
2. Router 结案时在同一次提交里同步这些行：独立验收通过的写成 `已验收`，填 `#<里程碑> @<Verified-Commit 前 7 位>（月-日）`，同时更新宿主、已知缺口与回归测试；动到但没有独立验收的降为 `待复验`，验收栏写“无”、跳过 Tester 的里程碑也照此处理。提交前跑 `npm run test:file -- tests/feature-ledger.test.ts`，用 `git commit --only docs/TASKS.md docs/FEATURES.md` 提交。
3. 写明 `发布版本` 的里程碑，发布前把这个版本范围内的 `待复验` 条目按真实用户路径重新独立验收。
4. Router 只改所列的行，不增删条目或提议，那归 Brain；已知缺口写一句结论，细节留在提交正文与证据目录。

### 程序保证与模型产出分开验收

程序负责的部分（选什么、请求里带什么、失败时怎么回退、结果写到哪里）逐项必须通过，并做手动破壁。模型生成的措辞（追问、讲义、回复的质量）按契约写明的抽样标准验收，未达标的样本连同原始输出记为已知缺口，不阻塞里程碑或发布。某项模型产出在真实样本中反复失败时，先回到契约检查是不是要求本身自相矛盾，再考虑改提示词；同一症状改了两轮提示词仍失败，就停止加规则，标 `blocked` 交 Brain 重审契约。

### 发布步骤

里程碑区块写明 `发布版本` 时，由 Router 在独立验收通过后、该里程碑 `verified` 前执行。人类日常用发布版本，装在默认 Vault；开发版本只进 `.dev-vault` 与 `.tmp` 沙盒，不写 `发布版本` 的里程碑一律不安装到真实 Vault。构建与安装归执行环，人类只做真机使用。

- **安装**：在通过验收的提交的干净检出上，确认 `manifest.json` 与 `package.json` 的 `version` 等于发布版本（不等时由 Worker 在本里程碑内改好并通过门禁），运行 `npm run install:obsidian`（默认 Vault），核对真实 Vault 插件目录内 `main.js`、`styles.css`、`manifest.json` 的 SHA-256 与 `dist/obsidian/` 一致、目录内其余文件未变。不启动、不退出、不重载人类的 Obsidian，不读取 Vault 内 Pith 工作区的正文。
- **打标签**：在该提交上打附注标签 `v<版本>`，标签说明写本次相对上一个标签的台账变化：新增或转为已验收的条目、仍待复验的条目、已知缺口。
- **记录**：提交 SHA、标签与三个哈希记入 `.tmp/evidence/milestone-<ID>/delivery.txt` 并写进该里程碑的验收结果；结案提交同时更新 `docs/FEATURES.md`「发布与版本」里的当前发布版本（`git commit --only docs/TASKS.md docs/FEATURES.md`）。
- **补丁**：发布后发现、要在下个版本之前修的问题，由 Brain 开补丁里程碑：从标签拉 `release/v<主>.<次>` 分支，在 `.tmp/worktrees/` 下修复并做针对性验收，打补丁标签（如 `v0.1.1`）并安装，再把修复合回 `main`。

### 归档与清理门禁

清理是结案的完成条件，不为清理单独派里程碑。

- **固定生命周期**：实现 → 自检 → 独立验收 → 发布（如有）→ 证据归档 → 清理 → 结案。验收通过不等于里程碑完成；Router 核对清理结果后才提交 `Status: verified`。
- **目录与所有权**：可重建运行数据集中在 `.tmp/runtime/` 下按里程碑编号分的目录，截图、报告和最小复现材料归档到 `.tmp/evidence/milestone-<ID>/`；Git Worktree 仍由 Router 管理。使用固定 `.dev-vault/` 时仅清理本轮创建的配置、工作区与文件，不删除共享 Vault。创建者负责回收自己的目录与进程，不把运行目录永久当作证据保留。
- **正常、失败与中断**：测试与验收入口通过 `finally` 回收资源，并在可处理的中断信号下完成相同收尾；只关闭明确属于本轮的进程。强制终止等无法执行收尾的情况，由下一轮在确认里程碑已结束后回收残留，不按目录年龄猜测是否仍在使用。禁止全局进程扫描、按应用名退出或定时清空整个 `.tmp/`。
- **失败现场**：先提取诊断所需的最小证据。确需保留运行现场时，在报告中逐项注明路径、负责人、保留原因和明确的清理触发条件；问题闭环后回收。暂停的里程碑或其他会话的资源不属于当前清理范围，不能因本轮结束而删除。
- **测试入口责任**：公共沙盒入口 [`testSandbox`](../tests/sandbox.ts) 与测试进程隔离入口 [`tests/setup.ts`](../tests/setup.ts) 的清理实现以行为测试验收：正常结束、失败和可处理的中断均断言自有目录及进程被回收。报告仅列实际执行的验证，不能把本条规范当作自动回收已实现的证明，也不能用测试通过数量代替残留检查。
- **Router 结案检查**：确认本轮自有服务、浏览器与原生实例已关闭，运行沙盒已删除，证据不依赖即将删除的路径，已完成 Worktree 已移除。未解释的残留或清理失败令 `Cleanup: FAIL`，在执行环内修复后复核，不结案。

### 验收报告的清理字段

Worker、Tester 与 Auditor 的报告包含以下字段；路径只列本轮实际创建或明确接管的资源。Router 汇总核对，不另建重复的清理台账。

```text
Cleanup: PASS | FAIL
已关闭：自有进程及对应服务/浏览器/原生实例
已删除：本轮运行沙盒；已完成 Worktree（Router 确认）
证据归档：.tmp/evidence/milestone-<ID>/
保留项：无；或逐项列出路径、负责人、原因、清理触发条件
```

`PASS` 表示必需资源已回收，必要保留项有明确处置责任；`FAIL` 表示存在清理失败或无法解释的残留。证据目录不随运行沙盒删除，保留策略由里程碑区块或人类另行指定。
