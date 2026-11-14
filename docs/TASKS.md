# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：
> **单文件滑动任务栈与多 Worktree 协同契约**：详见 [ROLES.md](ROLES.md) 等文档。
>
> **状态**：`pending`（执行环按序执行）· `queued`（前置任务未完成，执行环不执行）· `verified` · `blocked` · `superseded`。Router 核销一个任务时，在同一次提交里把 `Depends-On` 已全部满足的 `queued` 任务改为 `pending`（[ROLES.md](ROLES.md) 第 2 条）；前置任务 `blocked` 时链条停住，等 Brain。
>
> **本轮重构规则**，各任务不再重复：
> 1. 目标契约在 `docs/`，源码与契约的差距列在 [ARCHITECTURE.md](ARCHITECTURE.md) 第六节。任务完成时删掉该表里属于自己的行；一行列了多个任务的，由其中最后完成的那个删。最后一行删掉后连同整节删除。
> 2. 不做兼容（[AGENTS.md](../AGENTS.md) 核心约束 3）：旧格式不读取、不迁移、不留别名。被新契约取代的测试直接改写或删除，并在 Worker 报告里逐个列出文件名与原因；不得为了让旧测试通过而保留旧行为。
> 3. 冻结的内核形状在 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 4 节。发现契约自相矛盾或无法落地时标 `blocked` 并写明证据，不自行改契约。
> 4. 每个任务的 Worker 门禁都包含 `npm run typecheck`、`npm test`；改到 `src/workbench/`、`src/shells/` 或舞台渲染的还包含 `npm run test:browser` 与 `npm run build:obsidian`。下面各任务只列额外的门禁。
> 5. 清理按 [ROLES.md](ROLES.md) 第 7 条。

---

## [Task #51] 内核：材料与课题分离
- **Status**: verified
- **Depends-On**: None
- **Verified-Commit**: 1f371310c869bfe619b8905cf8423474c88e80cd
- **Updated**: 2026-11-13
- **验收结果**: Worker 全仓门禁与四项手动破壁通过；Web 与隔离 Obsidian 的真实 Agent 完成多材料立项、讲义、笔记回跳、材料复用与用户证据结题，补验覆盖快捷动作及已测路径/状态边界。补验的 Web 工具负例由受控客户端调用真实产品模块，未冒充模型回合。本轮双方资源已清理；旧浏览器退出回执缺失，经 Router 精确查询专属 profile 无活动进程及目录占用后清理剩余沙盒。报告及截图：`.tmp/evidence/task-51/tester-1f37131/`、`.tmp/evidence/task-51/tester-boundaries/`；Worker 报告：`.tmp/evidence/task-51/resume-worker/report.md`；清理复核：`.tmp/evidence/task-51/router-cleanup.md`。未交付真实 Vault。
- **Scope**: `src/core/**`、`src/plugins/**`、`src/shells/**`、`src/workbench/**`、`tests/**`、`docs/ARCHITECTURE.md`
- **契约**: 
  1. 类型、磁盘格式与存储接口按 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 2、3、4 节落地。
  2. 旧格式不读取。
  3. 引擎补齐 `intake`、`capture` 与看板快照。
  4. 向导工具按 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.5 终态。
  5. 场景提示词按 2.2 落地。
  6. 记录的作者字段（不变量 7）实现。
- **交付**: 不交付。

---

## [Task #55] PDF 核心渲染与锚点支持
- **Status**: verified
- **Depends-On**: #51
- **Verified-Commit**: 77f18b705a597a4134faccf5ec80aa216f6a23f7
- **Updated**: 2026-11-14
- **验收结果**: PDF 渲染业务 `8282ac32509e5273ca2726c19657c2d65b358134` 与尺寸锚点修复通过工程门禁和独立复验，被测组合为 `63927424428ec9d4a7b9a6331bd67ff5f1c17e4a`。独立 Chrome 和专属 `.dev-vault` Obsidian 实测中英文真实 PDF、鼠标选字、笔记跨文档/页码回跳及高亮；连续宽高变化后保持第 3 页和批注，首轮跳页缺陷已修复。尺寸变化为渲染视口模拟，未做系统窗口拖拽或单独缩放命令；未穷举扫描/加密 PDF。Worker 全仓门禁通过，移除尺寸守卫精准报红；加载产物哈希一致，自有进程及运行沙盒已回收，临时 Worktree 已销毁，Cleanup: PASS。终验截图与报告：`.tmp/evidence/task-55/tester-retry/tester-report.md`、`.tmp/evidence/task-55/tester-retry/`；首轮及修复证据：`.tmp/evidence/task-55/tester/tester-report.md`、`.tmp/evidence/task-55/resize-fix/worker-report.md`。未交付真实 Vault。
- **Scope**: `src/plugins/stage-reader/**`, `tests/**`
- **契约**: 移植 `ganfan-garden` 中的 PDF 渲染实现，作为 `stage-reader` 独立插件。PDF 元素需正确映射 `data-locator`，支持跨文档锚点跳转及高亮。
- **交付**: 不交付。

---

## [Task #56] ACP 通信稳健性与错误处理
- **Status**: verified
- **Depends-On**: #51
- **Verified-Commit**: d8f5d4e30bf22fa1cdd3e8776729719d551284d5
- **Updated**: 2026-11-14
- **验收结果**: Worker 全仓类型、单测、浏览器回归、构建与 13 次手动破壁通过；组合版本在独立 Chrome 和专属 `.dev-vault` Obsidian 中通过真实 Agent 多工具读写、停止及同回合重试，用户消息未重复。原版受控进程故障另行覆盖异常重开、部分回复及写入后失败不自动重放，不冒充真实模型故障；真实停止未覆盖工具写入进行中。构建加载哈希一致；本轮 17 次 Agent 启动均有退出回执，43 个登记 PID 不存在，端口和运行沙盒已回收，Cleanup: PASS。报告及终验截图：`.tmp/evidence/task-56/tester/combined/tester-report.md`、`.tmp/evidence/task-56/tester/combined/`；原版故障证据：`.tmp/evidence/task-56/tester/tester-report.md`；组合工程证据：`.tmp/evidence/task-56/integration-report.md`。未交付真实 Vault。
- **Scope**: `src/plugins/guide-acp/**`, `src/shells/**`
- **契约**: 强化 ACP 通信协议，增加对工具调用超时、状态丢包、异常中断后的状态恢复逻辑。
- **交付**: 不交付。

---

## [Task #52] 工作台：材料库、材料阅读、立项与工具归属
- **Status**: pending
- **Depends-On**: #55, #56
- **Verified-Commit**: none
- **Implementation-Commit**: 11713d05cdbdef7e9fb033ee4ea88de324c7c184
- **Supplemental-Commits**: e9420ac4d88ad9f13a09940c83ee373022a853cc、f902c20ecc13dd797f6aa41f2fb3e2f9c3122f2f、9e2a3e431b2f4b0c3e8bd2cd9b10adfceda00d41
- **Updated**: 2026-11-14
- **Brain 裁决（2026-11-14，契约与本区块在同一提交）**：阻塞成立，错在契约。冻结的 `Material` 没有给仓库材料的阅读位置留表示：`files: []` 对仓库合法，`updateReadingLocator` 只能更新已有的文件条目。裁决是给 `Material` 加可选的 `reading`（最后打开的文件、坐标、时间），平铺存进 `material.md`，唯一写入口是新增的 `recordReading`。不存进缓存，不造假文件条目，不借笔记，也不按课题存（材料不依赖课题，[1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 2 节不变量 1）。契约改动见该文档 3.3 与第 4 节。
- **上一轮阻塞记录（已裁决）**: 仓库阅读位置只写 `_cache/reading`，删缓存后不能重建最后文件、坐标和打开时间，违反材料永久保存阅读进度与缓存可删除重建的契约。现有冻结 `Material` 只在文件条目上提供 locator；合法空文件清单的仓库没有对应表示，`updateReadingLocator` 仅更新已有普通文件条目且不接收仓库嵌套路径。需按本板冻结规则先明确最窄仓库阅读状态的数据表示及读写语义，再令 Worker 修复并重验；不以缓存、假文件或笔记绕过。此前专项用例只覆盖缓存存在时的恢复，尚不能证明删缓存后恢复。证据：`.tmp/evidence/task-52/router-reading-contract.md`；最窄方案草案：`.tmp/evidence/task-52/proposed-resolution.md`（已按上面的裁决重写）。本轮 UI 修复未解除该阻塞，#53/#54 保持 queued。
- **补验进展**: 已按新依赖顺序续验，目录长标题与状态标签、引用材料原有高亮/笔记的只读分区与独立计数、跨课题记录隔离、来源切换、锚点回跳及按钮文案通过实际双宿主交互。原生“课题向导 → 首页 → 独立材料笔记”的空侧栏与正文遮挡已修复，独立 Tester 在 1024×800 复验正文与笔记并排，并确认原已展开/主动选中的大纲保留、向导可见状态记忆及关闭阅读 tab 后清理。首页真实 dsh 读材料后、创建课题前停止，两端各一次成功，目标、1 份材料保留且课题为 0。报告索引：`.tmp/evidence/task-52/router-resume-progress.md`；目录终验：`drawer-fix/tester/tester-report.md`；记录补验：`material-notes-fix/retry-tester/tester-report.md`；原生返修终验及 10 张截图：`native-layout-fix/tester/`（后三者均相对 `.tmp/evidence/task-52/`）。
- **验证与边界**: 最新补丁全仓 typecheck、单测（343 pass / 95 skip / 0 fail）、浏览器（50 文件，137 pass / 4 条真实语音条件 skip / 0 fail）、Obsidian 构建及 6 项红灯/恢复验证通过；main 已同步 `.dev-vault` 且三文件哈希一致。原生尺寸为 renderer 视口模拟，未声称 OS 窗口拖拽；窄净宽的可关闭抽屉按现有响应式契约验收。无正式 GUI 入口的另一目录分支仅有工程覆盖，真实服务失败与自然追问未自然覆盖，受控工程故障另列。Worker/Tester 本轮自有实例、配置与运行目录均已清理，临时 Worktree/分支已删除，Cleanup PASS；经验已记入 LESSONS。未交付真实 Vault，不核销整单。
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
- **Status**: queued
- **Depends-On**: #52
- **Updated**: 2026-11-13
- **Scope**: `src/plugins/toolkit-feynman/**`、`src/core/seams.ts`（`followUp`）、`src/workbench/**`、`src/shells/**`、`tests/**`、`docs/ARCHITECTURE.md`
- **契约**: 费曼新规程（对照原文、要点/复述的自动化核对、追问机制、evalMode 修正）。
- **交付**: 不交付。整体在 #54 终验后交付。

---

## [Task #54] 终验：整体验收与交付
- **Status**: queued
- **Depends-On**: #53
- **Updated**: 2026-11-13
- **Scope**: 验收工作区 `.tmp/evidence/task-54/`。包含：契约对照、全量门禁、真实用户路径（投喂/立项/课题内/训练/结题/搁置/无Agent/沙盒/旧格式）、观感终审包。
- **报告**: `.tmp/evidence/task-54/final-report.md`。
- **交付**: 以上全部通过后执行 [ROLES.md](ROLES.md) 第 6 条。
