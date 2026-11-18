# Pith · 里程碑调度板

> 协议以 [ROLES.md](ROLES.md) 为准，Router 每次取单前重读。状态：`pending` · `verified` · `blocked` · `superseded`；先后只看 `Depends-On`。
>
> 各里程碑共用的规则：
> 1. 目标契约在 `docs/`，实现与验收状态在 [FEATURES.md](FEATURES.md)。`Features` 字段列出推进或动到的条目，结案按 ROLES「功能台账同步」更新。
> 2. 格式演进按 [AGENTS.md](../AGENTS.md) 核心约束 3。被新契约取代的测试直接改写或删除，并在 Worker 报告里列出。
> 3. 冻结的内核形状在 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 4 节；契约自相矛盾或无法落地时标 `blocked`，不自行改契约。
> 4. 默认门禁、验收方式与清理见 ROLES「默认门禁与验收」「归档与清理门禁」，区块里只写偏离项。
> 5. 仓库类验收样本：本地 `/Users/zejiawu/Projects/Project-Atlas/infra/magpie` 与 `/Users/zejiawu/Projects/Project-Atlas/infra/deepseek-harness`（只读：先 `git clone` 到 `.tmp/` 再用副本，不在原仓库执行任何写操作），GitHub 上的 `https://github.com/herdrdev/herdr` 与 `https://github.com/pingdotgg/t3code`。

---

## [Milestone #60] 仓库版本与讲义绑定
- **Status**: verified
- **Verified-Commit**: 1280386219246c965e59080463e65ca562c921c1
- **Depends-On**: #59
- **Features**: F-REPO-VERSIONS、F-LESSON-VERSION
- **结果**: 程序部分通过：版本导入、材料库合卡、改用、「基于旧版本」标记、出处按版本解析，原生玩具仓库的调整路径也通过。真实 magpie 上的「按新版本调整」没有改成任何讲义（Web 回合结束时没有写入，原生在调整前被取消），两行台账降为待复验，由 #61 补验。证据：`.tmp/evidence/task-60/tester/adjustment-v2/final-report.md`。

---

## [Milestone #61] 发布 v0.2.0：学 GitHub 仓库
- **Status**: pending
- **Verified-Commit**: none
- **Depends-On**: —
- **发布版本**: v0.2.0
- **Features**: F-INTAKE-GITHUB、F-REPO-SEARCH、F-REPO-VERSIONS、F-LESSON-VERSION
- **用户可观测目标**：Obsidian 插件列表里的 Pith 显示 0.2.0。用户能贴 GitHub 链接导入仓库，让向导在代码里搜索并写讲义，点讲义里的出处跳到对应版本的代码；仓库更新后，能导入新版本并让课题改用它。
- **Tester 验收**：
  1. Web 与 Obsidian 各走一遍人类的真实课题「agent 框架怎么划分内核与插件」：magpie、deepseek-harness 用副本的本地路径，herdr、t3code 贴链接导入；带目标立项，向导搜索代码并写讲义，点出处跳转，记笔记，结题。
  2. 版本路径：magpie 副本先停在 `965ae78e1` 立项写讲，再快进到较新的上游提交；在材料库「检查更新」导入新版本，再点一次提示已是最新；课题「改用」新版本后，旧讲标「基于旧版本」，出处仍跳回旧代码。点一次「按新版本调整」，只核对请求已发出、回合正常结束、失败时能重新请求。
  3. 抽查 v0.1.0 已验收的投喂、阅读、离线可用、搁置与恢复没有退化。
  - 程序部分逐项必须通过。模型产出（讲义内容、「按新版本调整」改没改成讲义）按 ROLES「程序保证与模型产出分开验收」记录原始输出、写进已知缺口，不打回、不阻塞发布。
  - 发布前清债：本版范围内的待复验条目只有 F-REPO-VERSIONS 与 F-LESSON-VERSION，由第 2 步独立验收；其他待复验条目（F-SANDBOX、多媒体等）不在本版范围。
- **不在范围内**：费曼复述保持 v0.1.0 的行为（保存复述后自动发起向导追问，F2 是已知缺口），不按 [3-toolkits.md](subsystems/3-toolkits.md) 3.3 第 5 步验收，也不改费曼代码；追问另行重新设计，不阻塞本次发布。不加新功能。
- **Scope**：`manifest.json` 与 `package.json` 的 `version` 改为 `0.2.0`；验收工作区 `.tmp/evidence/milestone-61/`。验收中发现的程序缺陷按 ROLES「显性问题不出执行环」修复，Scope 按缺陷所在文件授权。
- **报告**：`.tmp/evidence/milestone-61/final-report.md`。通过后按 ROLES「发布步骤」发布。

---

## [Milestone #63] 费曼复述：看完原文再复述一次
- **Status**: pending
- **Verified-Commit**: none
- **Depends-On**: #61
- **发布版本**: v0.3.0
- **Features**: F-FEYNMAN
- **用户可观测目标**：在课题里对一段文字做费曼复述：遮住原文写一遍，提交后逐条看到说到、未提及、说反和原文；看完点「再复述一次」重写，这次的结果在状态变化的条目旁标出上一次的状态。复述之后不会自动出现向导回合。Obsidian 插件列表里的 Pith 显示 0.3.0。
- **Tester 验收**：Web 与 Obsidian 各一次，用真实 Agent。
  1. 选一段复述，故意漏一条、说反一条：逐条结果正确，向导栏没有新回合。
  2. 点「再复述一次」：原文重新遮住，结果收起，文本框为空；这次补上漏掉的那条，它显示「说到」并标「上次：未提及」，没变的条目不标。
  3. 关掉卡片、重开同一段再复述，「上次」仍按最近一次比较；重新加载宿主后也一样。
  4. 课题笔记里每次提交各有一条作者是你的实训记录，带对照结果；结题门禁认它们。
  5. 断开向导：卡片说明对照不可用，复述仍能保存，没有「再复述一次」。
  6. 之前版本留下的费曼实训记录照常显示在笔记里，不参与「上次」比较。
- **不在范围内**：向导与提示词（`runTurn` 的 `instruction` 通道保留给「按新版本调整」）；抽要点与对照的提示词；其他训练工具。
- **Scope**：`src/plugins/toolkit-feynman/**`、`src/core/seams.ts`、`src/workbench/**`、`src/shells/**`、`tests/**`、`manifest.json`、`package.json`
- **行为契约**：按 [3-toolkits.md](subsystems/3-toolkits.md) 第 2 节与 3.3、[ARCHITECTURE.md](ARCHITECTURE.md) 第三节落地。暴力重构，不留兼容，不留残留：
  1. 删除 `ToolkitDescriptor.followUp`、`recallFollowUp`、工作台的追问端口与 `followUpError`、视图与两个宿主壳里的 `followUpPractice` 接线、追问相关的状态文案，以及只为它们存在的参数（如 `RecallPractice.submit` 的 `toolkit`）。被取代的测试直接删除或改写，Worker 报告逐个列出。
  2. 新增的只有三样：实训记录的 `result.passage`；「再复述一次」；对照结果里的「上次：…」标记。不新增设置、存储文件或模型请求。
  3. 不读取、不迁移、不补写旧的费曼记录。
  4. `manifest.json` 与 `package.json` 的 `version` 改为 `0.3.0`。
- **Worker 门禁**（默认门禁之外）：`tests/boundaries.test.ts` 加一条守卫：`src/` 里不出现 `followUp`、`recallFollowUp`、`followUpPractice`。手动破壁各一次后恢复，对应断言须各自变红：「上次」匹配不比较 `passage`；「再复述一次」后结果没有收起或原文没有遮住；保存复述后发起了课题回合；`result` 缺 `passage`。
- **结案**：F-FEYNMAN 的「用户能做什么」改为「费曼复述：遮住原文复述，逐条对照原文；看完原文可以再复述一次，变化的条目标出上一次的状态」，其余列按 ROLES「功能台账同步」更新。LESSONS 中「模型追问须验实际问题是否对应本次缺口」一条移到已晋升列表，指向 3-toolkits 3.3 与上面的守卫测试。通过后按 ROLES「发布步骤」发布 v0.3.0。
