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
- **Status**: superseded (by #64)
- **取代原因**: 人类要求已知问题一律改造、不作已知缺陷发布。「按新版本调整」在真实仓库上改不成讲义，由 #64 改为程序判断受影响的讲、逐讲请向导重写，并在同一里程碑发布 v0.2.0。
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
- **Status**: verified
- **Verified-Commit**: 68c1a0e99678dba9661d18ba68f75c3e46b6a9c4
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
  7. Web 端在抽要点进行中关掉卡片，对应的后台 Agent 请求随即结束（与原生一致）。
- **不在范围内**：向导的其他行为与提示词规则；抽要点与对照的提示词；其他训练工具。
- **Scope**：`src/plugins/toolkit-feynman/**`、`src/core/seams.ts`、`src/core/engine/**`、`src/plugins/guide-acp/**`、`src/workbench/**`、`src/shells/**`、`tests/**`、`manifest.json`、`package.json`
- **行为契约**：按 [3-toolkits.md](subsystems/3-toolkits.md) 第 2 节与 3.3、[ARCHITECTURE.md](ARCHITECTURE.md) 第三节落地。暴力重构，不留兼容，不留残留：
  1. 删除 `ToolkitDescriptor.followUp`、`recallFollowUp`、工作台的追问端口与 `followUpError`、视图与两个宿主壳里的 `followUpPractice` 接线、追问相关的状态文案，以及只为它们存在的参数（如 `RecallPractice.submit` 的 `toolkit`）。被取代的测试直接删除或改写，Worker 报告逐个列出。
  2. 新增的只有三样：实训记录的 `result.passage`；「再复述一次」；对照结果里的「上次：…」标记。不新增设置、存储文件或模型请求。
  3. 不读取、不迁移、不补写旧的费曼记录。
  4. `instruction` 通道一并删除：#64 去掉「按新版本调整」后，费曼追问是它唯一的使用者。删除 `runTurn`、`retryTurn`、`GuideTurn.user`、`GuideProvider.run`、宿主壳与 Web 接口里的 `instruction`，以及场景提示词的「本回合指令」段（[1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 4 节、[4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.2）。旧 `conversation.json` 里残留的 `instruction` 字段不读、不迁移。
  5. Web 入口把取消传到服务端：卡片关闭或重开时，Web 端正在进行的抽要点与对照请求随之中止，与原生一致。
  6. `manifest.json` 与 `package.json` 的 `version` 改为 `0.3.0`。
- **Worker 门禁**（默认门禁之外）：`tests/boundaries.test.ts` 加一条守卫：`src/` 里不出现 `followUp`、`recallFollowUp`、`followUpPractice`、「本回合指令」，也没有名为 `instruction` 的字段或参数（提示词正文里的英文单词不算）。手动破壁各一次后恢复，对应断言须各自变红：「上次」匹配不比较 `passage`；「再复述一次」后结果没有收起或原文没有遮住；保存复述后发起了课题回合；`result` 缺 `passage`；Web 端关闭卡片后服务端请求没有中止。
- **结案**：F-FEYNMAN 的「用户能做什么」改为「费曼复述：遮住原文复述，逐条对照原文；看完原文可以再复述一次，变化的条目标出上一次的状态」，其余列按 ROLES「功能台账同步」更新。LESSONS 中「模型追问须验实际问题是否对应本次缺口」一条移到已晋升列表，指向 3-toolkits 3.3 与上面的守卫测试。通过后按 ROLES「发布步骤」发布 v0.3.0。
- **结果**：真实 Web 与 Obsidian 七项通过，包括复练、仅变化项显示上次、离线重开不重复入账、旧记录及关卡取消。Cleanup PASS。报告与截图：`.tmp/evidence/milestone-63/tester-recheck-2/`。默认 `ganfan-media` 已安装，附注标签 `v0.3.0` 指向 Verified-Commit，安装件 SHA-256 见 `.tmp/evidence/milestone-63/delivery.txt`。

---

## [Milestone #64] 仓库新版本：程序判断哪些讲受影响，并发布 v0.2.0
- **Status**: verified
- **Verified-Commit**: 00e761223f2b227aef2f35d747eb4ce0e74b5686
- **Depends-On**: —
- **发布版本**: v0.2.0
- **Features**: F-INTAKE-GITHUB、F-REPO-SEARCH、F-REPO-VERSIONS、F-LESSON-VERSION
- **用户可观测目标**：仓库更新后，在材料库「检查更新」导入新版本，在课题里「改用」它：引用的文件没变的讲自动跟上新版本；变了的讲标「基于旧版本」并列出变化的文件。在这样的讲上点「请向导按新版本重写」，向导输入框里出现写好的消息，发送后向导只重写这一讲。没有「按新版本调整」按钮。Obsidian 插件列表里的 Pith 显示 0.2.0。
- **Tester 验收**：Web 与 Obsidian 各一次，用真实 Agent，样本按头部规则 5。
  1. 真实课题「agent 框架怎么划分内核与插件」：magpie、deepseek-harness 用副本的本地路径，herdr、t3code 贴链接导入；带目标立项，向导搜索代码并写讲义，点出处跳转，记笔记，结题。
  2. 版本路径：magpie 副本先停在 `965ae78e1` 立项，写出至少两讲且讲义引用代码；把副本快进到较新的上游提交，在材料库「检查更新」导入新版本，再点一次提示已是最新。课题「改用」新版本后，用 `git diff` 独立核对：每一讲是否标记，与它引用的文件有没有变化一致；没标记的讲出处跳到新版本；标记的讲列出的文件与实际变化一致。
  3. 在一个标记的讲上点「请向导按新版本重写」：输入框里的消息点名这一讲、变化的文件和两个短提交号；发送后对话里是一条普通消息；向导写完后这一讲的标记消失、出处跳到新版本，旧版本上的笔记仍跳回旧代码。向导写得好不好按 ROLES「程序保证与模型产出分开验收」记录，不打回。
  4. 受控用例：玩具仓库只改其中一讲引用的文件，改用后只有那一讲被标记；经 Worker 提供的受控入口让比较失败一次，依据不变、标记保留并说明原因。
  5. 断开向导：「请向导按新版本重写」不可用并说明原因；「改用」和自动改依据照常。
  6. 抽查 v0.1.0 已验收的投喂、阅读、离线可用、搁置与恢复没有退化。
  - 发布前清债：本版范围内的待复验条目只有 F-REPO-VERSIONS 与 F-LESSON-VERSION，由第 2 到 5 步独立验收；其他待复验条目不在本版范围。
- **不在范围内**：费曼（#63）；`instruction` 通道本里程碑不动（费曼的旧追问还在用，由 #63 删除）；新功能。
- **Scope**：`src/core/**`、`src/workbench/**`、`src/shells/**`、`src/plugins/stage-reader/**`、`src/plugins/guide-acp/**`、`tests/**`、`manifest.json`、`package.json`
- **行为契约**：按 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 不变量 11、[2-stages.md](subsystems/2-stages.md) 第 2 节第 3 条、[4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.2「新版本」、[5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md) 4.2 落地。暴力重构，不留兼容，不留残留：
  1. 删除「按新版本调整」按钮、`ADJUST_LESSONS_MESSAGE`、视图与两个宿主壳里的 `adjustLessons` 接线，以及只为它们存在的代码和测试，Worker 报告逐个列出。
  2. 出处识别抽成一份纯函数，放在 `src/core/`、与 `repositoryVersions.ts` 同处；视图渲染出处与「这一讲引用了哪些文件」都调用它，不留第二套匹配规则。
  3. 「改用」之后的比较与改依据只有一份共享实现，两个宿主壳只接线：比较用 `RepositoryPort.listChanges`，改依据用 `rebaseLesson`；比较失败时不改依据，标记保留并显示原因。变化的文件按需计算，不新增存储。
  4. 「请向导按新版本重写」只把消息放进输入框，不自动发送，不带 `instruction`。
  5. 已有讲义没有 `basedOn` 时按 1-core 3.2 的缺省规则读取，不改写已有账本。
  6. `manifest.json` 与 `package.json` 的 `version` 改为 `0.2.0`。
- **Worker 门禁**（默认门禁之外）：`tests/boundaries.test.ts` 加一条守卫：`src/` 里不出现 `ADJUST_LESSONS_MESSAGE`、`adjustLessons`。手动破壁各一次后恢复，对应断言须各自变红：改用后不比较、全部改依据；视图另写一套出处匹配，结果与共享函数不一致；比较失败时仍改依据；「请向导按新版本重写」直接发送。另交付两个宿主上可执行的受控入口，让比较失败一次。
- **结案**：F-REPO-VERSIONS、F-LESSON-VERSION 按 ROLES「功能台账同步」更新。通过后按 ROLES「发布步骤」发布 v0.2.0。
- **结果**：Web 与 Obsidian 真实四仓课题、版本比较、逐讲重写和结题通过；受控比较失败保留旧依据，离线仍可改用，旧笔记保持旧出处。双端 1280/390px 结题计数复验通过，Cleanup PASS。证据：`.tmp/evidence/milestone-64/tester/final-report.md`、`.tmp/evidence/milestone-64/tester-recheck/final-report.md`（双端终验截图同目录）。默认 `ganfan-media` 已安装并校验，附注标签 `v0.2.0` 指向 Verified-Commit；三个 SHA-256 与安装记录见 `.tmp/evidence/milestone-64/delivery.txt`。

---

## [Milestone #65] 向导用顶尖课程编排讲义，并发布 v0.4.0
- **Status**: verified
- **Verified-Commit**: d24393ee31919877635bf1b925c0e97c68c17381
- **Depends-On**: #63
- **发布版本**: v0.4.0
- **Features**: F-SOURCE-COURSES、F-GUIDE-INGEST、F-LESSON-CITE、F-SETTLE
- **用户可观测目标**：用户的材料不够回答他的问题时，向导去 MIT OCW 等名校公开课和经典教材里，挑出讲这个问题最好的那几讲，只把相关的讲义、习题、考试和官方解答导入成一份材料，并说明为什么选、跳过了什么。讲义里的 PDF 页码出处点一下就打开到那一页，讲座视频用带时间点的公开链接。结题优先用那门课的官方题检验，结题后的选项里有下一个值得投入的问题。Obsidian 插件列表里的 Pith 显示 0.4.0。
- **Tester 验收**：Web 与 Obsidian 各一次，用真实 Agent。
  1. 选一个需要大学课程才能讲透的问题（例如「进程之间怎么靠页表做隔离」），不带材料立项：过程里有 `pith_read_external` 浏览课程页面的步骤；导入的是一份材料，只含相关讲次的 PDF，文件按链接命名、都能阅读；回复说明了选择理由与跳过的内容。
  2. 讲义里的 `文件名#page=N` 出处可点，打开到对应页；故意改错的页码或文件名按普通文字显示；讲座视频链接带时间点。
  3. 提出结题：检验题来自材料里带官方解答的考试或习题，向导对照官方解答回应；结题后的选项包含下一个问题和对应讲次。第 1、3 步的选材与出题质量是模型产出，按 ROLES「程序保证与模型产出分开验收」记录，不打回。
  4. 程序部分：只读浏览不产生材料；多个链接合成一份材料；超出数量或大小上限、某个链接失败、内网地址或重定向时，整次导入以原因失败，不留下材料。
  5. 抽查仓库学习、费曼复述、离线可用、搁置与恢复没有退化。
- **不在范围内**：学习路线、课程模板、整门课离线包导入、「习题」工具、EPUB 章节出处、导入讲座视频、在 Pith 里运行代码。

### 切片
1. **S1** `Scope: src/plugins/guide-acp/**、src/shells/**、tests/**、manifest.json、package.json`：按 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.2 与 2.5 落地。新增只读工具 `pith_read_external`；`pith_ingest_external` 接受 PDF，一次 1 到 20 个链接合成一份材料，文件按链接命名，网页不超过 4 MB、PDF 不超过 32 MB、合计不超过 128 MB，任何一个失败则整次失败、不留材料，地址与传输沿用现有的公网校验；场景提示词加「选材」规则，并改「讲义」「结题」两条。不加输出校验或门槛（[ARCHITECTURE.md](ARCHITECTURE.md) 第三节）。`version` 改为 `0.4.0`。
2. **S2** `Scope: src/core/**、src/workbench/**、src/plugins/stage-reader/**、src/plugins/stage-timeline/**、tests/**`：按 [2-stages.md](subsystems/2-stages.md) 第 3 节「讲义里的出处」，在 #64 的那一份共享出处识别函数上扩展 `#page=` 与 `#t=`，不另写第二套匹配规则；点击后在舞台打开文件并定位，音视频不自动播放；越界、对不上的按普通文字显示，同名文件按材料分别给出处。

- **Worker 门禁**（默认门禁之外）：手动破壁各一次后恢复，对应断言须各自变红：只读工具写入了材料；多个链接中有一个失败时仍留下材料；视图另写一套出处匹配、与共享函数的结果不一致；越界页码仍可点击跳转。
- **结案**：F-SOURCE-COURSES、F-GUIDE-INGEST、F-LESSON-CITE、F-SETTLE 按 ROLES「功能台账同步」更新。通过后按 ROLES「发布步骤」发布 v0.4.0。
- **结果**：代码提交 `d24393ee31919877635bf1b925c0e97c68c17381`；Web 与 Obsidian 的首轮真实 Agent 均完成选课、三份 PDF 合为一份材料、官方题作答与结题。首轮发现沉淀后选项被隐藏及窄原生栏长出处溢出；修复后同一独立 Tester 在 Web 与真实隔离 Obsidian 实点当前/重开只读选项，并验证长出处完整换行且准确跳到第 2 页。后续真实 Agent 重试出现模型未完成、上游失败及普通 HTTP 301 被 fail-closed 拒绝，均记录为模型样本/预期安全拒绝，不改变安全边界；模型产出质量未作为程序门禁。双端普通 404 批导无残留、只读零写入、旧仓库/费曼/离线/搁置抽查通过；数量/大小边界依赖 Worker 门禁，不做不安全的真实内网或重定向请求。Cleanup PASS。v0.4.0 已安装默认 `ganfan-media`；附注标签 `v0.4.0` 指向本 Verified-Commit。提交、标签及三项 SHA-256：`.tmp/evidence/milestone-65/delivery.txt`；真实双端报告及截图：`.tmp/evidence/milestone-65/tester/`、`.tmp/evidence/milestone-65/tester-recheck-2/`、`.tmp/evidence/milestone-65/tester-recheck-3/`。

---

## [Milestone #66] OCW 链接直接可用：安全跟随重定向、能搜索课程，并发布 v0.4.1
- **Status**: pending
- **Verified-Commit**: none
- **Depends-On**: —
- **发布版本**: v0.4.1
- **Features**: F-GUIDE-INGEST、F-SOURCE-COURSES
- **背景**：#65 验收第 4 步把「重定向」列为整次导入应当失败的情况，这条是 Brain 写错的。MIT OCW 对不带结尾斜杠的地址和 `http` 地址都返回 301，真实原生回合因此两次失败，却按预期拒绝结案、发布了（`.tmp/evidence/milestone-65/tester-recheck-3/obsidian-progress.md`）。另外，OCW 自己的搜索页靠浏览器脚本渲染，阅读器又不读 JSON，向导只能凭记忆里的课程地址选课。
- **用户可观测目标**：向导找课程时能搜到 MIT 的课程目录；向导写出的 OCW 地址不带结尾斜杠或用 `http` 时，照样能浏览和导入。Obsidian 插件列表里的 Pith 显示 0.4.1。
- **Tester 验收**：Web 与 Obsidian 各一次，用真实 Agent。
  1. 不带材料立项，换一个与 #65 不同、需要大学课程才能讲透的问题（例如「操作系统调度为什么要区分 I/O 密集与 CPU 密集的进程」）：过程里先用 `pith_read_external` 读 MIT Learn 搜索接口的 JSON，再浏览课程与讲次页面；导入一份只含相关讲次 PDF 的材料；讲义出处可点到页码；结题优先用官方题。选材与出题质量按 ROLES「程序保证与模型产出分开验收」记录。
  2. 程序部分，受控与真实各至少一例：`pith_read_external` 读一个不带结尾斜杠的 OCW 课程地址和一个 `http` 地址，都拿到最终页面，页面里的相对链接按最终地址解析；导入一个经过重定向的 PDF 链接，材料来源与文件名取自最终地址。经 Worker 的受控入口：重定向到内网地址、从 `https` 降到 `http`、超过 5 跳，分别以写明那一跳地址的原因失败，不留材料。
  3. 抽查 v0.4.0 的出处跳转、费曼复述与仓库学习没有退化。
- **不在范围内**：新功能；为其他网站写专用适配。
- **Scope**：`src/shells/**`、`src/plugins/guide-acp/**`、`tests/**`、`manifest.json`、`package.json`
- **行为契约**：按 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.2「选材」与 2.5「规则」中「公网传输」和 JSON 两条落地。暴力重构，不留兼容：
  1. 公网传输只留一份实现，Web、Obsidian 与 dsh 共用。删除 `DshPublicHttpPort` 里的副本（它的 IPv6 判断与 Web 的不一样）；媒体下载的重定向循环改用这份实现，只在其上保留下载主机白名单。
  2. 重定向在传输里跟随，不交给向导重试；结果带最终地址。
  3. 阅读器读 JSON；导入不收 JSON。
  4. `manifest.json` 与 `package.json` 的 `version` 改为 `0.4.1`。
  5. `main` 自 v0.4.0 起只有文档提交，直接在 `main` 上修复与发布，不另拉 release 分支。
- **Worker 门禁**（默认门禁之外）：`tests/boundaries.test.ts` 加一条守卫：`src/` 里只有一个类实现 `requestPublic`。手动破壁各一次后恢复，对应断言须各自变红：某一跳不重新校验公网地址；允许 `https` 降到 `http`；不限跳数；相对链接按请求地址而不是最终地址解析；阅读器把 JSON 当成不支持的类型。
- **结案**：F-GUIDE-INGEST、F-SOURCE-COURSES 按 ROLES「功能台账同步」更新。Router 把这次漏判（程序按契约拒绝、挡住了真实主路径，仍按预期拒绝发布）记入 LESSONS。通过后按 ROLES「发布步骤」发布 v0.4.1。
