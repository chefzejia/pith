# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：
> **单文件滑动任务栈与多 Worktree 协同契约**：详见 [ROLES.md](ROLES.md) 等文档。
>
> **状态**：`pending`（执行环按序执行）· `queued`（前置任务未完成，执行环不执行）· `verified` · `blocked` · `superseded`。Router 核销一个任务时，在同一次提交里把 `Depends-On` 已全部满足的 `queued` 任务改为 `pending`（[ROLES.md](ROLES.md) 第 2 条）；前置任务 `blocked` 时链条停住，等 Brain。
>
> **本轮重构规则**，各任务不再重复：
> 1. 目标契约在 `docs/`；各功能的实现与验收状态、已知缺口在 [FEATURES.md](FEATURES.md)。任务区块用 `Features` 字段列出它推进的台账条目（没有就写 `—`），核销时按 [ROLES.md](ROLES.md) 第 2 条同步这些行。
> 2. 格式演进按 [AGENTS.md](../AGENTS.md) 核心约束 3：代码不读旧格式、不留别名；已发布的磁盘格式只做加法，破坏性变更须先由人确认并由发布任务附一次性迁移脚本。被新契约取代的测试直接改写或删除，并在 Worker 报告里逐个列出文件名与原因；不得为了让旧测试通过而保留旧行为。
> 3. 冻结的内核形状在 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 4 节。发现契约自相矛盾或无法落地时标 `blocked` 并写明证据，不自行改契约。
> 4. 每个任务的 Worker 门禁都包含 `npm run typecheck`、`npm test`；改到 `src/workbench/`、`src/shells/` 或舞台渲染的还包含 `npm run test:browser` 与 `npm run build:obsidian`。下面各任务只列额外的门禁。
> 5. 清理按 [ROLES.md](ROLES.md) 第 7 条。

---

## [Task #52] 工作台：材料库、材料阅读、立项与工具归属
- **Status**: verified
- **Depends-On**: #55, #56
- **Verified-Commit**: d9aa70543bb99cec47a22833e7fabf305f2a307e
- **Implementation-Commit**: 11713d05cdbdef7e9fb033ee4ea88de324c7c184
- **Supplemental-Commits**: e9420ac4d88ad9f13a09940c83ee373022a853cc、f902c20ecc13dd797f6aa41f2fb3e2f9c3122f2f、9e2a3e431b2f4b0c3e8bd2cd9b10adfceda00d41、d9aa70543bb99cec47a22833e7fabf305f2a307e
- **Updated**: 2026-11-14
- **Brain 裁决（2026-11-14，契约与本区块在同一提交）**：阻塞成立，错在契约。冻结的 `Material` 没有给仓库材料的阅读位置留表示：`files: []` 对仓库合法，`updateReadingLocator` 只能更新已有的文件条目。裁决是给 `Material` 加可选的 `reading`（最后打开的文件、坐标、时间），平铺存进 `material.md`，唯一写入口是新增的 `recordReading`。不存进缓存，不造假文件条目，不借笔记，也不按课题存（材料不依赖课题，[1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 2 节不变量 1）。契约改动见该文档 3.3 与第 4 节。
- **上一轮阻塞记录（已解决）**: 旧实现把仓库最近文件、坐标与打开时间只写可删除缓存；Brain 在 `3d3d24b` 冻结永久 `Material.reading` 与 `recordReading`，业务 `d9aa705` 落地，双宿主整缓存删除、同库重启独立终验通过。原始证据保留于 `.tmp/evidence/task-52/router-reading-contract.md`，当前通过证据见 `permanent-reading/tester/tester-report.md`。
- **补验进展**: 已按新依赖顺序续验，目录长标题与状态标签、引用材料原有高亮/笔记的只读分区与独立计数、跨课题记录隔离、来源切换、锚点回跳及按钮文案通过实际双宿主交互。原生“课题向导 → 首页 → 独立材料笔记”的空侧栏与正文遮挡已修复，独立 Tester 在 1024×800 复验正文与笔记并排，并确认原已展开/主动选中的大纲保留、向导可见状态记忆及关闭阅读 tab 后清理。首页真实 dsh 读材料后、创建课题前停止，两端各一次成功，目标、1 份材料保留且课题为 0。报告索引：`.tmp/evidence/task-52/router-resume-progress.md`；目录终验：`drawer-fix/tester/tester-report.md`；记录补验：`material-notes-fix/retry-tester/tester-report.md`；原生返修终验及 10 张截图：`native-layout-fix/tester/`（后三者均相对 `.tmp/evidence/task-52/`）。
- **验证与边界**: 当前业务全仓 typecheck、单测（359 pass / 97 skip / 0 fail）、浏览器（51 文件，139 pass / 4 条真实语音条件 skip / 0 fail）、Obsidian 构建及 6 项破壁红后恢复通过；dist / `.dev-vault` / 原生实载三文件哈希一致。永久 reading 独立终验在带界面 Chrome 与真实专属 Obsidian 串行通过：GUI 打开仓库嵌套文件和普通第二文件并实际滚动，删整个 `_cache`、同库重启后恢复文件与语义坐标；首页再次打开材料前 file/locator/openedAt 完全一致，合法 file-only 与三种坏账本原因通过。普通材料课题入口显式选第二文件后验证坐标复用，默认最后文件由独立材料入口覆盖；未宣称像素位置完全一致。此前 UI/真实 Agent/翻译沿用分项报告，不把受控故障冒充真实模型行为；无正式 GUI 入口的目录分支仍只有工程覆盖，自然服务失败/自然追问未自然覆盖。Worker/Tester 自有进程、配置、运行目录已回收，唯一 main worktree，Cleanup PASS。新报告及 20 张终验 PNG：`.tmp/evidence/task-52/permanent-reading/tester/tester-report.md`、`.tmp/evidence/task-52/permanent-reading/tester/`；工程报告：`permanent-reading/worker-report.md`。未交付真实 Vault，整体交付归 #54。
- **Scope**: `src/core/types.ts`、`src/core/store/**`、`src/workbench/**`、`src/shells/**`、`src/plugins/toolkit-*/**`、`src/core/seams.ts`、`tests/**`、`docs/ARCHITECTURE.md`
- **契约**: 首页立项分流与材料库、材料阅读场景（高亮/笔记）、课题内目录/抽屉、工具归属（按角色/role）与行间驱动。
- **补充契约（仓库阅读位置）**:
  1. 数据表示与读写语义按 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 3.3 与第 4 节：`Material.reading`（`file`、`locator?`、`openedAt`）存在 `material.md` 的三个平铺字段里，`WorkspaceStore.recordReading` 是唯一写入口。所有材料种类统一走它；非仓库材料逐文件的 `files[].locator` 继续由 `updateReadingLocator` 写。
  2. `src/workbench/readingState.ts` 不再读写 `_cache/reading/`：`readMaterialReading`、`materialReadings`、`rememberMaterialReading` 改为读写 `Material.reading`，`_cache/reading` 这个路径不再出现在 `src/`（加守卫单测）。调用点：`src/workbench/boardMaterials.ts`、`src/shells/obsidian/index.ts`（打开文件与课题会话）、`src/shells/web/server.ts`（打开文件与 `/api/topic-session`）。
  3. 解析 `material.md` 时，`readingFile` 与 `readingOpenedAt` 成对出现，`readingLocator` 不单独出现；仓库路径按 3.6 第二套规则校验，非仓库材料的文件名必须在 `files` 里。不合格的材料进入「无法读取」，原因由解析器给出。
  4. 不迁移旧缓存：已有的 `_cache/reading/` 文件不读取、不转换（[AGENTS.md](../AGENTS.md) 核心约束 3）。
- **补充门禁**: 回归从磁盘字节构造：仓库材料（`files: []`）打开一个嵌套路径的文件并记下坐标后，删除整个 `_cache/` 并重启，首页材料库的「读到哪里」与课题内重开的文件、坐标都不变；非仓库材料同样，并覆盖「只有文件、没有坐标」的情形。`readingFile` 带 `..` 段、缺 `readingOpenedAt`、只有 `readingLocator` 的 `material.md` 各自进入「无法读取」。手动破壁各一次：把 `recordReading` 改回写 `_cache/reading/`、让解析器放过 `..` 路径段，对应回归变红。Tester 终验在原有路径上补一步：打开仓库文件、删 `_cache/`、重启，两个宿主壳都回到同一文件与坐标。
- **交付**: 不交付。整体在 #54 终验后交付。

---


## [Task #53] 费曼复述：要点对照
- **Status**: verified
- **Depends-On**: #52
- **Verified-Commit**: 908aa0f9ad9bfb68941f09fdd3e4e49901edfee5
- **Updated**: 2026-11-15
- **验收结果**: 要点预抽、引文核对、逐条对照、失败保存与显式重试、成功后自动追问通过。真实 Agent 分类 v5 重复与独立短文、双宿主 covered/missing/contradicted 首问沿用各分项实测；首次选区原文与追问漂移已修复并独立复验。最后取消归属修复通过有限双宿主终验：原生在抽取 held 后 267ms 连续三击重选、一次重开即 ready，提交前零记录，提交后恰好一条 user practice/result，原文与锚点一致；Web 相同路径成功，保留其 HTTP 不传视图 signal 的边界。最后时序验收使用明确标注的受控外部 ACP，不冒充模型质量；超过默认期限的首样本不计取消通过证据，原始失败保留。最终 typecheck、全仓单测（371 pass / 101 skip / 0 fail）、browser（143 pass / 4 语音条件 skip / 0 fail）、构建与四项精准破壁通过；加载三哈希一致，自有资源全部回收，Cleanup PASS。报告与终验截图：`.tmp/evidence/task-53/fix-prepare-cancellation/tester/tester-report.md`、`.tmp/evidence/task-53/fix-prepare-cancellation/tester/`；真实分类/首问及前轮故障边界：`.tmp/evidence/task-53/prompt-v5/`、`.tmp/evidence/task-53/holdout/`、`.tmp/evidence/task-53/fix-selection-followup/tester/tester-report.md`、`.tmp/evidence/task-53/tester/tester-report.md`。未交付真实 Vault，归 #54。
- **Scope**: `src/plugins/toolkit-feynman/**`、`src/core/seams.ts`（`followUp`）、`src/workbench/**`、`src/shells/**`、`tests/**`、`docs/ARCHITECTURE.md`
- **契约**: 费曼新规程（对照原文、要点/复述的自动化核对、追问机制、evalMode 修正）。
- **交付**: 不交付。整体在 #54 终验后交付。

---

## [Task #54] 终验：整体验收与交付
- **Status**: pending
- **Depends-On**: #53
- **发布版本**: v0.1.0
- **Updated**: 2026-11-16
- **Scope**: 验收工作区 `.tmp/evidence/task-54/`。包含：契约对照、全量门禁、真实用户路径（投喂/立项/课题内/训练/结题/搁置/无Agent/沙盒/旧格式）、观感终审包。
- **报告**: `.tmp/evidence/task-54/final-report.md`。
- **交付**: 以上全部通过后执行 [ROLES.md](ROLES.md) 第 6 条。

---

## [Task #57] 台账守卫与 #54 结果入账
- **Status**: queued
- **Depends-On**: #54
- **Features**: —
- **Updated**: 2026-11-16
- **Scope**: `tests/**`、`docs/FEATURES.md`
- **契约**:
  1. 新增 `tests/feature-ledger.test.ts`，校验 [FEATURES.md](FEATURES.md) 与本文件：
     - 「功能清单」各表的表头为 `| ID | 用户能做什么 | 状态 | Web / Obsidian | 最近独立验收 | 已知缺口 |`；ID 由 `F-` 接大写字母与连字符组成，全文唯一。
     - 「状态」只取 `已验收`、`待复验`、`契约`；「Web / Obsidian」形如 `x / y`，x、y 只取 `✓`、`○`、`–`。
     - `已验收` 的行至少有一个 `✓`，「最近独立验收」含 `#<任务号> @<7 位提交>`，且该提交在仓库历史里存在。
     - 「回归测试」表的 ID 集合与功能清单完全一致；每个 ID 至少一个测试链接，状态为 `契约` 的可以写 `—`（链接能否打开由现有文档链接守卫负责）。
     - `docs/subsystems/` 下每个文件都被 [ARCHITECTURE.md](ARCHITECTURE.md) 链接。
     - 本文件中任务区块的 `Features` 字段（`—` 除外）只列台账里存在的 ID；`verified` 区块所列的每一行，「最近独立验收」引用的提交等于该区块的 `Verified-Commit`，或是它的后代。
  2. 按 #54 的终验报告（`.tmp/evidence/task-54/final-report.md`）与本文件中的 #54 区块，同步台账「发布与里程碑」中 v0.1.0 列出的各行：状态、宿主、最近独立验收、已知缺口；同时把里程碑表里 v0.1.0 一行的状态改成验收结果（当前发布版本由 Router 在 #54 核销时按 [ROLES.md](ROLES.md) 第 6 条更新）。只同步事实，不增删条目，不改「提议」与契约文档；报告与台账冲突或判断不了的行，列进 Worker 报告交 Router 判定。
- **Worker 门禁**: 手动破壁各一次后恢复，对应断言须各自变红：把一行状态改成非法词；删掉某个 ID 的回归测试行；在 `docs/subsystems/` 放一个没被链接的文件；让一个带 `Features` 的 `verified` 区块所列行引用更早的提交（可用合成的区块文本）。
- **Tester 验收**: 本任务没有界面。Tester 逐行对照 #54 的终验报告与截图索引，检查第 2 项写进台账的结论、宿主与缺口没有夸大或遗漏，并重放 Worker 的破壁记录。
- **交付**: 不交付。

---

## [Task #58] 向导在仓库里搜代码
- **Status**: queued
- **Depends-On**: #57
- **Features**: F-REPO-SEARCH
- **Updated**: 2026-11-16
- **Scope**: `src/core/host.ts`、`src/shells/**`、`src/plugins/guide-acp/**`、`tests/**`
- **契约**: 按 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 4 节的 `RepositoryPort.searchFiles` 与「仓库端口的约束」中的搜索一条，以及 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.2 的「代码」规则与 2.5 的 `pith_search_material` 落地。立项作用域下 `materialId` 可以是材料库里的任一仓库材料，课题作用域下必须是本课题引用的（2.4 工具端点一行）。
- **不在范围内**: 比较、克隆与版本（#59、#60）。
- **Worker 门禁**: 手动破壁各一次后恢复，对应断言须各自变红：不跳过二进制文件；去掉 `limit` 上限；放行含 `..` 的 `pathPrefix`；课题作用域下放行未引用的材料。
- **Tester 验收**: Web 与 Obsidian 各一次。导入一个真实本地仓库立项，要求向导找出一个函数的定义和全部调用点并写进讲义：对话过程里出现搜索步骤，讲义里的 `path:line` 跳到正确的行。另用一个含二进制文件、超大文件和中文内容的玩具仓库，核对搜索不报错、不返回二进制和超大文件、中文能搜到；正则写错时看到原因。

---

## [Task #59] 贴 GitHub 链接导入仓库
- **Status**: queued
- **Depends-On**: #58
- **Features**: F-INTAKE-GITHUB、F-INTAKE-REPO
- **Updated**: 2026-11-16
- **Scope**: `src/core/**`、`src/shells/**`、`src/workbench/**`、`src/plugins/guide-acp/**`、`tests/**`
- **契约**:
  1. 地址识别与规范化按 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 3.6「远端仓库地址」；`Material.remoteUrl`（3.3）、`ImportMaterialInput.remoteUrl` 与 `importMaterial` 的同提交复用按第 4 节，复用对本地仓库同样生效。
  2. `RepositoryPort.cloneRemote` 按第 4 节「仓库端口的约束」的克隆、固定引用、凭据与失败三条；`tests/setup.ts` 把 `PITH_REPOSITORY_HOME` 指向一次性沙盒。
  3. 立项框与「添加材料」按 [5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md) 2.1 与 4.1 分流，包括克隆进行中的进度、停止与失败。
  4. `pith_ingest_external` 拒绝 GitHub 仓库地址（[4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.5 规则）。
  5. 测试不访问外网：用本地 bare 仓库作远端，在沙盒 `HOME` 的 git 全局配置里用 git 自带的 `url.<base>.insteadOf` 把 GitHub 地址改写过去；不用替身代替 git。
- **不在范围内**: 检查更新、版本分组与讲义版本（#60）。
- **Worker 门禁**: 手动破壁各一次后恢复，对应断言须各自变红：去掉同提交复用；去掉固定引用（模拟上游强推后旧提交仍可读的断言）；去掉中止时的目录清理；克隆时也忽略全局 git 配置（经 `insteadOf` 的克隆断言）。
- **Tester 验收**: Web 与 Obsidian 各一次。贴一个真实的小型公开 GitHub 仓库链接导入并打开嵌套文件；再贴一次同一链接，材料库不出现第二份；导入中途停止，不留材料，也不留半成品目录；贴一个不存在的仓库地址，看到明确原因；带目标贴链接走立项；在课题内经「添加材料」贴链接。核对克隆位于 `PITH_REPOSITORY_HOME` 下且没有检出工作区文件。私有仓库的成功克隆依赖人类本机凭据，不在沙盒验收范围，写进已知缺口。

---

## [Task #60] 仓库版本与讲义绑定
- **Status**: queued
- **Depends-On**: #59
- **Features**: F-REPO-VERSIONS、F-LESSON-VERSION
- **Updated**: 2026-11-16
- **Scope**: `src/core/**`、`src/shells/**`、`src/workbench/**`、`src/plugins/guide-acp/**`、`src/plugins/stage-reader/**`、`tests/**`
- **契约**:
  1. [1-core-store-engine.md](subsystems/1-core-store-engine.md) 不变量 10、11，3.2 的 `basedOn` 磁盘格式与缺省规则，第 4 节的 `writeLesson`、`rebaseLesson`、`fetchRemote`、`listChanges`、`readChange` 及其约束。
  2. 检查更新、材料库合卡、课题内的版本分组、「改用」「基于旧版本」「按新版本调整」，按 [5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md) 2.3 与 4.2。
  3. 出处只在依据的版本里解析，按 [2-stages.md](subsystems/2-stages.md) 第 2 节第 3 条。
  4. `pith_compare_material`、`pith_rebase_lesson` 与提示词的「材料」「讲义」两段和「新版本」规则，按 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.2 与 2.5。
  5. v0.1.0 已发布：已有讲义没有 `basedOn` 时按 3.2 的缺省规则读取，不改写已有账本（[AGENTS.md](../AGENTS.md) 核心约束 3）。
- **Worker 门禁**: 手动破壁各一次后恢复，对应断言须各自变红：`writeLesson` 不记 `basedOn`；出处在全部版本里解析（两个版本有同名文件且内容不同）；`rebaseLesson` 改动讲义字节；缺省 `basedOn` 被当成最新版本。
- **Tester 验收**: Web 与 Obsidian 各一次。用一个真实本地仓库：导入并立项，写出至少两讲；在仓库里提交一处只影响其中一讲的改动；在材料库「检查更新」导入新版本，再点一次提示已是最新；在课题里「改用」新版本，两讲都标「基于旧版本」；点「按新版本调整」，向导查看差异后只重写受影响的那讲并写明变化，另一讲只改依据；出处跳到新版本，旧版本上的笔记仍跳回旧代码。向导未连接时「按新版本调整」不可用并说明原因，「改用」照常可用。Pith 克隆的仓库走一次检查更新，远端用 Tester 自己控制的本地 bare 仓库推送新提交。

---

## [Task #61] 发布 v0.2.0：学 GitHub 仓库
- **Status**: queued
- **Depends-On**: #60
- **发布版本**: v0.2.0
- **Features**: F-INTAKE-GITHUB、F-REPO-SEARCH、F-REPO-VERSIONS、F-LESSON-VERSION
- **Updated**: 2026-11-16
- **Scope**: `manifest.json` 与 `package.json` 的版本号；验收工作区 `.tmp/evidence/task-61/`
- **契约**: Web 与 Obsidian 各走一遍学 GitHub 仓库的主链：贴链接导入、带目标立项、向导搜索代码并写讲义、点出处跳转、记笔记、费曼复述、检查更新导入新版本、改用、按新版本调整、结题。再抽查 v0.1.0 已验收的投喂、阅读、离线可用与搁置恢复没有退化。全部通过后按 [ROLES.md](ROLES.md) 第 6 条发布。
- **Worker 门禁**: 两处版本号改为 `0.2.0`，全量门禁通过。
- **报告**: `.tmp/evidence/task-61/final-report.md`
